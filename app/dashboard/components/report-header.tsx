'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { LiveStatus } from '../studio/live';
import { APP_LINKS, type ShellGroup } from './app-shell';
import { EditIcon, EyeIcon, RedoIcon, RefreshIcon, UndoIcon } from './ui/icons';
import { Button, IconButton } from './ui/ui';
import type { ReportPage } from '../page-titles';

// The bar above Studio: which page you're on, whether PayPal webhooks are streaming in, and the
// Edit / Save / Discard controls. On phones it also carries the group, the page tabs and the
// links that live in the top bar and sidebar on wider screens.
export function ReportHeader({
  group,
  pageTitle,
  pages,
  selectedPageId,
  onSelectPage,
  live,
  lastUpdate,
  refreshing,
  onRefresh,
  onAskTreasurer,
  focus,
  onClearFocus,
  editing,
  pageIsEmpty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onDiscard,
  onEditingChange,
}: {
  group: ShellGroup;
  pageTitle?: string;
  pages: ReportPage[];
  selectedPageId: string;
  onSelectPage: (pageId: string) => void;
  live: LiveStatus;
  lastUpdate: string;
  refreshing: boolean;
  onRefresh: () => void;
  /** Opens the Claude Treasurer in Studio's AI panel; omitted when AI isn't configured. */
  onAskTreasurer?: () => void;
  focus: string | null;
  onClearFocus: () => void;
  editing: boolean;
  pageIsEmpty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  return (
    <div className="shrink-0 border-b border-[var(--cp-line)] bg-white">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 pb-3 pt-3 md:px-6 md:pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-[var(--cp-muted)] md:hidden">
            {group.name} · {group.cycleLine}
          </p>
          <p className="hidden truncate text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cp-muted)] md:block">Treasurer dashboard</p>
          <h1 className="cp-display truncate text-[26px] leading-tight text-[var(--cp-ink)] md:text-[28px]">{pageTitle}</h1>
          <Freshness live={live} lastUpdate={lastUpdate} refreshing={refreshing} onRefresh={onRefresh} />
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {editing && pageIsEmpty && (
            <p className="mr-2 text-sm text-[var(--cp-muted)]">
              Drag a widget from <span className="font-semibold text-[var(--cp-ink)]">Compose</span> to start.
            </p>
          )}
          {editing && (
            <>
              <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
                <UndoIcon />
              </IconButton>
              <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
                <RedoIcon />
              </IconButton>
              <span className="mx-1 h-6 w-px bg-[var(--cp-line)]" aria-hidden />
              <Button onClick={onDiscard} size="sm">
                Discard
              </Button>
              <Button variant="primary" size="sm" onClick={onSave}>
                Save
              </Button>
            </>
          )}
          {onAskTreasurer && (
            <button
              type="button"
              onClick={onAskTreasurer}
              className="cp-btn cp-btn-sm border-[var(--cp-marigold)] bg-[var(--cp-marigold-soft)] text-[var(--cp-ink)] hover:border-[var(--cp-marigold)] hover:bg-[#fbe6c2]"
            >
              <Sparkles className="size-4 text-[#B7791F]" aria-hidden /> Ask the Treasurer
            </button>
          )}
          {editing ? (
            <Button variant="ghost" size="sm" onClick={() => onEditingChange(false)}>
              <EyeIcon className="size-4" /> View
            </Button>
          ) : (
            <Button size="sm" onClick={() => onEditingChange(true)}>
              <EditIcon className="size-4" /> Edit dashboard
            </Button>
          )}
        </div>
      </div>

      {focus && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--cp-line-soft)] bg-[var(--cp-marigold-soft)] px-4 py-2 text-sm md:px-6">
          <span className="font-semibold text-[var(--cp-ink)]">Drill-through: {focus}</span>
          <span className="text-[var(--cp-muted)]">Every widget shows only her contributions and payouts.</span>
          <button type="button" onClick={onClearFocus} className="cp-btn cp-btn-sm ml-auto">
            Show the whole chama
          </button>
        </div>
      )}

      {/* Phones: page tabs and app links, which live in the sidebar and top bar on wider screens. */}
      <div className="md:hidden">
        <div className="cp-tabs flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Dashboard pages">
          {pages.map((page) => {
            const selected = page.id === selectedPageId;
            return (
              <button
                key={page.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelectPage(page.id)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  selected
                    ? 'border-[var(--cp-pot)] bg-[var(--cp-pot)] text-white'
                    : 'border-[var(--cp-line)] bg-white text-[var(--cp-ink)]'
                }`}
              >
                {page.title}
              </button>
            );
          })}
        </div>
        <nav className="flex gap-4 border-t border-[var(--cp-line-soft)] px-4 py-2 text-sm" aria-label="ChamaPot">
          {APP_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold text-[var(--cp-pot-deep)]">
              {link.label} →
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

// --- Live status and freshness ------------------------------------------------------

const MINUTE_MS = 60_000;
let now = 0;
const subscribeNow = (listener: () => void) => {
  now = Date.now();
  const id = setInterval(() => {
    now = Date.now();
    listener();
  }, 20_000);
  return () => clearInterval(id);
};

function relativeTime(iso: string, at: number) {
  const minutes = Math.floor((at - Date.parse(iso)) / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString('en-GB');
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  live: 'Live · PayPal webhooks',
  connecting: 'Connecting to PayPal webhooks…',
  offline: 'Live updates paused',
};

function Freshness({ live, lastUpdate, refreshing, onRefresh }: { live: LiveStatus; lastUpdate: string; refreshing: boolean; onRefresh: () => void }) {
  const at = useSyncExternalStore(subscribeNow, () => now, () => 0);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--cp-muted)]">
      <span
        className="inline-flex items-center gap-2 rounded-full border border-[var(--cp-line)] bg-[var(--cp-cream)] px-2.5 py-0.5 text-xs font-semibold text-[var(--cp-ink)]"
        role="status"
        title={live === 'live' ? 'Supabase realtime is streaming PayPal webhook updates into the dashboard' : undefined}
      >
        <span className="cp-live-dot" data-state={live} aria-hidden />
        {LIVE_LABEL[live]}
      </span>
      <span className="text-xs">{refreshing ? 'Refreshing…' : `Updated ${at ? relativeTime(lastUpdate, at) : 'just now'}`}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh from the ledger"
        title="Refresh from the ledger"
        className="cp-icon-btn size-7"
      >
        <RefreshIcon className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
