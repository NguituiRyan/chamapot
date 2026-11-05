// The built-in "Treasurer dashboard" report: four pages a chama treasurer opens every day, as AG
// Studio report state. Field ids ('contributions.paid_amount', 'potCollected') refer to the data
// model in ./data.ts; the custom widget types ('pot-progress', ...) are defined in ./widgets.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import { BRAND, DISPLAY_FONT, SANS_FONT } from './theme';
import type { ChamaRegistry } from './widgets';

type Page = AgPageState<ChamaRegistry>;

// --- Helpers ----------------------------------------------------------------------

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight (18px).
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});
const first = (id: string) => ({ id, aggregation: 'first' as const });

const display = (fontSize: number) => ({ fontFamily: DISPLAY_FONT, fontSize, fontWeight: 'bold' as const, fontStyle: 'normal' as const });
const body = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: SANS_FONT, fontSize, fontWeight, fontStyle: 'normal' as const });

// Headline numbers in the display face, labelled underneath, two to a row so they read the same
// on a phone as on a desktop.
const multiKpi = (text: string, values: { id: string; aggregation?: 'sum' | 'min' | 'max' }[], columns = 2) => ({
  type: 'multi-kpi' as const,
  dataMapping: { values },
  format: {
    title: { enabled: true, text },
    style: {
      columns,
      verticalAlign: 'center' as const,
      textAlign: 'left' as const,
      typography: display(30),
      color: BRAND.ink,
      label: { enabled: true, position: 'below' as const, typography: body(13), color: BRAND.muted },
      columnSeparator: { enabled: true, width: 1, color: BRAND.lineSoft },
      rowSeparator: { enabled: true, width: 1, color: BRAND.lineSoft },
    },
  },
});

const isTrue = (id: string) => ({ field: { id }, model: { operator: 'isTrue' as const } });

// --- This cycle -------------------------------------------------------------------

const thisCycle: Page = {
  id: 'this-cycle',
  widgets: {
    'cycle-kpis': multiKpi('This cycle at a glance', [
      { id: 'potCollected' },
      { id: 'potTarget' },
      { id: 'membersOutstanding' },
      { id: 'daysToPayout' },
    ]),
    pot: {
      type: 'pot-progress',
      dataMapping: {
        collected: [{ id: 'potCollected' }],
        target: [{ id: 'potTarget' }],
        kes: [{ id: 'potCollectedKes' }],
        outstanding: [{ id: 'membersOutstanding' }],
      },
      format: { ...title('This cycle’s pot'), style: { showKes: true } },
    },
    rotation: {
      type: 'rotation-wheel',
      dataMapping: {
        member: [{ id: 'members.full_name' }],
        order: [{ id: 'members.rotation_position', aggregation: 'min' }],
        status: [first('members.payout_state')],
        month: [first('members.payout_month')],
      },
      format: { ...title('Payout rotation', 'Click a member to filter · right-click for actions'), style: { currentAtTop: true }, crossFilter: 'none' },
    },
    'pot-share': {
      type: 'donut-chart',
      dataMapping: {
        categoryKey: [{ id: 'contributions.pot_share' }],
        valueKey: [{ id: 'potTarget' }],
      },
      format: {
        ...title('Where the pot stands', 'PayPal, cash recorded on PayPal, still owed'),
        style: {
          custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } },
          theme: { common: { legend: { enabled: true, position: 'bottom' } } },
        },
      },
    },
    outstanding: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'members.full_name' },
          { id: 'members.city' },
          { id: 'members.pays_via' },
          { id: 'paymentStatus' },
          { id: 'contributions.invoice_number' },
          { id: 'owes' },
          { id: 'paidIn' },
          { id: 'daysLate' },
        ],
      },
      sort: [{ field: { id: 'owes' }, direction: 'desc' }],
      format: {
        ...title('Outstanding this cycle', 'Right-click a member: PayPal reminder, record cash, statement'),
        style: { columnAutoSize: true, animateValueChanges: true, grandTotalRow: { enabled: false } },
      },
    },
  },
  widgetLayout: {
    'cycle-kpis': at(0, 0, 8, 17),
    pot: at(8, 0, 8, 17),
    rotation: at(16, 0, 8, 17),
    'pot-share': at(0, 17, 8, 17),
    outstanding: at(8, 17, 16, 17),
  },
  filter: {
    widget: { outstanding: [isTrue('contributions.is_current_cycle')] },
  },
};

// --- Ledger -----------------------------------------------------------------------

const ledger: Page = {
  id: 'ledger',
  widgets: {
    'pays-via': {
      type: 'button-filter',
      dataMapping: { value: [{ id: 'members.pays_via' }] },
      format: {
        ...title('Pays via'),
        style: { selection: { type: 'single' }, dimensions: { height: 30, minWidth: 64 } },
      },
    },
    'ledger-kpis': multiKpi('All cycles so far', [
      { id: 'totalCollected' },
      { id: 'collectionRate' },
      { id: 'membersLate' },
      { id: 'finesCharged' },
    ]),
    'by-cycle': {
      type: 'combo-chart-grouped-column-line',
      dataMapping: {
        categoryKey: [{ id: 'cycles.cycle' }],
        valueKey: [{ id: 'totalDue' }, { id: 'totalCollected' }],
        secondaryValueKey: [{ id: 'collectionRate' }],
      },
      format: {
        ...title('Due vs paid by cycle', 'Bars in USD, line is the collection rate'),
        style: { theme: { common: { legend: { enabled: true, position: 'bottom' } } } },
      },
    },
    'late-by-member': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'members.first_name' }],
        valueKey: [{ id: 'membersLate' }],
      },
      sort: [{ field: { id: 'membersLate' }, direction: 'desc' }],
      format: title('Late payments by member'),
    },
    'ledger-pivot': {
      type: 'pivot-grid',
      dataMapping: {
        rows: [{ id: 'members.full_name' }],
        columns: [{ id: 'cycles.cycle' }],
        values: [{ id: 'paidIn' }],
      },
      format: {
        ...title('Ledger · paid per member per cycle', 'USD. Cells flash as PayPal webhooks land. Click to cross-filter.'),
        style: {
          totalColumns: true,
          totalColumnsPlacement: 'after',
          grandTotalRow: { enabled: true },
          animateValueChanges: true,
        },
      },
    },
    'ledger-table': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'cycles.cycle' },
          { id: 'members.full_name' },
          { id: 'contributions.status' },
          { id: 'contributions.method' },
          { id: 'contributions.paid_at' },
          { id: 'contributions.invoice_number' },
          { id: 'paidIn' },
          { id: 'daysLate' },
          { id: 'finesCharged' },
        ],
      },
      sort: [{ field: { id: 'cycles.cycle' }, direction: 'desc' }],
      format: { ...title('Every contribution', 'One PayPal invoice per member per cycle'), style: { columnAutoSize: true, animateValueChanges: true } },
    },
  },
  widgetLayout: {
    'ledger-kpis': at(0, 0, 8, 17),
    'by-cycle': at(8, 0, 16, 17),
    'pays-via': at(0, 17, 8, 8),
    'late-by-member': at(0, 25, 8, 14),
    'ledger-pivot': at(8, 17, 16, 22),
    'ledger-table': at(0, 39, 24, 20),
  },
};

// --- Payouts & approvals ----------------------------------------------------------

const payouts: Page = {
  id: 'payouts',
  widgets: {
    tracker: {
      type: 'approval-tracker',
      dataMapping: {},
      format: { ...title('Payout approvals', 'Two officials, never the recipient'), style: { approvalsHref: '/approvals', showLastPayout: true } },
    },
    'payout-kpis': multiKpi('Rotation so far', [{ id: 'paidOutTotal' }, { id: 'payoutsCompleted' }, { id: 'approvalsCast' }], 3),
    'payouts-table': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'payouts.cycle' },
          { id: 'payouts.recipient_name' },
          { id: 'payouts.status' },
          { id: 'payouts.proposed_by' },
          { id: 'payouts.completed_at' },
          { id: 'payoutAmount' },
          { id: 'payoutApprovals' },
        ],
      },
      sort: [{ field: { id: 'payouts.cycle' }, direction: 'desc' }],
      format: { ...title('Payouts', 'Sent with PayPal Payouts after two approvals'), style: { columnAutoSize: true, animateValueChanges: true } },
    },
    activity: {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'events.created_at' }, { id: 'events.kind' }, { id: 'events.actor' }, { id: 'events.summary' }],
      },
      sort: [{ field: { id: 'events.created_at' }, direction: 'desc' }],
      format: {
        ...title('Audit trail', 'PayPal webhooks, reminders, agent actions and votes, newest first'),
        style: { columnAutoSize: true, grandTotalRow: { enabled: false } },
      },
    },
  },
  widgetLayout: {
    tracker: at(0, 0, 9, 24),
    'payout-kpis': at(9, 0, 15, 8),
    'payouts-table': at(9, 8, 15, 16),
    activity: at(0, 24, 24, 18),
  },
};

// --- Rules ------------------------------------------------------------------------

const rules: Page = {
  id: 'rules',
  widgets: {
    intro: {
      type: 'text',
      dataMapping: {},
      format: {
        style: {
          text: 'Claude read the Umoja Sisters constitution and turned it into these rules. ChamaPot enforces them in code: fines, reminders, the rotation and the two-official payout check all run before any money moves.',
          typography: body(15),
          color: BRAND.muted,
          verticalAlign: 'center',
          padding: true,
        },
      },
    },
    'rule-picker': {
      type: 'list-filter',
      dataMapping: { value: [{ id: 'rules.label' }] },
      format: { ...title('Rules', 'Pick one to see its source'), style: { selection: { type: 'single' } } },
    },
    'rule-quote': {
      type: 'text',
      dataMapping: { value: [first('rules.source_quote')] },
      format: {
        ...title('From the constitution', 'The exact sentence Claude read the rule from'),
        style: {
          typography: { fontFamily: DISPLAY_FONT, fontSize: 21, fontWeight: 'normal', fontStyle: 'italic' },
          color: BRAND.potDeep,
          verticalAlign: 'center',
          textAlign: 'left',
          padding: true,
          textScaling: { enabled: true },
        },
      },
    },
    'rule-confidence': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'rules.label' }],
        valueKey: [{ id: 'ruleConfidence' }],
      },
      sort: [{ field: { id: 'ruleConfidence' }, direction: 'desc' }],
      format: title('Extraction confidence', 'Under 90% deserves a second look'),
    },
    'rules-table': {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'rules.label' },
          { id: 'rules.value' },
          { id: 'rules.confidence_band' },
          { id: 'rules.source_quote' },
          { id: 'ruleConfidence' },
        ],
      },
      sort: [{ field: { id: 'ruleConfidence' }, direction: 'desc' }],
      format: { ...title('The constitution, as enforced'), style: { columnAutoSize: true, grandTotalRow: { enabled: false } } },
    },
  },
  widgetLayout: {
    intro: at(0, 0, 24, 5),
    'rule-picker': at(0, 5, 7, 20),
    'rule-quote': at(7, 5, 17, 9),
    'rule-confidence': at(7, 14, 17, 11),
    'rules-table': at(0, 25, 24, 17),
  },
};

export const PAGE_TITLES: Record<string, string> = {
  [thisCycle.id]: 'This cycle',
  [ledger.id]: 'Ledger',
  [payouts.id]: 'Payouts & approvals',
  [rules.id]: 'Rules',
};

// The report opens on "This cycle".
export const dashboardReport: AgReportState<ChamaRegistry> = {
  selectedPageId: thisCycle.id,
  pages: [thisCycle, ledger, payouts, rules],
  panels: { filters: { collapsed: true } },
};
