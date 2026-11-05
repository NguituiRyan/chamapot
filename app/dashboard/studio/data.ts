// AG Studio's data model for one chama: a table per ChamaPot entity (members, cycles, contributions,
// payouts, approvals, rules, events), the relationships between them, a calendar on payment dates,
// and the measures the treasurer reads every day (collected, target, collection rate, who is late).
//
// Every table and field carries a plain-English description: Studio's built-in AI agents and the
// Claude Treasurer read them to decide which fields to use, so they say what a value means, not
// just what it is called.
//
// Rows are derived from a ChamaSnapshot by buildRows(). The same function runs again whenever
// Supabase realtime reports a change, and diffRows() turns the difference into Studio Live Data
// transactions, so widgets update in place instead of reloading.

import type {
  AgDataSourcesDefinition,
  AgDataTransaction,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from 'ag-studio';
import type {
  ChamaContribution,
  ChamaCycle,
  ChamaMember,
  ChamaPayout,
  ChamaSnapshot,
  ContributionStatus,
  CycleStatus,
  PayoutStatus,
  Role,
} from '@/lib/chama/types';

// --- Formats ----------------------------------------------------------------------

const usd = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) };
// Headline numbers (KPIs) drop the cents so they stay readable on a phone.
const usdWhole = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) };
const kes = { format: new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }) };
const dayMonth = { format: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) };
const dayTime = {
  format: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
};

export const formatUsd = (value: number) => usd.format.format(value);
export const formatKes = (value: number) => kes.format.format(value);

// --- Field helpers ----------------------------------------------------------------

type FieldOptions = { hide?: boolean; formatOptions?: unknown; cardinality?: 'low' | 'medium' | 'high'; blankValue?: string };

const field = (id: string, name: string, format: AgFormat, description: string, options: FieldOptions = {}): AgFieldDefinition => ({
  id,
  name,
  format,
  description,
  ...options,
});

const money = (id: string, name: string, description: string) => field(id, name, 'currencyFormat', description, { formatOptions: usd });
const shilling = (id: string, name: string, description: string) => field(id, name, 'currencyFormat', description, { formatOptions: kes });
const date = (id: string, name: string, description: string) => field(id, name, 'dateFormat', description, { formatOptions: dayMonth, blankValue: '—' });
const dateTime = (id: string, name: string, description: string) => field(id, name, 'dateTimeFormat', description, { formatOptions: dayTime, blankValue: '—' });
const hiddenId = (id: string, description: string) => field(id, id, 'textFormat', description, { hide: true });

const measure = (
  id: string,
  name: string,
  description: string,
  expression: AgExpressionFieldDefinition['expression'],
  format: AgFormat = 'currencyFormat',
  formatOptions: unknown = format === 'currencyFormat' ? usd : undefined,
): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  isMeasure: true,
  format,
  ...(formatOptions ? { formatOptions } : {}),
  expression,
});

const sum = (id: string) => ({ id, aggregation: 'sum' as const });

// --- Labels -----------------------------------------------------------------------

const ROLE_LABEL: Record<Role, string> = { member: 'Member', chair: 'Chair', treasurer: 'Treasurer', secretary: 'Secretary' };
const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  upcoming: 'Upcoming',
  collecting: 'Collecting',
  ready: 'Pot complete',
  paid_out: 'Paid out',
};
const CONTRIBUTION_STATUS_LABEL: Record<ContributionStatus, string> = {
  paid: 'Paid',
  invoiced: 'Invoiced',
  pending: 'Due',
  late: 'Late',
};
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  proposed: 'Awaiting approval',
  approved: 'Approved',
  sent: 'Sent to PayPal',
  succeeded: 'Paid out',
  failed: 'Failed',
  rejected: 'Rejected',
};
const EVENT_KIND_LABEL: Record<string, string> = {
  contribution: 'Contribution',
  payout: 'Payout',
  approval: 'Approval',
  reminder: 'Reminder',
  cycle: 'Cycle',
  webhook: 'PayPal webhook',
  agent: 'Treasurer agent',
  rules: 'Constitution',
};

export const methodLabel = (method: ChamaContribution['method']) =>
  method === 'paypal' ? 'PayPal' : method === 'cash_recorded' ? 'Cash (recorded on PayPal)' : null;

const shortMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
const cycleName = (cycle: ChamaCycle) => `${String(cycle.number).padStart(2, '0')} · ${shortMonth(cycle.starts_on)}`;
const asDate = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso) : null);
const DAY_MS = 86_400_000;

// --- Rows -------------------------------------------------------------------------

export const TABLE_IDS = ['members', 'cycles', 'contributions', 'payouts', 'approvals', 'rules', 'events'] as const;
export type TableId = (typeof TABLE_IDS)[number];
export type StudioRow = Record<string, unknown> & { id: string | number };
export type StudioRows = Record<TableId, StudioRow[]>;

/** The cycle the treasurer is working on: the one collecting, else the earliest ready one. */
export function currentCycle(snapshot: ChamaSnapshot): ChamaCycle | undefined {
  return snapshot.cycles.find((c) => c.id === snapshot.currentCycleId) ?? snapshot.cycles.find((c) => c.status === 'collecting');
}

/** Turns a snapshot into one row array per Studio table. Pure: same snapshot, same rows. */
export function buildRows(snapshot: ChamaSnapshot, now = new Date()): StudioRows {
  const { group, members, cycles, contributions, payouts, approvals, rules, events } = snapshot;
  const rate = group.kes_per_usd;
  const current = currentCycle(snapshot);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const payoutById = new Map(payouts.map((p) => [p.id, p]));
  const paidOutCycles = new Set(
    payouts.filter((p) => p.status === 'succeeded').map((p) => p.cycle_id),
  );

  // Who did something, in words: the agent, the webhook, a role ('treasurer') or a member handle.
  const actorName = (actor: string) => {
    if (actor === 'treasurer-agent') return 'Treasurer agent (Claude)';
    if (actor === 'paypal-webhook') return 'PayPal webhook';
    if (actor === 'system') return 'ChamaPot';
    const byRole = members.find((m) => m.role === actor);
    if (byRole) return `${byRole.full_name} (${ROLE_LABEL[byRole.role].toLowerCase()})`;
    return members.find((m) => m.handle === actor || m.id === actor)?.full_name ?? actor;
  };

  const payoutState = (m: ChamaMember) => {
    const cycle = cycles.find((c) => c.recipient_member_id === m.id);
    if (!cycle) return 'Not scheduled';
    if (cycle.status === 'paid_out' || paidOutCycles.has(cycle.id)) return 'Received';
    if (current && cycle.id === current.id) return 'Receiving now';
    if (current && cycle.number === current.number + 1) return 'Next up';
    return 'Waiting';
  };

  const memberRows: StudioRow[] = members.map((m) => {
    const cycle = cycles.find((c) => c.recipient_member_id === m.id);
    return {
      id: m.id,
      handle: m.handle,
      full_name: m.full_name,
      first_name: m.full_name.split(' ')[0],
      city: m.city,
      country: m.country,
      location: `${m.city}, ${m.country}`,
      role: ROLE_LABEL[m.role],
      is_official: m.role !== 'member',
      pays_via: m.pays_via === 'paypal' ? 'PayPal' : 'Cash',
      is_diaspora: m.city !== 'Nairobi',
      rotation_position: m.rotation_position,
      payout_month: cycle?.label ?? null,
      payout_on: asDate(cycle?.payout_on),
      payout_state: payoutState(m),
      joined_on: asDate(m.joined_on),
    };
  });

  const cycleRows: StudioRow[] = cycles.map((c) => {
    const recipient = memberById.get(c.recipient_member_id);
    const isCurrent = current?.id === c.id;
    const payoutOn = asDate(c.payout_on);
    return {
      id: c.id,
      number: c.number,
      cycle: cycleName(c),
      label: c.label,
      starts_on: asDate(c.starts_on),
      due_on: asDate(c.due_on),
      payout_on: payoutOn,
      status: CYCLE_STATUS_LABEL[c.status],
      is_current: isCurrent,
      recipient_name: recipient?.full_name ?? null,
      recipient_handle: recipient?.handle ?? null,
      target_amount: c.target_amount,
      approvals_required: group.approvals_required,
      days_to_payout: isCurrent && payoutOn ? Math.max(0, Math.ceil((payoutOn.getTime() - now.getTime()) / DAY_MS)) : null,
    };
  });

  const contributionRows: StudioRow[] = contributions.map((c) => {
    const cycle = cycleById.get(c.cycle_id);
    const isCurrent = !!current && c.cycle_id === current.id;
    const paid = c.status === 'paid';
    const paidAmount = paid ? c.amount : 0;
    const outstanding = paid ? 0 : c.amount;
    const late = c.days_late > 0 || c.status === 'late';
    return {
      id: c.id,
      member_id: c.member_id,
      cycle_id: c.cycle_id,
      cycle_number: cycle?.number ?? null,
      is_current_cycle: isCurrent,
      amount: c.amount,
      paid_amount: paidAmount,
      outstanding_amount: outstanding,
      paid_kes: Math.round(paidAmount * rate),
      status: CONTRIBUTION_STATUS_LABEL[c.status],
      is_paid: paid,
      method: methodLabel(c.method) ?? 'Not paid yet',
      pot_share: paid ? (c.method === 'paypal' ? 'PayPal' : 'Cash') : 'Still owed',
      paid_at: asDate(c.paid_at),
      days_late: c.days_late,
      fine: c.fine,
      fine_paid: c.fine_paid,
      invoice_number: c.paypal_invoice_number ?? (c.paypal_invoice_id ? c.paypal_invoice_id : null),
      invoice_url: c.paypal_invoice_url,
      last_reminded_at: asDate(c.last_reminded_at),
      outstanding_count: paid ? 0 : 1,
      late_count: late ? 1 : 0,
      current_paid: isCurrent ? paidAmount : 0,
      current_due: isCurrent ? c.amount : 0,
      current_paid_kes: isCurrent ? Math.round(paidAmount * rate) : 0,
      current_outstanding_count: isCurrent && !paid ? 1 : 0,
    };
  });

  const approvalCount = (p: ChamaPayout) => approvals.filter((a) => a.payout_id === p.id && a.decision === 'approve').length;
  const payoutRows: StudioRow[] = payouts.map((p) => {
    const recipient = memberById.get(p.recipient_member_id);
    const cycle = cycleById.get(p.cycle_id);
    return {
      id: p.id,
      cycle_id: p.cycle_id,
      cycle_number: cycle?.number ?? null,
      cycle: cycle ? cycleName(cycle) : null,
      recipient_member_id: p.recipient_member_id,
      recipient_name: recipient?.full_name ?? null,
      recipient_handle: recipient?.handle ?? null,
      amount: p.amount,
      amount_kes: Math.round(p.amount * rate),
      paid_out_amount: p.status === 'succeeded' ? p.amount : 0,
      completed_count: p.status === 'succeeded' ? 1 : 0,
      status: PAYOUT_STATUS_LABEL[p.status],
      is_current_cycle: !!current && p.cycle_id === current.id,
      proposed_by: actorName(p.proposed_by),
      reason: p.reason,
      approvals_count: approvalCount(p),
      approvals_required: group.approvals_required,
      created_at: asDate(p.created_at),
      sent_at: asDate(p.sent_at),
      completed_at: asDate(p.completed_at),
      paypal_batch_id: p.paypal_batch_id ?? p.sender_batch_id,
    };
  });

  const approvalRows: StudioRow[] = approvals.map((a) => {
    const approver = memberById.get(a.member_id);
    const payout = payoutById.get(a.payout_id);
    const cycle = payout ? cycleById.get(payout.cycle_id) : undefined;
    return {
      id: a.id,
      payout_id: a.payout_id,
      cycle_number: cycle?.number ?? null,
      recipient_name: payout ? (memberById.get(payout.recipient_member_id)?.full_name ?? null) : null,
      approver_name: approver?.full_name ?? 'Unknown member',
      approver_handle: approver?.handle ?? null,
      approver_role: approver ? ROLE_LABEL[approver.role] : null,
      decision: a.decision === 'approve' ? 'Approved' : 'Rejected',
      note: a.note,
      created_at: asDate(a.created_at),
    };
  });

  const ruleRows: StudioRow[] = rules.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    value: r.value,
    source_quote: r.source_quote ? `“${r.source_quote}”` : 'No source quote recorded',
    confidence: r.confidence,
    confidence_band:
      r.confidence == null ? 'Not scored' : r.confidence >= 0.95 ? 'High (95%+)' : r.confidence >= 0.9 ? 'Good (90–95%)' : 'Check (under 90%)',
    extracted_by: r.extracted_by === 'claude' || r.extracted_by.startsWith('claude') ? 'Claude' : r.extracted_by,
    created_at: asDate(r.created_at),
  }));

  const eventRows: StudioRow[] = events.map((e) => ({
    id: e.id,
    kind: EVENT_KIND_LABEL[e.kind] ?? e.kind,
    actor: actorName(e.actor),
    summary: e.summary,
    created_at: asDate(e.created_at),
  }));

  return {
    members: memberRows,
    cycles: cycleRows,
    contributions: contributionRows,
    payouts: payoutRows,
    approvals: approvalRows,
    rules: ruleRows,
    events: eventRows,
  };
}

// --- Live Data --------------------------------------------------------------------

const same = (a: StudioRow, b: StudioRow) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The Live Data transactions that turn `prev` into `next`: per table, rows to remove (gone),
 * update (changed, as whole rows) and add (new). Tables with no change are left out, so Studio
 * keeps their cached results and only widgets reading a changed table run again.
 */
export function diffRows(prev: StudioRows, next: StudioRows): AgDataTransaction[] {
  const transactions: AgDataTransaction[] = [];
  for (const tableId of TABLE_IDS) {
    const before = new Map(prev[tableId].map((r) => [r.id, r]));
    const after = new Map(next[tableId].map((r) => [r.id, r]));
    const remove = [...before.keys()].filter((id) => !after.has(id));
    const update: StudioRow[] = [];
    const add: StudioRow[] = [];
    for (const [id, row] of after) {
      const old = before.get(id);
      if (!old) add.push(row);
      else if (!same(old, row)) update.push(row);
    }
    if (remove.length || update.length || add.length) {
      transactions.push({
        tableId,
        ...(remove.length ? { remove } : {}),
        ...(update.length ? { update } : {}),
        ...(add.length ? { add } : {}),
      } as AgDataTransaction);
    }
  }
  return transactions;
}

// --- Data sources -----------------------------------------------------------------

const CALENDAR_ID = 'calendar';

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => ({ id, source, target, type: 'many-to-one' });

export function buildStudioData(snapshot: ChamaSnapshot, rows: StudioRows = buildRows(snapshot)): AgDataSourcesDefinition {
  const { group } = snapshot;
  const rate = group.kes_per_usd;
  const current = currentCycle(snapshot);
  const dates = [...snapshot.contributions.map((c) => c.paid_at), ...snapshot.events.map((e) => e.created_at)]
    .filter((d): d is string => !!d)
    .map((d) => d.slice(0, 10))
    .sort();
  const firstDay = snapshot.cycles[0]?.starts_on ?? dates[0] ?? new Date().toISOString().slice(0, 10);
  const lastDay = snapshot.cycles.at(-1)?.payout_on ?? dates.at(-1) ?? firstDay;

  // Every table accepts Live Data transactions keyed on `id`, so realtime changes land in place.
  const live = { transactions: 'all' as const, primaryKeyField: 'id' };

  return {
    description:
      `ChamaPot ledger for "${group.name}", a chama (rotating savings group) of ${snapshot.members.length} women in Nairobi and the diaspora. ` +
      `Each member contributes ${formatUsd(group.contribution_amount)} every month (a cycle); the full pot goes to one member per cycle in a fixed rotation. ` +
      `All money amounts are in US dollars (USD). Kenyan shilling equivalents are approximate: KES ≈ USD amount × ${rate} (the group's kes_per_usd rate). ` +
      `Every contribution lives on a PayPal invoice: diaspora members pay the invoice with PayPal, Nairobi members pay cash at the meeting and the treasurer records the cash against the same invoice. ` +
      `Payouts need ${group.approvals_required} official approvals (chair, treasurer, secretary) and the recipient cannot approve her own pot. ` +
      (current ? `The current cycle is ${current.label} (cycle ${current.number} of ${snapshot.cycles.length}); use the "this cycle" measures for it. ` : '') +
      `Rows update live from PayPal webhooks.`,
    sources: [
      {
        id: 'members',
        name: 'Members',
        description:
          'One row per chama member. Rotation turn is the cycle number in which she receives the pot. Officials (chair, treasurer, secretary) approve payouts.',
        ...live,
        data: rows.members,
        fields: [
          hiddenId('id', 'Member ID (UUID). Joins contributions and payouts to their member.'),
          field('handle', 'Handle', 'textFormat', 'Short lowercase member handle used in links, e.g. "atieno". The member statement page is /members/<handle>.', { cardinality: 'low' }),
          field('full_name', 'Member', 'textFormat', 'Member full name, e.g. "Atieno Ochieng". Use this to label members.', { cardinality: 'low' }),
          field('first_name', 'First name', 'textFormat', 'Member first name, for compact labels.', { cardinality: 'low' }),
          field('city', 'City', 'textFormat', 'City the member lives in. Nairobi members pay cash at the meeting; the rest are diaspora and pay with PayPal.', { cardinality: 'low' }),
          field('country', 'Country', 'textFormat', 'Country the member lives in.', { cardinality: 'low' }),
          field('location', 'Location', 'textFormat', 'City and country, e.g. "London, UK".', { cardinality: 'low' }),
          field('role', 'Role', 'textFormat', 'Member, Chair, Treasurer or Secretary. Chair, Treasurer and Secretary are officials who approve payouts.', { cardinality: 'low' }),
          field('is_official', 'Is official', 'booleanFormat', 'True for the chair, treasurer and secretary: the members allowed to approve a payout.'),
          field('pays_via', 'Pays via', 'textFormat', '"PayPal" for diaspora members who pay their PayPal invoice, "Cash" for Nairobi members who pay at the meeting (the treasurer records the cash on the same PayPal invoice).', { cardinality: 'low' }),
          field('is_diaspora', 'Is diaspora', 'booleanFormat', 'True when the member lives outside Nairobi.'),
          field('rotation_position', 'Rotation turn', 'integerFormat', 'Position in the payout rotation, 1–10: the cycle number in which this member receives the pot.'),
          field('payout_month', 'Payout month', 'textFormat', 'The month this member receives (or received) the pot, e.g. "November 2026".', { cardinality: 'low' }),
          date('payout_on', 'Payout date', 'Date of the meeting at which this member receives the pot.'),
          field('payout_state', 'Payout status', 'textFormat', 'Where this member is in the rotation: "Received" (already paid out), "Receiving now" (this cycle), "Next up" or "Waiting".', { cardinality: 'low' }),
          date('joined_on', 'Joined on', 'Date the member joined the chama.'),
        ],
      },
      {
        id: 'cycles',
        name: 'Cycles',
        description:
          'One row per monthly cycle. Each cycle collects one contribution from every member and pays the whole pot to one scheduled recipient. Exactly one cycle is current.',
        ...live,
        data: rows.cycles,
        fields: [
          hiddenId('id', 'Cycle ID (UUID). Joins contributions and payouts to their cycle.'),
          field('number', 'Cycle number', 'integerFormat', 'Cycle number in the rotation, 1–10. Sort by this for chronological order.'),
          field('cycle', 'Cycle', 'textFormat', 'Short cycle label that sorts chronologically, e.g. "07 · Nov". Prefer this as a chart category or pivot column.', { cardinality: 'low' }),
          field('label', 'Month', 'textFormat', 'Cycle month, e.g. "November 2026".', { cardinality: 'low' }),
          date('starts_on', 'Starts on', 'First day of the cycle, when invoices go out.'),
          date('due_on', 'Due on', 'Contribution due date. After the grace period a late fine applies.'),
          date('payout_on', 'Payout on', 'Date the pot is handed over at the monthly meeting.'),
          field('status', 'Cycle status', 'textFormat', '"Collecting" (contributions coming in), "Pot complete" (ready to pay out), "Paid out" or "Upcoming".', { cardinality: 'low' }),
          field('is_current', 'Is current cycle', 'booleanFormat', 'True only for the cycle being collected now.'),
          field('recipient_name', 'Recipient', 'textFormat', 'The member scheduled to receive this cycle’s pot. Paying anyone else is refused by the server.', { cardinality: 'low' }),
          field('recipient_handle', 'Recipient handle', 'textFormat', 'Handle of the scheduled recipient.', { cardinality: 'low' }),
          money('target_amount', 'Pot target', 'The full pot for the cycle in USD (contribution × members, $500).'),
          field('approvals_required', 'Approvals required', 'integerFormat', 'How many officials must approve the payout before PayPal Payouts sends it.'),
          field('days_to_payout', 'Days to payout (current)', 'integerFormat', 'Days from today until the current cycle’s payout meeting. Empty for every other cycle.'),
        ],
      },
      {
        id: 'contributions',
        name: 'Contributions',
        description:
          'The ledger: one row per member per cycle. Amounts are USD. Each contribution has a PayPal invoice; status turns to Paid when PayPal reports INVOICING.INVOICE.PAID (PayPal payment or cash recorded on the invoice). ' +
          'Fields starting "this cycle" are zero outside the current cycle, so they can be summed without a filter.',
        ...live,
        data: rows.contributions,
        fields: [
          hiddenId('id', 'Contribution ID (UUID).'),
          hiddenId('member_id', 'Member ID; joins to members.'),
          hiddenId('cycle_id', 'Cycle ID; joins to cycles.'),
          field('cycle_number', 'Cycle #', 'integerFormat', 'Cycle number this contribution belongs to, 1–10.'),
          field('is_current_cycle', 'In current cycle', 'booleanFormat', 'True when the contribution belongs to the cycle being collected now.'),
          money('amount', 'Amount due', 'Contribution owed for the cycle, in USD (normally $50).'),
          money('paid_amount', 'Paid', 'Amount received, in USD: the full amount once paid, otherwise 0.'),
          money('outstanding_amount', 'Outstanding', 'Amount still owed, in USD: the full amount until paid, then 0.'),
          shilling('paid_kes', 'Paid (KES ≈)', `Approximate Kenyan shilling value of the amount paid: paid USD × ${rate}.`),
          field('status', 'Status', 'textFormat', '"Paid", "Invoiced" (PayPal invoice sent, not paid yet), "Due" (no invoice yet) or "Late".', { cardinality: 'low' }),
          field('is_paid', 'Is paid', 'booleanFormat', 'True once the contribution is paid.'),
          field('method', 'Paid via', 'textFormat', '"PayPal" (member paid the PayPal invoice), "Cash (recorded on PayPal)" (paid at the meeting, recorded by the treasurer on the invoice) or "Not paid yet".', { cardinality: 'low' }),
          field('pot_share', 'Pot share', 'textFormat', 'How this contribution stands in its pot: "PayPal" (paid via PayPal), "Cash" (paid in cash, recorded on PayPal) or "Still owed". Good as a donut category with the Target measure.', { cardinality: 'low' }),
          dateTime('paid_at', 'Paid at', 'When the payment was confirmed. Empty while unpaid. Linked to the calendar.'),
          field('days_late', 'Days late', 'integerFormat', 'Days paid (or still unpaid) past the due date and grace period. 0 when on time.'),
          money('fine', 'Fine', 'Late fine charged, in USD ($5 per the constitution when paid after the grace period).'),
          field('fine_paid', 'Fine paid', 'booleanFormat', 'True once the late fine has been paid.'),
          field('invoice_number', 'PayPal invoice', 'textFormat', 'PayPal invoice number for this contribution. Empty when no invoice has been created yet.', { cardinality: 'high', blankValue: '—' }),
          field('invoice_url', 'Invoice link', 'textFormat', 'Link to the PayPal invoice the member pays.', { cardinality: 'high', blankValue: '—' }),
          dateTime('last_reminded_at', 'Last reminded', 'When a PayPal invoice reminder was last sent for this contribution.'),
          field('outstanding_count', 'Unpaid (count)', 'integerFormat', '1 when unpaid, 0 when paid. Sum it to count unpaid contributions.'),
          field('late_count', 'Late (count)', 'integerFormat', '1 when the contribution was paid late or is overdue, else 0. Sum it to count late payments.'),
          money('current_paid', 'Paid this cycle', 'Amount paid in USD, only for the current cycle (0 for every other cycle).'),
          money('current_due', 'Due this cycle', 'Amount due in USD, only for the current cycle (0 for every other cycle).'),
          shilling('current_paid_kes', 'Paid this cycle (KES ≈)', `Approximate KES value paid in the current cycle: USD × ${rate}.`),
          field('current_outstanding_count', 'Unpaid this cycle (count)', 'integerFormat', '1 for each current-cycle contribution not yet paid, else 0.'),
        ],
      },
      {
        id: 'payouts',
        name: 'Payouts',
        description:
          'One row per pot payout (PayPal Payouts). A payout is proposed (often by the Claude Treasurer agent), approved by officials, sent to PayPal, then paid out. Amounts are USD.',
        ...live,
        data: rows.payouts,
        fields: [
          hiddenId('id', 'Payout ID (UUID).'),
          hiddenId('cycle_id', 'Cycle ID; joins to cycles.'),
          hiddenId('recipient_member_id', 'Recipient member ID; joins to members.'),
          field('cycle_number', 'Payout cycle #', 'integerFormat', 'Cycle number the payout belongs to.'),
          field('cycle', 'Payout cycle', 'textFormat', 'Short cycle label, e.g. "06 · Oct".', { cardinality: 'low' }),
          field('recipient_name', 'Payout recipient', 'textFormat', 'Member who receives the pot.', { cardinality: 'low' }),
          field('recipient_handle', 'Payout recipient handle', 'textFormat', 'Handle of the member who receives the pot.', { cardinality: 'low' }),
          money('amount', 'Payout amount', 'Pot amount paid out, in USD (the sum of paid contributions).'),
          shilling('amount_kes', 'Payout (KES ≈)', `Approximate KES value of the payout: USD × ${rate}.`),
          money('paid_out_amount', 'Paid out', 'USD actually paid out: the payout amount once PayPal confirms it, otherwise 0.'),
          field('completed_count', 'Completed (count)', 'integerFormat', '1 for a payout PayPal has confirmed, else 0. Sum it to count completed payouts.'),
          field('status', 'Payout status', 'textFormat', '"Awaiting approval", "Approved", "Sent to PayPal", "Paid out", "Failed" or "Rejected".', { cardinality: 'low' }),
          field('is_current_cycle', 'Payout is current cycle', 'booleanFormat', 'True for the payout of the cycle being collected now.'),
          field('proposed_by', 'Proposed by', 'textFormat', 'Who proposed the payout: the Claude Treasurer agent or the treasurer. The agent can only propose; money moves after two official approvals.', { cardinality: 'low' }),
          field('reason', 'Reason', 'textFormat', 'Why the payout was proposed.', { cardinality: 'high' }),
          field('approvals_count', 'Approvals', 'integerFormat', 'Number of official approvals recorded so far.'),
          field('approvals_required', 'Approvals needed', 'integerFormat', 'Approvals needed before PayPal Payouts sends the money.'),
          dateTime('created_at', 'Proposed at', 'When the payout was proposed.'),
          dateTime('sent_at', 'Sent at', 'When the payout was sent to PayPal Payouts.'),
          dateTime('completed_at', 'Completed at', 'When PayPal confirmed the payout.'),
          field('paypal_batch_id', 'PayPal batch', 'textFormat', 'PayPal Payouts batch reference.', { cardinality: 'high' }),
        ],
      },
      {
        id: 'approvals',
        name: 'Approvals',
        description: 'One row per official vote on a payout. Two approvals are needed; the recipient may not vote on her own pot.',
        ...live,
        data: rows.approvals,
        fields: [
          hiddenId('id', 'Approval ID (UUID).'),
          hiddenId('payout_id', 'Payout ID; joins to payouts.'),
          field('cycle_number', 'Approval cycle #', 'integerFormat', 'Cycle number of the payout this vote is for.'),
          field('recipient_name', 'Approved recipient', 'textFormat', 'Member receiving the payout being voted on.', { cardinality: 'low' }),
          field('approver_name', 'Approver', 'textFormat', 'Official who voted.', { cardinality: 'low' }),
          field('approver_handle', 'Approver handle', 'textFormat', 'Handle of the official who voted.', { cardinality: 'low' }),
          field('approver_role', 'Approver role', 'textFormat', 'Chair, Treasurer or Secretary.', { cardinality: 'low' }),
          field('decision', 'Decision', 'textFormat', '"Approved" or "Rejected".', { cardinality: 'low' }),
          field('note', 'Note', 'textFormat', 'Optional note left with the vote.', { cardinality: 'high' }),
          dateTime('created_at', 'Voted at', 'When the vote was cast.'),
        ],
      },
      {
        id: 'rules',
        name: 'Constitution rules',
        description:
          'Rules Claude extracted from the chama constitution, each with the exact source quote and a confidence score (0–1). ChamaPot enforces these rules in code.',
        ...live,
        data: rows.rules,
        fields: [
          hiddenId('id', 'Rule ID (UUID).'),
          field('key', 'Rule key', 'textFormat', 'Machine key of the rule, e.g. "late_fine" or "payout_approval".', { cardinality: 'low' }),
          field('label', 'Rule', 'textFormat', 'Short rule name, e.g. "Late fine".', { cardinality: 'low' }),
          field('value', 'What it says', 'textFormat', 'The rule in plain words, e.g. "$5 if paid after the 7-day grace period".', { cardinality: 'low' }),
          field('source_quote', 'Source quote', 'textFormat', 'The exact sentence from the constitution the rule was read from, in quotes.', { cardinality: 'high' }),
          field('confidence', 'Confidence', 'percentageFormat', 'How confident Claude is that the rule was read correctly, 0–100%.'),
          field('confidence_band', 'Confidence band', 'textFormat', '"High (95%+)", "Good (90–95%)" or "Check (under 90%)": rules under 90% deserve a human check.', { cardinality: 'low' }),
          field('extracted_by', 'Extracted by', 'textFormat', 'Who extracted the rule (Claude or a person).', { cardinality: 'low' }),
          dateTime('created_at', 'Extracted at', 'When the rule was extracted.'),
        ],
      },
      {
        id: 'events',
        name: 'Activity',
        description:
          'Audit trail of everything that happened: PayPal webhooks, reminders, cash recorded, Treasurer agent actions, approvals and payouts. Newest first when sorted by time.',
        ...live,
        data: rows.events,
        fields: [
          field('id', 'Event #', 'integerFormat', 'Event sequence number.', { hide: true }),
          field('kind', 'Event type', 'textFormat', 'Contribution, Payout, Approval, Reminder, Cycle, PayPal webhook, Treasurer agent or Constitution.', { cardinality: 'low' }),
          field('actor', 'Actor', 'textFormat', 'Who or what caused the event: a member, the PayPal webhook or the Treasurer agent.', { cardinality: 'low' }),
          field('summary', 'What happened', 'textFormat', 'One-line description of the event.', { cardinality: 'high' }),
          dateTime('created_at', 'When', 'When the event happened. Linked to the calendar.'),
        ],
      },
    ],
    relationships: [
      manyToOne('contribution-member', 'contributions.member_id', 'members.id'),
      manyToOne('contribution-cycle', 'contributions.cycle_id', 'cycles.id'),
      manyToOne('payout-cycle', 'payouts.cycle_id', 'cycles.id'),
      manyToOne('payout-member', 'payouts.recipient_member_id', 'members.id'),
      manyToOne('approval-payout', 'approvals.payout_id', 'payouts.id'),
      { id: 'contributions-paid_at-calendar', source: 'contributions.paid_at', target: { calendarId: CALENDAR_ID }, truncate: 'day' },
      { id: 'events-created_at-calendar', source: 'events.created_at', target: { calendarId: CALENDAR_ID }, truncate: 'day' },
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: { from: { type: 'date', value: firstDay }, to: { type: 'date', value: lastDay } },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      measure('potCollected', 'Collected', 'This cycle: USD collected so far towards the pot (sum of Paid this cycle).', sum('contributions.current_paid'), 'currencyFormat', usdWhole),
      measure('potTarget', 'Target', 'This cycle: the full pot in USD, every member’s contribution (sum of Due this cycle).', sum('contributions.current_due'), 'currencyFormat', usdWhole),
      measure('potCollectedKes', 'Collected (KES ≈)', `This cycle: approximate KES collected (USD × ${rate}).`, sum('contributions.current_paid_kes'), 'currencyFormat', kes),
      measure('membersOutstanding', 'Members outstanding', 'This cycle: how many members have not paid yet.', sum('contributions.current_outstanding_count'), 'integerFormat'),
      measure(
        'potFilled',
        'Pot filled',
        'This cycle: share of the pot collected (collected ÷ target).',
        { operator: 'divide', inputs: [sum('contributions.current_paid'), sum('contributions.current_due')] },
        'percentageFormat',
      ),
      measure('daysToPayout', 'Days to payout', 'Days until the current cycle’s payout meeting.', { id: 'cycles.days_to_payout', aggregation: 'min' }, 'integerFormat'),
      measure('totalCollected', 'Total collected', 'USD collected across the contributions in view (any cycle).', sum('contributions.paid_amount'), 'currencyFormat', usdWhole),
      measure('totalDue', 'Total due', 'USD owed across the contributions in view (any cycle).', sum('contributions.amount'), 'currencyFormat', usdWhole),
      measure(
        'collectionRate',
        'Collection rate',
        'Collected ÷ due for the contributions in view. 100% means everyone paid.',
        { operator: 'divide', inputs: [sum('contributions.paid_amount'), sum('contributions.amount')] },
        'percentageFormat',
      ),
      measure('membersLate', 'Late payments', 'Number of contributions paid late or still overdue.', sum('contributions.late_count'), 'integerFormat'),
      measure('finesCharged', 'Fines charged', 'USD of late fines charged.', sum('contributions.fine'), 'currencyFormat', usdWhole),
      // Per-row measures for tables: same numbers as the raw fields, without "(sum)" in the header.
      measure('owes', 'Owes', 'USD still owed by the member(s) in the row.', sum('contributions.outstanding_amount')),
      measure('paidIn', 'Paid in', 'USD paid in by the member(s) in the row.', sum('contributions.paid_amount')),
      measure('daysLate', 'Days late', 'Most days late among the contributions in the row.', { id: 'contributions.days_late', aggregation: 'max' }, 'integerFormat'),
      measure('paymentStatus', 'Payment status', 'Status of the contribution in the row: Paid, Invoiced, Due or Late.', { id: 'contributions.status', aggregation: 'first' }, 'textFormat'),
      measure('payoutAmount', 'Amount', 'USD of the payout(s) in the row.', sum('payouts.amount')),
      measure('payoutApprovals', 'Approvals', 'Official approvals recorded for the payout in the row.', { id: 'payouts.approvals_count', aggregation: 'max' }, 'integerFormat'),
      measure('ruleConfidence', 'Confidence', 'Claude’s confidence that the rule was read correctly (average for the rules in view).', { id: 'rules.confidence', aggregation: 'avg' }, 'percentageFormat'),
      measure('paidOutTotal', 'Paid out to date', 'USD paid out to members and confirmed by PayPal.', sum('payouts.paid_out_amount'), 'currencyFormat', usdWhole),
      measure('payoutsCompleted', 'Pots paid out', 'Number of pots paid out and confirmed by PayPal.', sum('payouts.completed_count'), 'integerFormat'),
      measure('approvalsCast', 'Approvals cast', 'Number of official approval votes recorded.', sum('payouts.approvals_count'), 'integerFormat'),
    ],
  };
}
