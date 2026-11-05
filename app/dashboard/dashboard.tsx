'use client';

// The ChamaPot treasurer dashboard: the ChamaPot shell (./components) around one AG Studio
// instance. Studio's configuration (data model, theme, report, custom widgets, AI) lives in
// ./studio. Three things flow through this file:
//
//   - The ledger. The server renders a ChamaSnapshot; buildStudioData() turns it into Studio data
//     sources once. After that, Supabase realtime (PayPal webhooks landing in the database) and the
//     treasurer's own actions update the snapshot, and diffRows() sends only the changed rows to
//     Studio as Live Data transactions: ledger cells flash, the pot ring refills, no reload.
//   - The treasurer's actions: Studio's context menu (studio/context-menu.ts) calls the money routes
//     (reminders, cash recorded on PayPal invoices) and opens member statements as drill-throughs.
//   - Saved dashboards: the shell drives Studio through its API (setState, getState, undo, redo)
//     and Studio reports every change back through onStateUpdated, as in the AG Studio starter.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  singleColumnLayout,
  type AgAiHarnessSetup,
  type AgDataSourcesDefinition,
  type AgDrillThroughOptions,
  type AgPanelConfig,
  type AgResponsiveLayoutBreakpoint,
  type AgStudioApi,
  type AgStudioMode,
} from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { DEMO_GROUP_SLUG, type ChamaContribution, type ChamaMember, type ChamaSnapshot } from '@/lib/chama/types';
import { AppShell, type ShellGroup } from './components/app-shell';
import {
  CreateReportDialog,
  DeleteReportDialog,
  ResetDemoDialog,
  UnsavedChangesDialog,
  type DashboardDialog,
} from './components/dialogs';
import { EmptyData } from './components/empty-data';
import { MemberStatement, type MemberStatementParams } from './components/member-statement';
import { ReportHeader } from './components/report-header';
import { ReportsSidebar } from './components/sidebar';
import { DashboardSkeleton } from './components/skeleton';
import { Toasts, useToasts } from './components/toasts';
import { pagesFor, pageTitlesFor } from './page-titles';
import * as reportState from './report-state';
import {
  blankReport,
  copyOf,
  defaultReport,
  findReport,
  initialReports,
  newId,
  remove,
  upsert,
  type ChamaReportState,
  type SavedReport,
} from './reports-store';
import { buildAi, treasurerToolDisplay } from './studio/ai';
import { chamaContextMenu, type ChamaMenuActions } from './studio/context-menu';
import { buildRows, buildStudioData, currentCycle, diffRows, formatUsd, type StudioRows } from './studio/data';
import { applyLiveChange, fetchSnapshot, useChamaRealtime } from './studio/live';
import { chamaStudioTheme } from './studio/theme';
import { chamaWidgets, type ChamaRegistry } from './studio/widgets';
import { useReports } from './use-reports';

if (process.env.NODE_ENV !== 'production') {
  enableStudioDevValidations();
}

type DashboardProps = {
  snapshot: ChamaSnapshot;
  licenseKey?: string;
  /** Claude models the Treasurer may use; omitted when no Anthropic key is configured, which hides the AI panel. */
  aiModels?: string[];
};

type StudioHistory = { canUndo: boolean; canRedo: boolean };
const NO_HISTORY: StudioHistory = { canUndo: false, canRedo: false };
const noSubscription = () => () => {};

/** The treasurer acting in this demo (no sign-in; the money routes trust the handle, see CONTRACTS.md). */
const ACTING_OFFICIAL = 'akinyi';

// Phones: below 500px of canvas, widgets stack in one column in their desktop order.
const BREAKPOINTS: AgResponsiveLayoutBreakpoint[] = [{ maxWidth: 500, layout: singleColumnLayout }];
// The canvas may be drawn as narrow as a phone; Studio's own minimum is lowered in the theme.
const PAGE_LAYOUT = { widgetBorderEnabled: true, minWidth: 250 };
// Phones get the whole width for the canvas: no Filters side panel in view mode.
const PHONE_PANELS: AgPanelConfig = { view: { left: [], right: [] } };
const PHONE_QUERY = '(max-width: 767px)';
const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export function Dashboard(props: DashboardProps) {
  // Saved dashboards live in localStorage, which only exists in the browser.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return inBrowser ? <ReportsDashboard {...props} /> : <DashboardSkeleton />;
}

function buildAiSafely(models: string[]): AgAiHarnessSetup | undefined {
  try {
    // CONTRACT: app/dashboard/studio/ai.ts (Agent C) exports buildAi({ models, slug }).
    return buildAi({ models, slug: DEMO_GROUP_SLUG });
  } catch (error) {
    console.warn('[ChamaPot] Treasurer AI unavailable; the dashboard runs without it.', error);
    return undefined;
  }
}

const groupLine = (snapshot: ChamaSnapshot): ShellGroup => {
  const cycle = currentCycle(snapshot);
  return {
    name: snapshot.group.name,
    cycleLine: cycle ? `${cycle.label} · cycle ${cycle.number} of ${snapshot.cycles.length}` : `${snapshot.cycles.length} cycles`,
  };
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
  return json;
}

// The data model is registry-agnostic (it names no widget types); Studio's props are typed with the
// ChamaPot registry, so the two meet here.
const studioData = (snapshot: ChamaSnapshot, rows: StudioRows) =>
  buildStudioData(snapshot, rows) as unknown as AgDataSourcesDefinition<ChamaRegistry>;

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

function ReportsDashboard({ snapshot: serverSnapshot, licenseKey, aiModels }: DashboardProps) {
  const router = useRouter();
  const { store, latest, update, editReport } = useReports();
  const apiRef = useRef<AgStudioApi<ChamaRegistry> | null>(null);
  const studioReady = useRef(false);
  const { toasts, push, dismiss } = useToasts();

  // --- The ledger -----------------------------------------------------------------
  // `snapshot` drives the shell; `snapshotRef` is read by callbacks Studio holds on to.
  const [snapshot, setSnapshot] = useState(serverSnapshot);
  const snapshotRef = useRef(serverSnapshot);
  const [lastUpdate, setLastUpdate] = useState(() => new Date().toISOString());
  const [refreshing, setRefreshing] = useState(false);
  // Studio's data is built once; every later change is a transaction against these rows.
  const [initial] = useState(() => {
    const rows = buildRows(serverSnapshot);
    return { rows, data: studioData(serverSnapshot, rows) };
  });
  const appliedRows = useRef<StudioRows>(initial.rows);
  const announced = useRef(new Set<string>());

  /** Sends the rows that changed since the last push to Studio as one Live Data transaction. */
  const pushToStudio = useCallback(() => {
    const api = apiRef.current;
    const engine = api?.getDataEngine();
    if (!api || !studioReady.current || !engine?.applyTransaction) return; // flushed in onStudioReady
    const nextRows = buildRows(snapshotRef.current);
    const transactions = diffRows(appliedRows.current, nextRows);
    if (!transactions.length) return;
    appliedRows.current = nextRows;
    engine.applyTransaction(transactions).catch((error: unknown) => {
      // A transaction that doesn't fit the table (it drifted) is rejected whole: reload the data.
      console.warn('[ChamaPot] live update rejected, reloading the ledger', error);
      api.setProperty('data', studioData(snapshotRef.current, nextRows));
    });
  }, []);

  /** Toasts for what just happened: payments landing, payouts proposed, approvals cast. */
  const announce = useCallback(
    (previous: ChamaSnapshot, next: ChamaSnapshot) => {
      const member = (id: string) => next.members.find((m) => m.id === id);
      const cycle = currentCycle(next);
      const potLine = () => {
        if (!cycle) return '';
        const rows = next.contributions.filter((c) => c.cycle_id === cycle.id);
        const paid = rows.filter((c) => c.status === 'paid').reduce((t, c) => t + c.amount, 0);
        return `Pot now ${formatUsd(paid)} of ${formatUsd(cycle.target_amount)}`;
      };
      for (const c of next.contributions) {
        const before = previous.contributions.find((p) => p.id === c.id);
        const key = `paid:${c.id}`;
        if (c.status === 'paid' && before && before.status !== 'paid' && !announced.current.has(key)) {
          announced.current.add(key);
          const m = member(c.member_id);
          const via = c.method === 'paypal' ? 'via PayPal' : 'in cash, recorded on PayPal';
          push({ tone: 'payment', title: `${m?.full_name ?? 'A member'} paid ${formatUsd(c.amount)} ${via}`, detail: potLine() });
        }
      }
      for (const p of next.payouts) {
        const before = previous.payouts.find((q) => q.id === p.id);
        const name = member(p.recipient_member_id)?.full_name ?? 'the recipient';
        const key = `payout:${p.id}:${p.status}`;
        if (announced.current.has(key) || (before && before.status === p.status)) continue;
        announced.current.add(key);
        if (!before && p.status === 'proposed') {
          push({ tone: 'info', title: `Payout proposed: ${formatUsd(p.amount)} to ${name}`, detail: `Needs ${next.group.approvals_required} official approvals before PayPal sends it` });
        } else if (p.status === 'sent') {
          push({ tone: 'success', title: `PayPal Payouts is sending ${formatUsd(p.amount)} to ${name}` });
        } else if (p.status === 'succeeded') {
          push({ tone: 'success', title: `${name} received the ${formatUsd(p.amount)} pot`, detail: 'Confirmed by PayPal webhook' });
        } else if (p.status === 'failed') {
          push({ tone: 'error', title: `The payout to ${name} failed`, detail: p.paypal_status ?? 'PayPal reported a failure' });
        }
      }
      for (const a of next.approvals) {
        const key = `approval:${a.id}`;
        if (announced.current.has(key) || previous.approvals.some((b) => b.id === a.id)) continue;
        announced.current.add(key);
        const payout = next.payouts.find((p) => p.id === a.payout_id);
        const votes = next.approvals.filter((b) => b.payout_id === a.payout_id && b.decision === 'approve').length;
        push({
          tone: a.decision === 'approve' ? 'success' : 'error',
          title: `${member(a.member_id)?.full_name ?? 'An official'} ${a.decision === 'approve' ? 'approved' : 'rejected'} the payout`,
          detail: payout ? `${votes} of ${next.group.approvals_required} approvals for ${member(payout.recipient_member_id)?.full_name ?? 'the recipient'}` : undefined,
        });
      }
    },
    [push],
  );

  const commit = useCallback(
    (next: ChamaSnapshot) => {
      const previous = snapshotRef.current;
      if (next === previous) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setLastUpdate(new Date().toISOString());
      announce(previous, next);
      pushToStudio();
    },
    [announce, pushToStudio],
  );

  // Realtime carries row changes; a debounced re-read of the whole chama catches what it doesn't
  // (cycle status, members' turns) and corrects any drift.
  const resyncTimer = useRef<number | undefined>(undefined);
  const resync = useCallback(
    (delay = 700) => {
      window.clearTimeout(resyncTimer.current);
      resyncTimer.current = window.setTimeout(() => {
        fetchSnapshot(DEMO_GROUP_SLUG)
          .then(commit)
          .catch((error: unknown) => console.warn('[ChamaPot] could not refresh the ledger', error))
          .finally(() => setRefreshing(false));
      }, delay);
    },
    [commit],
  );
  useEffect(() => () => window.clearTimeout(resyncTimer.current), []);

  const live = useChamaRealtime(serverSnapshot.group.id, (change) => {
    commit(applyLiveChange(snapshotRef.current, change));
    resync();
  });

  // Without realtime (no publishable key, network blocked), fall back to polling the ledger.
  useEffect(() => {
    if (live !== 'offline') return;
    const id = window.setInterval(() => resync(0), 20_000);
    return () => window.clearInterval(id);
  }, [live, resync]);

  // Development only: rehearse the demo without PayPal. `__chamapot.pay('atieno')` folds a fake
  // INVOICING.INVOICE.PAID into the local snapshot (nothing is written anywhere), exercising the
  // same Live Data path a real webhook takes; `__chamapot.reset()` re-reads the real ledger.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const demo = {
      pay(handle: string, method: 'paypal' | 'cash_recorded' = 'paypal') {
        const s = snapshotRef.current;
        const member = s.members.find((m) => m.handle === handle);
        const contribution = member && s.contributions.find((c) => c.member_id === member.id && c.cycle_id === s.currentCycleId);
        if (!contribution) return `No current contribution for "${handle}"`;
        const paid: ChamaContribution = { ...contribution, status: 'paid', method, paid_at: new Date().toISOString() };
        commit({ ...s, contributions: s.contributions.map((c) => (c.id === paid.id ? paid : c)) });
        return `Simulated: ${member.full_name} paid`;
      },
      reset: () => resync(0),
      state: () => apiRef.current?.getState(),
    };
    (window as unknown as { __chamapot?: typeof demo }).__chamapot = demo;
    return () => {
      delete (window as unknown as { __chamapot?: typeof demo }).__chamapot;
    };
  }, [commit, resync]);

  // --- The treasurer's actions ----------------------------------------------------
  const [focus, setFocus] = useState<ChamaMember | null>(null);
  const drillThrough = useMemo<AgDrillThroughOptions<ChamaRegistry> | undefined>(
    () => (focus ? { filter: { field: { id: 'members.full_name' }, operator: 'equals', value: focus.full_name } } : undefined),
    [focus],
  );

  const remind = useCallback(
    async (contribution: ChamaContribution, member: ChamaMember) => {
      try {
        await postJson(`/api/chama/contributions/${contribution.id}/remind`, { actor: ACTING_OFFICIAL });
        push({
          tone: 'success',
          title: `PayPal reminder sent to ${member.full_name}`,
          detail: `PayPal re-sent invoice ${contribution.paypal_invoice_number ?? ''} to ${member.email}`.replace('  ', ' '),
        });
        resync();
      } catch (error) {
        push({ tone: 'error', title: `Couldn’t remind ${member.full_name.split(' ')[0]}`, detail: errorText(error) });
      }
    },
    [push, resync],
  );

  const recordCash = useCallback(
    async (contribution: ChamaContribution, member: ChamaMember) => {
      try {
        const result = await postJson<{ alreadyPaid?: boolean }>(`/api/chama/contributions/${contribution.id}/record-cash`, {
          recordedBy: ACTING_OFFICIAL,
        });
        push(
          result.alreadyPaid
            ? { tone: 'info', title: `${member.full_name} has already paid this cycle` }
            : {
                tone: 'success',
                title: `Cash recorded on ${member.full_name.split(' ')[0]}’s PayPal invoice`,
                detail: 'PayPal confirms with INVOICING.INVOICE.PAID; the pot fills as it lands.',
              },
        );
        resync(300);
      } catch (error) {
        push({ tone: 'error', title: `Couldn’t record ${member.full_name.split(' ')[0]}’s cash`, detail: errorText(error) });
      }
    },
    [push, resync],
  );

  const openStatement = useCallback(
    (member: ChamaMember, restoreFocus?: () => void) => {
      const api = apiRef.current;
      if (!api) return;
      const byId = (id: string) => snapshotRef.current.contributions.find((c) => c.id === id);
      api.createPopup<MemberStatementParams>({
        comp: MemberStatement,
        title: `${member.full_name} · statement`,
        movable: true,
        resizable: true,
        maximizable: true,
        width: Math.min(660, window.innerWidth - 24),
        height: Math.min(540, window.innerHeight - 96),
        minWidth: 280,
        minHeight: 320,
        compParams: ({ closePopup }) => ({
          member,
          snapshot: snapshotRef.current,
          closePopup,
          onRemind: (id) => {
            const c = byId(id);
            if (c) void remind(c, member);
          },
          onRecordCash: (id) => {
            const c = byId(id);
            closePopup();
            if (c) void recordCash(c, member);
          },
        }),
        closedCallback: () => restoreFocus?.(),
      });
    },
    [recordCash, remind],
  );

  const menuActions = useRef<ChamaMenuActions | null>(null);
  useEffect(() => {
    menuActions.current = {
      snapshot: () => snapshotRef.current,
      remind: (c, m) => void remind(c, m),
      recordCash: (c, m) => void recordCash(c, m),
      openStatement,
      focusMember: (m) => setFocus(m),
      goTo: (href) => router.push(href),
    };
  });
  // Studio reads the callback on every right-click; it forwards to the latest actions.
  const getContextMenuItems = useMemo(
    () =>
      chamaContextMenu({
        snapshot: () => snapshotRef.current,
        remind: (c, m) => menuActions.current?.remind(c, m),
        recordCash: (c, m) => menuActions.current?.recordCash(c, m),
        openStatement: (m, restore) => menuActions.current?.openStatement(m, restore),
        focusMember: (m) => menuActions.current?.focusMember(m),
        goTo: (href) => menuActions.current?.goTo(href),
      }),
    [],
  );

  // --- Saved dashboards (from the AG Studio starter) ------------------------------
  const [studioState, setStudioState] = useState<ChamaReportState | null>(null);
  const [history, setHistory] = useState<StudioHistory>(NO_HISTORY);
  const [mode, setMode] = useState<AgStudioMode>('view');
  const [dialog, setDialog] = useState<DashboardDialog>(null);

  const { reports } = store;
  const saved = findReport(reports, store.activeId) ?? reports[0];
  // Studio reads initialState once, when it is created; after that, its state is read from Studio.
  const [initialState] = useState(() => reportState.withFiltersPanelFor('view', saved.state));
  const state = studioState ?? initialState;
  // `ai` is read once, when Studio is created.
  const [ai] = useState(() => (aiModels?.length ? buildAiSafely(aiModels) : undefined));
  const [modules] = useState(() => (ai ? [AgStudioAiModule] : undefined));

  const load = (report: SavedReport, selectedPageId = report.state.selectedPageId, nextMode = mode) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState(reportState.withFiltersPanelFor(nextMode, { ...report.state, selectedPageId }));
    // Undo shouldn't step back into the previous dashboard.
    api.clearHistory();
    setStudioState(api.getState());
    setHistory(NO_HISTORY);
    setMode(nextMode);
    update((current) => ({ ...current, activeId: report.id }));
  };
  const updateState = (next: (current: ChamaReportState) => ChamaReportState) => {
    const api = apiRef.current;
    if (api) api.setState(next(api.getState()));
  };
  const changeMode = (next: AgStudioMode) => {
    updateState((s) => reportState.withFiltersPanelFor(next, s));
    setMode(next);
  };
  // Studio's AI panel lives in edit mode: open it on its own, with Compose and Data folded away,
  // so the Treasurer chat sits beside the live dashboard. The panels exist only once Studio is in
  // edit mode, so their state is set just after the mode change lands.
  const openAiPanel = useRef(false);
  const askTreasurer = () => {
    if (mode === 'edit') updateState((s) => reportState.withAiPanelOpen(s));
    else {
      openAiPanel.current = true;
      setMode('edit');
    }
  };
  useEffect(() => {
    if (mode !== 'edit' || !openAiPanel.current) return;
    openAiPanel.current = false;
    const api = apiRef.current;
    if (api) api.setState(reportState.withAiPanelOpen(api.getState()));
  }, [mode]);

  const save = () => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.getState();
    editReport(saved.id, (report) => ({
      ...report,
      pageTitles: pageTitlesFor({ pageTitles: report.pageTitles, state: current }),
      state: current,
      updatedAt: new Date().toISOString(),
    }));
    push({ tone: 'success', title: `Saved “${saved.name}”`, detail: 'Dashboards are saved in this browser.' });
  };
  const discard = () => load(saved, reportState.pageToSelect(saved.state, state.selectedPageId));
  // Anything that leaves the current dashboard or edit mode asks first when it has unsaved changes.
  const guard = (then: () => void) => {
    const api = apiRef.current;
    if (api && reportState.hasChanges(api.getState(), saved.state)) setDialog({ kind: 'unsaved', then });
    else then();
  };

  const openReport = (id: string) => {
    const report = findReport(reports, id);
    if (report && id !== saved.id) guard(() => load(report));
  };
  const createReport = (name: string) => {
    const report = blankReport(name);
    update((current) => upsert(current, report));
    load(report, report.state.selectedPageId, 'edit');
  };
  const duplicateReport = (id: string) =>
    guard(() => {
      const source = findReport(reports, id);
      if (!source) return;
      const copy = copyOf(source);
      update((current) => upsert(current, copy));
      load(copy);
    });
  const resetDemo = () => {
    update(initialReports);
    load(defaultReport(), undefined, 'view');
  };
  const deleteReport = (report: SavedReport) => {
    update((current) => remove(current, report.id));
    if (report.id !== saved.id) return;
    const { reports: next, activeId } = latest();
    load(findReport(next, activeId) ?? next[0]);
  };
  const renameReport = (id: string, name: string) => editReport(id, (report) => ({ ...report, name }));

  // Studio leaves page navigation to the host, and its state has no page names.
  const selectPage = (id: string, pageId: string) => {
    if (id === saved.id) updateState((s) => reportState.selectPage(s, pageId));
    else {
      const report = findReport(reports, id);
      if (report) guard(() => load(report, pageId));
    }
  };
  const addPage = () => {
    const id = newId('page');
    updateState((s) => reportState.addPage(s, id));
    if (mode !== 'edit') changeMode('edit');
    return id;
  };
  const removePage = (id: string) => updateState((s) => reportState.removePage(s, id));
  const renamePage = (id: string, title: string) =>
    editReport(saved.id, (report) => ({ ...report, pageTitles: { ...report.pageTitles, [id]: title } }));

  const isPhone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const editing = mode === 'edit';
  const pages = pagesFor({ pageTitles: saved.pageTitles, state });
  const group = groupLine(snapshot);

  return (
    <AppShell
      group={group}
      sidebar={
        <ReportsSidebar
          reports={reports}
          activeId={saved.id}
          activePages={pages}
          selectedPageId={state.selectedPageId}
          editing={editing}
          ready={studioState !== null}
          onSelectReport={openReport}
          onSelectPage={selectPage}
          onAddPage={() => (apiRef.current ? addPage() : undefined)}
          onRemovePage={removePage}
          onRenamePage={renamePage}
          onRenameReport={renameReport}
          onCreate={() => guard(() => setDialog({ kind: 'create' }))}
          onDuplicate={duplicateReport}
          onDelete={(id) => {
            const report = findReport(reports, id);
            if (report) setDialog({ kind: 'delete', report });
          }}
          onReset={() => setDialog({ kind: 'reset' })}
          onAskTreasurer={ai ? askTreasurer : undefined}
        />
      }
    >
      <ReportHeader
        group={group}
        pageTitle={pages.find((p) => p.id === state.selectedPageId)?.title}
        pages={pages}
        selectedPageId={state.selectedPageId}
        onSelectPage={(pageId) => selectPage(saved.id, pageId)}
        live={live}
        lastUpdate={lastUpdate}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          resync(0);
        }}
        onAskTreasurer={ai ? askTreasurer : undefined}
        focus={focus?.full_name ?? null}
        onClearFocus={() => setFocus(null)}
        editing={editing}
        pageIsEmpty={studioState !== null && !reportState.pageHasWidgets(state)}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => apiRef.current?.undo()}
        onRedo={() => apiRef.current?.redo()}
        onSave={save}
        onDiscard={discard}
        onEditingChange={(next) => (next ? changeMode('edit') : guard(() => changeMode('view')))}
      />

      <div className="min-h-0 flex-1">
        {snapshot.members.length > 0 ? (
          <AgStudioProvider licenseKey={licenseKey} modules={modules}>
            <AgStudio<ChamaRegistry>
              style={{ height: '100%', width: '100%' }}
              theme={chamaStudioTheme}
              layout={PAGE_LAYOUT}
              responsiveLayoutBreakpoints={BREAKPOINTS}
              panels={isPhone ? PHONE_PANELS : undefined}
              data={initial.data}
              widgets={chamaWidgets}
              ai={ai}
              aiToolDisplay={treasurerToolDisplay}
              initialState={initialState}
              mode={mode}
              drillThrough={drillThrough}
              getContextMenuItems={getContextMenuItems}
              onApiReady={(event) => {
                // Studio's events carry the default-registry API type; it is this Studio's API.
                apiRef.current = event.api as unknown as AgStudioApi<ChamaRegistry>;
              }}
              onStudioReady={(event) => {
                studioReady.current = true;
                setStudioState(event.api.getState());
                // Anything that changed while Studio was starting goes in now.
                pushToStudio();
              }}
              onStateUpdated={(event) => {
                const { undo, redo } = event.api.getHistory();
                setStudioState(event.state);
                setHistory({ canUndo: undo.length > 0, canRedo: redo.length > 0 });
              }}
            />
          </AgStudioProvider>
        ) : (
          <EmptyData />
        )}
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      <UnsavedChangesDialog
        open={dialog?.kind === 'unsaved'}
        reportName={saved.name}
        onCancel={() => setDialog(null)}
        onDiscard={() => {
          discard();
          if (dialog?.kind === 'unsaved') dialog.then();
          setDialog(null);
        }}
        onSave={() => {
          save();
          if (dialog?.kind === 'unsaved') dialog.then();
          setDialog(null);
        }}
      />
      <CreateReportDialog
        open={dialog?.kind === 'create'}
        onClose={() => setDialog(null)}
        onCreate={(name) => {
          setDialog(null);
          createReport(name);
        }}
      />
      <DeleteReportDialog
        report={dialog?.kind === 'delete' ? dialog.report : null}
        onCancel={() => setDialog(null)}
        onConfirm={(report) => {
          deleteReport(report);
          setDialog(null);
        }}
      />
      <ResetDemoDialog
        open={dialog?.kind === 'reset'}
        builtInName={defaultReport().name}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          resetDemo();
          setDialog(null);
        }}
      />
    </AppShell>
  );
}
