// The AG Studio 3.1 context menu for the treasurer. Right-click a member anywhere in the dashboard
// (a grid row, a pivot cell, a chart bar, a node on the rotation wheel) and Studio passes the
// clicked field values as `params.filter`; this works out which member and contribution they mean
// and offers the treasurer's actions: a PayPal invoice reminder, recording a cash payment on the
// PayPal invoice, the member's statement (drill-through popup or page), or focusing the whole
// dashboard on her with a drill-through filter.

import type { AgContextMenuItem, AgFilterDefinition, AgGetContextMenuParams } from 'ag-studio';
import type { ChamaContribution, ChamaCycle, ChamaMember, ChamaSnapshot } from '@/lib/chama/types';
import { currentCycle } from './data';

export type ChamaMenuActions = {
  snapshot: () => ChamaSnapshot;
  remind: (contribution: ChamaContribution, member: ChamaMember) => void;
  recordCash: (contribution: ChamaContribution, member: ChamaMember) => void;
  openStatement: (member: ChamaMember, restoreFocus?: () => void) => void;
  focusMember: (member: ChamaMember) => void;
  goTo: (href: string) => void;
};

type Condition = { field: { id: string }; operator: string; value: unknown };

/** Flattens the clicked item's filter (one condition, or an AND of one per field) into equalities. */
function conditions(filter: AgFilterDefinition | undefined): Condition[] {
  if (!filter) return [];
  if ('conditions' in filter) return filter.conditions.flatMap((c) => conditions(c));
  return filter.operator === 'equals' || filter.operator === 'isIn' ? [filter as Condition] : [];
}

const valueOf = (c: Condition) => (Array.isArray(c.value) ? (c.value.length === 1 ? c.value[0] : undefined) : c.value);

const MEMBER_BY_NAME = ['members.full_name', 'payouts.recipient_name', 'cycles.recipient_name', 'approvals.approver_name', 'approvals.recipient_name'];
const MEMBER_BY_HANDLE = ['members.handle', 'payouts.recipient_handle', 'cycles.recipient_handle', 'approvals.approver_handle'];
const CYCLE_BY_NUMBER = ['cycles.number', 'contributions.cycle_number', 'payouts.cycle_number', 'approvals.cycle_number'];
const CYCLE_BY_NAME = ['cycles.cycle', 'payouts.cycle'];

function resolve(snapshot: ChamaSnapshot, filter: AgFilterDefinition | undefined) {
  const found = conditions(filter);
  const get = (ids: string[]) => {
    const match = found.find((c) => ids.includes(c.field.id));
    return match ? valueOf(match) : undefined;
  };

  const invoice = get(['contributions.invoice_number']);
  let contribution = invoice ? snapshot.contributions.find((c) => c.paypal_invoice_number === invoice) : undefined;

  const name = get(MEMBER_BY_NAME);
  const handle = get(MEMBER_BY_HANDLE);
  const firstName = get(['members.first_name']);
  const member =
    (contribution && snapshot.members.find((m) => m.id === contribution!.member_id)) ??
    snapshot.members.find(
      (m) => (name != null && m.full_name === name) || (handle != null && m.handle === handle) || (firstName != null && m.full_name.split(' ')[0] === firstName),
    );
  if (!member) return null;

  const number = get(CYCLE_BY_NUMBER);
  const cycleName = get(CYCLE_BY_NAME);
  const label = get(['cycles.label']);
  const cycle: ChamaCycle | undefined =
    (contribution && snapshot.cycles.find((c) => c.id === contribution!.cycle_id)) ??
    snapshot.cycles.find(
      (c) =>
        (number != null && c.number === Number(number)) ||
        (label != null && c.label === label) ||
        (typeof cycleName === 'string' && Number(cycleName.slice(0, 2)) === c.number),
    ) ??
    currentCycle(snapshot);

  contribution ??= cycle ? snapshot.contributions.find((c) => c.member_id === member.id && c.cycle_id === cycle.id) : undefined;
  return { member, cycle, contribution };
}

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  remind: icon('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  cash: icon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  statement: icon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  focus: icon('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  open: icon('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  paid: icon('<path d="M20 6 9 17l-5-5"/>'),
};

export function chamaContextMenu(actions: ChamaMenuActions) {
  return (params: AgGetContextMenuParams): AgContextMenuItem[] => {
    const snapshot = actions.snapshot();
    const found = resolve(snapshot, params.filter);
    if (!found) return [];
    const { member, cycle, contribution } = found;
    const first = member.full_name.split(' ')[0];
    const unpaid = contribution && contribution.status !== 'paid';
    const items: AgContextMenuItem[] = [];

    if (contribution && cycle) {
      if (unpaid) {
        items.push({
          name: 'Send PayPal reminder',
          icon: ICONS.remind,
          disabled: !contribution.paypal_invoice_id,
          tooltip: contribution.paypal_invoice_id
            ? `Re-send ${first}’s ${cycle.label} PayPal invoice${contribution.paypal_invoice_number ? ` (${contribution.paypal_invoice_number})` : ''}`
            : 'No PayPal invoice yet: create this cycle’s invoices first',
          action: () => actions.remind(contribution, member),
        });
        items.push({
          name: 'Record cash payment',
          icon: ICONS.cash,
          tooltip: `Record ${first}’s cash for ${cycle.label} against her PayPal invoice`,
          action: () => actions.recordCash(contribution, member),
        });
      } else {
        items.push({
          name: `${first} paid ${cycle.label}${contribution.paid_at ? ` on ${new Date(contribution.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`,
          icon: ICONS.paid,
          disabled: true,
        });
      }
      items.push('separator');
    }

    items.push(
      {
        name: 'Open member statement',
        icon: ICONS.statement,
        tooltip: `${member.full_name}’s full statement page`,
        action: () => actions.goTo(`/members/${member.handle}`),
      },
      {
        name: `Drill through to ${first}’s statement`,
        icon: ICONS.open,
        action: () => actions.openStatement(member, params.restoreFocusOnClose),
      },
      {
        name: `Focus dashboard on ${first}`,
        icon: ICONS.focus,
        tooltip: 'Filter every widget on every page to this member (drill-through)',
        action: () => actions.focusMember(member),
      },
    );
    return items;
  };
}
