'use client';

// Approval tracker: where the current cycle's payout stands. The pot fills, the Claude Treasurer
// agent proposes the payout, two officials approve (never the recipient), then PayPal Payouts sends
// it. Reads the chama tables straight from the report schema, so it needs no data mapping, and every
// query stays live: a vote cast on /approvals lights up an avatar here without a refresh.

import type { AgFilter, AgWidgetData, AgWidgetDataFormat, AgWidgetField, AgWidgetParams } from 'ag-studio';
import type { AgWidgetDefinition } from 'ag-studio-react';
import { AgNoDataOverlay } from 'ag-studio-react';
import { BRAND } from '../theme';
import { Avatar, baseFormatFields, formatShapeFrom, formWithExtras, num, schemaField, text, usd0, useWidgetRows, type Row } from './shared';

export interface ApprovalTrackerStyle {
  /** Where the "Review" link points. */
  approvalsHref?: string;
  /** Show the most recent completed payout under the tracker. */
  showLastPayout?: boolean;
}

export type ApprovalTrackerWidget = AgWidgetData<Record<string, never>, AgWidgetDataFormat<ApprovalTrackerStyle>> & {
  type: 'approval-tracker';
};

const FIELDS = {
  payouts: ['payouts.cycle_number', 'payouts.recipient_name', 'payouts.amount', 'payouts.status', 'payouts.proposed_by', 'payouts.approvals_count', 'payouts.approvals_required', 'payouts.completed_at'],
  approvals: ['approvals.cycle_number', 'approvals.approver_name', 'approvals.approver_role', 'approvals.decision'],
  officials: ['members.full_name', 'members.role'],
  cycle: ['cycles.number', 'cycles.label', 'cycles.recipient_name', 'cycles.payout_on', 'cycles.approvals_required'],
  pot: ['potCollected', 'potTarget'],
} as const;

type FieldMap = Record<string, AgWidgetField>;

const pick = (row: Row | undefined, fields: FieldMap, id: string) => (row ? row[fields[id]?.key ?? ''] : undefined);

function useTrackerData(props: AgWidgetParams<ApprovalTrackerWidget>) {
  const { widgetApi } = props;
  const schema = widgetApi.getSchema();
  const fields: FieldMap = {};
  for (const id of [...FIELDS.payouts, ...FIELDS.approvals, ...FIELDS.officials, ...FIELDS.cycle, ...FIELDS.pot]) {
    const found = schemaField(schema, id);
    if (found) fields[id] = found;
  }
  const isOfficial = schemaField(schema, 'members.is_official');
  const isCurrent = schemaField(schema, 'cycles.is_current');
  const list = (ids: readonly string[]) => ids.map((id) => fields[id]).filter((f): f is AgWidgetField => !!f);
  const isTrue = (field: AgWidgetField | undefined): AgFilter[] => (field ? [{ field, operator: 'isTrue', value: true }] : []);
  const options = { crossFilter: 'none' as const };

  const payouts = useWidgetRows(widgetApi, fields['payouts.status'] ? { kind: 'flat', fields: list(FIELDS.payouts) } : null, { queryId: 'payouts', ...options }, props);
  const approvals = useWidgetRows(widgetApi, fields['approvals.decision'] ? { kind: 'flat', fields: list(FIELDS.approvals) } : null, { queryId: 'approvals', ...options }, props);
  const officials = useWidgetRows(
    widgetApi,
    fields['members.full_name'] ? { kind: 'flat', fields: list(FIELDS.officials), filter: isTrue(isOfficial) } : null,
    { queryId: 'officials', ...options },
    props,
  );
  const cycle = useWidgetRows(
    widgetApi,
    fields['cycles.number'] ? { kind: 'flat', fields: list(FIELDS.cycle), filter: isTrue(isCurrent) } : null,
    { queryId: 'cycle', ...options },
    props,
  );
  const pot = useWidgetRows(widgetApi, fields.potCollected ? { kind: 'flat', fields: list(FIELDS.pot) } : null, { queryId: 'pot', ...options }, props);

  return { fields, payouts: payouts.rows, approvals: approvals.rows, officials: officials.rows, cycle: cycle.rows, pot: pot.rows };
}

type StepState = 'done' | 'active' | 'waiting' | 'failed';

function Step({ state, title, detail, last }: { state: StepState; title: string; detail: string; last?: boolean }) {
  const color = state === 'done' ? BRAND.pot : state === 'active' ? BRAND.marigold : state === 'failed' ? BRAND.danger : BRAND.line;
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!last && <span className="cp-step-line absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5" style={{ background: state === 'done' ? BRAND.pot : BRAND.line }} aria-hidden />}
      <span
        className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: state === 'waiting' ? '#fff' : color, border: `2px solid ${color}`, color: state === 'waiting' ? BRAND.muted : '#fff' }}
        aria-hidden
      >
        {state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'active' ? '•' : ''}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-5 text-[var(--cp-ink)]">{title}</p>
        <p className="text-xs leading-4 text-[var(--cp-muted)]">{detail}</p>
      </div>
    </li>
  );
}

function ApprovalTracker(props: AgWidgetParams<ApprovalTrackerWidget>) {
  const { format } = props;
  const data = useTrackerData(props);
  const { fields } = data;
  if (!fields['payouts.status'] || !fields['cycles.number']) return <AgNoDataOverlay />;
  if (!data.cycle || !data.payouts || !data.approvals || !data.officials) return null; // first load: Studio shows its own spinner

  const cycleRow = data.cycle[0];
  const cycleNumber = num(pick(cycleRow, fields, 'cycles.number'));
  const cycleLabel = text(pick(cycleRow, fields, 'cycles.label'));
  const recipient = text(pick(cycleRow, fields, 'cycles.recipient_name'));
  const required = num(pick(cycleRow, fields, 'cycles.approvals_required')) || 2;
  const potRow = data.pot?.[0];
  const collected = num(pick(potRow, fields, 'potCollected'));
  const target = num(pick(potRow, fields, 'potTarget'));

  const payout = data.payouts.find((r) => num(pick(r, fields, 'payouts.cycle_number')) === cycleNumber);
  const status = text(pick(payout, fields, 'payouts.status'));
  const amount = payout ? num(pick(payout, fields, 'payouts.amount')) : target;
  const proposedBy = text(pick(payout, fields, 'payouts.proposed_by'));
  const votes = data.approvals.filter((r) => num(pick(r, fields, 'approvals.cycle_number')) === cycleNumber);
  const approvedBy = new Set(votes.filter((r) => text(pick(r, fields, 'approvals.decision')) === 'Approved').map((r) => text(pick(r, fields, 'approvals.approver_name'))));
  const rejectedBy = new Set(votes.filter((r) => text(pick(r, fields, 'approvals.decision')) === 'Rejected').map((r) => text(pick(r, fields, 'approvals.approver_name'))));
  const approvals = approvedBy.size;

  const sent = /sent|paid out/i.test(status);
  const paidOut = /paid out/i.test(status);
  const failed = /failed|rejected/i.test(status);
  const potFull = !!payout || (target > 0 && collected >= target);

  const last = data.payouts
    .filter((r) => /paid out/i.test(text(pick(r, fields, 'payouts.status'))) && num(pick(r, fields, 'payouts.cycle_number')) !== cycleNumber)
    .sort((a, b) => num(pick(b, fields, 'payouts.cycle_number')) - num(pick(a, fields, 'payouts.cycle_number')))[0];

  const pill = !payout
    ? { label: potFull ? 'Ready to propose' : 'Pot filling', bg: BRAND.marigoldSoft, fg: '#8A5A12' }
    : failed
      ? { label: status, bg: BRAND.claySoft, fg: BRAND.danger }
      : paidOut
        ? { label: 'Paid out', bg: BRAND.potSoft, fg: BRAND.success }
        : sent
          ? { label: 'Sent to PayPal', bg: BRAND.potSoft, fg: BRAND.potDeep }
          : { label: `${approvals} of ${required} approvals`, bg: BRAND.marigoldSoft, fg: '#8A5A12' };

  const href = format?.style?.approvalsHref || '/approvals';

  return (
    <div className="cp-widget overflow-y-auto">
      <div className="flex min-h-full flex-col gap-3 px-1 pb-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cp-muted)]">
              Cycle {cycleNumber} · {cycleLabel}
            </p>
            <p className="cp-display text-lg leading-snug text-[var(--cp-ink)]">
              {usd0.format(amount || 0)} to {recipient || 'the scheduled member'}
            </p>
          </div>
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: pill.bg, color: pill.fg }}>
            {pill.label}
          </span>
        </div>

        <ol className="m-0 list-none p-0">
          <Step
            state={potFull ? 'done' : 'active'}
            title={potFull ? 'Pot complete' : 'Collecting the pot'}
            detail={potFull ? `${usd0.format(target || amount)} paid in by every member` : `${usd0.format(collected)} of ${usd0.format(target)} in so far`}
          />
          <Step
            state={payout ? 'done' : potFull ? 'active' : 'waiting'}
            title="Payout proposed"
            detail={payout ? `By ${proposedBy || 'the treasurer'}` : 'The Treasurer agent proposes once every member has paid'}
          />
          <Step
            state={failed ? 'failed' : approvals >= required || sent ? 'done' : payout ? 'active' : 'waiting'}
            title={`${required} officials approve`}
            detail={`${approvals} of ${required} so far · the recipient can’t approve her own pot`}
          />
          <Step
            state={paidOut ? 'done' : sent ? 'active' : 'waiting'}
            title="PayPal Payouts sends the pot"
            detail={paidOut ? 'Confirmed by PayPal webhook' : sent ? 'Waiting for PayPal to confirm' : 'Only after the approvals'}
            last
          />
        </ol>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {data.officials.map((row) => {
            const name = text(pick(row, fields, 'members.full_name'));
            const role = text(pick(row, fields, 'members.role'));
            const isRecipient = name === recipient;
            const approved = approvedBy.has(name);
            const rejected = rejectedBy.has(name);
            return (
              <div key={name} className="flex items-center gap-2" title={`${name}, ${role}`}>
                <span className="relative">
                  <Avatar name={name} size={32} muted={!approved && !rejected} ring={approved ? BRAND.pot : rejected ? BRAND.danger : undefined} />
                  {approved && (
                    <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white" style={{ background: BRAND.pot }}>
                      ✓
                    </span>
                  )}
                </span>
                <span className="leading-tight">
                  <span className="block text-xs font-semibold text-[var(--cp-ink)]">{name.split(' ')[0]}</span>
                  <span className="block text-[11px] text-[var(--cp-muted)]">
                    {isRecipient ? 'Recipient · can’t vote' : approved ? 'Approved' : rejected ? 'Rejected' : role}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cp-line-soft)] pt-2">
          {format?.style?.showLastPayout !== false && last ? (
            <p className="text-xs text-[var(--cp-muted)]">
              Last: {text(pick(last, fields, 'payouts.recipient_name')).split(' ')[0]} · cycle {num(pick(last, fields, 'payouts.cycle_number'))} ·{' '}
              {usd0.format(num(pick(last, fields, 'payouts.amount')))} <span style={{ color: BRAND.success }}>✓</span>
            </p>
          ) : (
            <span />
          )}
          <a href={href} className="text-sm font-semibold text-[var(--cp-pot-deep)] underline-offset-2 hover:underline">
            Review in Approvals →
          </a>
        </div>
      </div>
    </div>
  );
}

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 19c.8-2.8 2.7-4 5-4s4.2 1.2 5 4M14 17l2 2 4-4"/></svg>';

export const approvalTrackerWidget: AgWidgetDefinition<'approval-tracker', ApprovalTrackerWidget> = {
  id: 'approval-tracker',
  label: 'Approval tracker',
  icon: ICON,
  defaultState: {
    format: { title: { enabled: true, text: 'Payout approvals' }, style: { approvalsHref: '/approvals', showLastPayout: true } },
  },
  formatShape: formatShapeFrom((s) =>
    s.object({
      ...baseFormatFields(s),
      style: s.object({ approvalsHref: s.string().optional(), showLastPayout: s.boolean().optional() }).optional(),
    }),
  ),
  form: (params) =>
    formWithExtras(params, [], [
      { type: 'checkbox', id: 'format.style.showLastPayout', label: 'Show last payout', defaultValue: true },
      { type: 'textfield', id: 'format.style.approvalsHref', label: 'Review link', defaultValue: '/approvals' },
    ]),
  comp: ApprovalTracker,
  defaultSize: { width: 440, height: 420 },
  minSize: { width: 240, height: 300 },
  ai: {
    label: 'Payout approval tracker',
    description:
      'Shows the current cycle’s payout as four steps (pot complete, payout proposed by the Claude Treasurer agent, two official approvals, PayPal Payouts sends), the officials as avatars that light up when they approve, the recipient marked as unable to vote, and a link to the Approvals page.',
    usage:
      'Use for "has the payout been approved", "who still needs to approve", "where is this month’s payout". It reads the payouts, approvals, members and cycles tables itself.',
    configuration:
      'Needs no data mapping: add it as is. Give it a tall slot (about 9 columns wide, 22 rows high) and a title such as "Payout approvals".',
  },
};
