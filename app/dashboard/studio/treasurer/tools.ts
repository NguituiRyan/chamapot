// The Treasurer's chama tools, built with Studio's custom AI tool API (api.defineAiTool). They run in
// the browser, inside Studio's agent loop, and talk to the money layer only through its HTTP routes
// (docs/CONTRACTS.md). None of them can move money: the most they do is send a PayPal invoice
// reminder or create a payout PROPOSAL that two officials must approve on /approvals.
import type { AgAiTool, AgAiToolContext, AgStudioApi } from 'ag-studio';
import type { ChamaContribution, ChamaCycle, ChamaMember, ChamaPayout, ChamaSnapshot } from '@/lib/chama/types';

export const TREASURER_TOOLS = {
  listOutstanding: 'list_outstanding_members',
  rotation: 'rotation_status',
  remind: 'send_payment_reminder',
  propose: 'propose_payout',
} as const;

/** What `list_outstanding_members` hands the model and its step label. */
export interface OutstandingData {
  cycle: { number: number; label: string; dueOn: string } | null;
  target: string;
  outstandingTotal: string;
  outstanding: {
    contributionId: string;
    name: string;
    handle: string;
    city: string;
    paysVia: string;
    amount: string;
    status: string;
    daysLate: number;
    invoiceNumber: string | null;
    lastRemindedAt: string | null;
  }[];
}

export interface RotationData {
  cycle: { number: number; label: string; status: string; dueOn: string; payoutOn: string } | null;
  recipient: { name: string; handle: string; city: string } | null;
  collected: string;
  target: string;
  paidCount: number;
  memberCount: number;
  potReady: boolean;
  payout: { id: string; status: string; amount: string; approvals: number; approvalsRequired: number } | null;
  upNext: { name: string; handle: string; city: string }[];
}

export interface ReminderData {
  contributionId: string;
  memberName: string;
  handle: string;
  invoiceNumber: string | null;
  sent: boolean;
  note?: string;
}

export interface ProposalData {
  payoutId: string | null;
  recipientName: string;
  recipientHandle: string;
  amount: string;
  approvalsRequired: number;
}

// --- Helpers ---------------------------------------------------------------------

const ACTOR = 'treasurer-agent';

function money(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function kes(amountUsd: number, rate: number) {
  return `KES ${Math.round(amountUsd * rate).toLocaleString('en-US')}`;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `HTTP ${response.status} ${response.statusText}`.trim();
}

async function loadSnapshot(slug: string, signal: AbortSignal): Promise<ChamaSnapshot> {
  const response = await fetch(`/api/chama/snapshot?slug=${encodeURIComponent(slug)}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load the chama: ${await readError(response)}`);
  return (await response.json()) as ChamaSnapshot;
}

function currentCycle(snapshot: ChamaSnapshot): ChamaCycle | undefined {
  return (
    snapshot.cycles.find((c) => c.id === snapshot.currentCycleId) ??
    snapshot.cycles.find((c) => c.status === 'collecting' || c.status === 'ready')
  );
}

function memberById(snapshot: ChamaSnapshot) {
  return new Map(snapshot.members.map((m) => [m.id, m] as const));
}

const failed = (ctx: AgAiToolContext, error: unknown) =>
  ctx.error(error instanceof Error ? error.message : String(error));

// --- Tools -----------------------------------------------------------------------

/** Build the four chama tools against one Studio instance and one chama. */
export function buildTreasurerTools(api: AgStudioApi, slug: string): AgAiTool[] {
  const listOutstanding = api.defineAiTool({
    name: TREASURER_TOOLS.listOutstanding,
    description:
      "List the members who have not yet paid this cycle's contribution: name, city, how they pay (PayPal or cash), " +
      'amount, days late, PayPal invoice number, when they were last reminded, and the contributionId needed by ' +
      'send_payment_reminder. Read-only. Call it before answering who is behind or sending reminders.',
    params: (s) => s.object({}),
    execute: async (_args, ctx) => {
      try {
        const snapshot = await loadSnapshot(slug, ctx.signal);
        const cycle = currentCycle(snapshot);
        const members = memberById(snapshot);
        const currency = snapshot.group.currency;
        const open = cycle ? snapshot.contributions.filter((c) => c.cycle_id === cycle.id && c.status !== 'paid') : [];
        const outstanding = open
          .map((c) => ({ c, m: members.get(c.member_id) }))
          .filter((row): row is { c: ChamaContribution; m: ChamaMember } => row.m !== undefined)
          .sort((a, b) => b.c.days_late - a.c.days_late || a.m.rotation_position - b.m.rotation_position)
          .map(({ c, m }) => ({
            contributionId: c.id,
            name: m.full_name,
            handle: m.handle,
            city: m.city,
            paysVia: m.pays_via === 'cash' ? 'cash at the meeting' : 'PayPal',
            amount: money(c.amount, c.currency || currency),
            status: c.status,
            daysLate: c.days_late,
            invoiceNumber: c.paypal_invoice_number,
            lastRemindedAt: c.last_reminded_at,
          }));
        const owed = open.reduce((sum, c) => sum + c.amount, 0);
        const data: OutstandingData = {
          cycle: cycle ? { number: cycle.number, label: cycle.label, dueOn: cycle.due_on } : null,
          target: money(cycle?.target_amount ?? 0, currency),
          outstandingTotal: `${money(owed, currency)} (≈ ${kes(owed, snapshot.group.kes_per_usd)})`,
          outstanding,
        };
        const summary = !cycle
          ? 'No cycle is collecting right now.'
          : outstanding.length === 0
            ? `Everyone has paid for cycle ${cycle.number} (${cycle.label}).`
            : `${outstanding.length} of ${snapshot.members.length} members still owe for cycle ${cycle.number} (${cycle.label}), ${data.outstandingTotal} in total.`;
        return ctx.success(summary, data);
      } catch (error) {
        return failed(ctx, error);
      }
    },
  });

  const rotationStatus = api.defineAiTool({
    name: TREASURER_TOOLS.rotation,
    description:
      'The current cycle of the rotation: who receives this pot, how much has been collected against the target, ' +
      'whether the pot is complete, any payout already proposed and its approvals, and who receives the next pots. Read-only.',
    params: (s) => s.object({}),
    execute: async (_args, ctx) => {
      try {
        const snapshot = await loadSnapshot(slug, ctx.signal);
        const cycle = currentCycle(snapshot);
        const members = memberById(snapshot);
        const currency = snapshot.group.currency;
        const contributions = cycle ? snapshot.contributions.filter((c) => c.cycle_id === cycle.id) : [];
        const paid = contributions.filter((c) => c.status === 'paid');
        const collected = paid.reduce((sum, c) => sum + c.amount, 0);
        const recipient = cycle ? members.get(cycle.recipient_member_id) : undefined;
        const payout: ChamaPayout | undefined = cycle
          ? snapshot.payouts
              .filter((p) => p.cycle_id === cycle.id && p.status !== 'rejected')
              .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
          : undefined;
        const approvals = payout
          ? snapshot.approvals.filter((a) => a.payout_id === payout.id && a.decision === 'approve').length
          : 0;
        const ordered = [...snapshot.members].sort((a, b) => a.rotation_position - b.rotation_position);
        const at = recipient ? ordered.findIndex((m) => m.id === recipient.id) : -1;
        const upNext = at >= 0 ? [1, 2, 3].map((k) => ordered[(at + k) % ordered.length]).filter(Boolean) : [];
        const potReady =
          !!cycle && (cycle.status === 'ready' || (contributions.length > 0 && paid.length === contributions.length));
        const data: RotationData = {
          cycle: cycle
            ? { number: cycle.number, label: cycle.label, status: cycle.status, dueOn: cycle.due_on, payoutOn: cycle.payout_on }
            : null,
          recipient: recipient ? { name: recipient.full_name, handle: recipient.handle, city: recipient.city } : null,
          collected: `${money(collected, currency)} (≈ ${kes(collected, snapshot.group.kes_per_usd)})`,
          target: money(cycle?.target_amount ?? 0, currency),
          paidCount: paid.length,
          memberCount: contributions.length || snapshot.members.length,
          potReady,
          payout: payout
            ? {
                id: payout.id,
                status: payout.status,
                amount: money(payout.amount, payout.currency || currency),
                approvals,
                approvalsRequired: snapshot.group.approvals_required,
              }
            : null,
          upNext: upNext.map((m) => ({ name: m.full_name, handle: m.handle, city: m.city })),
        };
        const summary = !cycle
          ? 'No cycle is collecting right now.'
          : `Cycle ${cycle.number} (${cycle.label}): ${money(collected, currency)} of ${data.target} collected from ` +
            `${paid.length}/${data.memberCount} members; the pot goes to ${recipient?.full_name ?? 'the scheduled member'}. ` +
            (potReady ? 'The pot is complete.' : 'The pot is not complete yet.');
        return ctx.success(summary, data);
      } catch (error) {
        return failed(ctx, error);
      }
    },
  });

  const sendReminder = api.defineAiTool({
    name: TREASURER_TOOLS.remind,
    description:
      "Send one member a reminder for this cycle's unpaid contribution. PayPal emails her the invoice again (cash payers " +
      'get it too - the treasurer records cash against it). Use a contributionId from list_outstanding_members. ' +
      'A member can be reminded at most once every 10 minutes. This sends a real email; it never moves money.',
    params: (s) =>
      s.object({
        contributionId: s.string({ description: 'The contributionId from list_outstanding_members.' }),
      }),
    execute: async ({ contributionId }, ctx) => {
      try {
        const snapshot = await loadSnapshot(slug, ctx.signal);
        const contribution = snapshot.contributions.find((c) => c.id === contributionId);
        if (!contribution) {
          return ctx.error(`No contribution "${contributionId}". Call list_outstanding_members for the current ids.`);
        }
        const member = memberById(snapshot).get(contribution.member_id);
        const memberName = member?.full_name ?? 'this member';
        if (contribution.status === 'paid') {
          return ctx.error(`${memberName} has already paid this contribution; no reminder sent.`);
        }
        const base: Omit<ReminderData, 'sent'> = {
          contributionId,
          memberName,
          handle: member?.handle ?? '',
          invoiceNumber: contribution.paypal_invoice_number,
        };
        const response = await fetch(`/api/chama/contributions/${encodeURIComponent(contributionId)}/remind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actor: ACTOR }),
          signal: ctx.signal,
        });
        if (response.status === 409 || response.status === 429) {
          // Not a failure: the once-per-10-minutes rule (or similar) held it back.
          const note = await readError(response);
          return ctx.success<ReminderData>(`Not sent to ${memberName}: ${note}`, { ...base, sent: false, note });
        }
        if (!response.ok) return ctx.error(`Reminder to ${memberName} failed: ${await readError(response)}`);
        const invoice = contribution.paypal_invoice_number ? ` (invoice ${contribution.paypal_invoice_number})` : '';
        return ctx.success<ReminderData>(`PayPal reminder sent to ${memberName}${invoice}.`, { ...base, sent: true });
      } catch (error) {
        return failed(ctx, error);
      }
    },
  });

  const proposePayout = api.defineAiTool({
    name: TREASURER_TOOLS.propose,
    description:
      "Propose paying out this cycle's pot. This only creates a PROPOSAL: two officials must approve it on the Approvals " +
      'page (the recipient cannot approve her own pot) before the server sends it with PayPal Payouts. The server ' +
      "checks the chama's rules - the pot must be complete and the recipient must be the member scheduled for this " +
      'cycle - and refuses anything else; relay a refusal to the user word for word.',
    params: (s) =>
      s.object({
        recipientHandle: s
          .string({ description: "The recipient's member handle. Omit it to pay the scheduled member." })
          .optional(),
        reason: s.string({ description: 'One sentence for the officials, e.g. "Cycle 7 pot complete; Wanjiru is next in the rotation."' }),
      }),
    execute: async ({ recipientHandle, reason }, ctx) => {
      try {
        const response = await fetch('/api/chama/payouts/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, ...(recipientHandle ? { recipientHandle } : {}), reason }),
          signal: ctx.signal,
        });
        if (!response.ok) {
          // A rule refusal (409) is the server doing its job: hand it back verbatim, not as a crash.
          const message = await readError(response);
          return ctx.error(
            response.status === 409
              ? `Refused by the chama's rules: ${message}. No payout was proposed and no money moved.`
              : `The payout was not proposed: ${message}. No money moved.`,
          );
        }
        const body = (await response.json().catch(() => ({}))) as { payout?: Partial<ChamaPayout> } & Partial<ChamaPayout>;
        const payout = body.payout ?? body;
        const snapshot = await loadSnapshot(slug, ctx.signal).catch(() => undefined);
        const members = snapshot ? memberById(snapshot) : new Map<string, ChamaMember>();
        const cycle = snapshot ? currentCycle(snapshot) : undefined;
        const recipient =
          (payout.recipient_member_id && members.get(payout.recipient_member_id)) ||
          (recipientHandle && snapshot?.members.find((m) => m.handle === recipientHandle)) ||
          (cycle && members.get(cycle.recipient_member_id)) ||
          undefined;
        const approvalsRequired = snapshot?.group.approvals_required ?? 2;
        const data: ProposalData = {
          payoutId: payout.id ?? null,
          recipientName: recipient?.full_name ?? recipientHandle ?? 'the scheduled member',
          recipientHandle: recipient?.handle ?? recipientHandle ?? '',
          amount: typeof payout.amount === 'number' ? money(payout.amount, payout.currency || 'USD') : '',
          approvalsRequired,
        };
        return ctx.success(
          `Payout proposed${data.amount ? `: ${data.amount}` : ''} to ${data.recipientName}. It now needs ` +
            `${approvalsRequired} officials to approve it on the Approvals page before PayPal sends it.`,
          data,
        );
      } catch (error) {
        return failed(ctx, error);
      }
    },
  });

  return [listOutstanding, rotationStatus, sendReminder, proposePayout];
}
