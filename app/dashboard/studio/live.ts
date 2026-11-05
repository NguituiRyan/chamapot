'use client';

// Live data for the dashboard. PayPal webhooks update Supabase on the server; Supabase realtime
// streams those row changes to the browser; this module folds each change into the snapshot, and
// the dashboard turns the new snapshot into AG Studio Live Data transactions (see diffRows in
// ./data.ts). Nothing here ever writes: the browser client uses the publishable key.

import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { ChamaApproval, ChamaContribution, ChamaEvent, ChamaPayout, ChamaSnapshot } from '@/lib/chama/types';

export type LiveStatus = 'connecting' | 'live' | 'offline';

export type LiveTable = 'chama_contributions' | 'chama_payouts' | 'chama_approvals' | 'chama_events';
export type LiveChange = { table: LiveTable; payload: RealtimePostgresChangesPayload<Record<string, unknown>> };

const GROUP_TABLES: LiveTable[] = ['chama_contributions', 'chama_payouts', 'chama_events'];

/**
 * Subscribes to postgres_changes for one chama. Contributions, payouts and events are filtered to
 * the group on the server; approvals have no group column, so they are matched to the group's
 * payouts when folded in. Returns the channel status for the "Live" indicator.
 */
export function useChamaRealtime(groupId: string, onChange: (change: LiveChange) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    let client: ReturnType<typeof supabaseBrowser>;
    try {
      client = supabaseBrowser();
    } catch (error) {
      console.warn('[ChamaPot] realtime disabled:', error instanceof Error ? error.message : error);
      queueMicrotask(() => setStatus('offline'));
      return;
    }
    // A torn-down channel still reports CLOSED; only the current one may set the status.
    let active = true;
    const channel = client.channel(`chamapot-dashboard-${groupId}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of GROUP_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `group_id=eq.${groupId}` }, (payload) =>
        handler.current({ table, payload }),
      );
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'chama_approvals' }, (payload) =>
      handler.current({ table: 'chama_approvals', payload }),
    );
    channel.subscribe((state) => {
      if (!active) return;
      if (state === 'SUBSCRIBED') setStatus('live');
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setStatus('offline');
    });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [groupId]);

  return status;
}

// --- Folding a change into the snapshot ---------------------------------------------

const NUMERIC: Partial<Record<LiveTable, string[]>> = {
  chama_contributions: ['amount', 'fine', 'days_late'],
  chama_payouts: ['amount'],
};

function coerce<T>(table: LiveTable, row: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of NUMERIC[table] ?? []) if (out[key] != null) out[key] = Number(out[key]);
  return out as T;
}

function upsert<T extends { id: string | number }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

/** The snapshot with one realtime change applied. Unknown or foreign rows leave it unchanged. */
export function applyLiveChange(snapshot: ChamaSnapshot, { table, payload }: LiveChange): ChamaSnapshot {
  const removed = payload.eventType === 'DELETE' ? (payload.old as { id?: string | number }).id : undefined;
  const row = payload.eventType === 'DELETE' ? null : (payload.new as Record<string, unknown>);
  switch (table) {
    case 'chama_contributions': {
      if (removed != null) return { ...snapshot, contributions: snapshot.contributions.filter((c) => c.id !== removed) };
      return row ? { ...snapshot, contributions: upsert(snapshot.contributions, coerce<ChamaContribution>(table, row)) } : snapshot;
    }
    case 'chama_payouts': {
      if (removed != null) return { ...snapshot, payouts: snapshot.payouts.filter((p) => p.id !== removed) };
      return row ? { ...snapshot, payouts: upsert(snapshot.payouts, coerce<ChamaPayout>(table, row)) } : snapshot;
    }
    case 'chama_approvals': {
      if (removed != null) return { ...snapshot, approvals: snapshot.approvals.filter((a) => a.id !== removed) };
      if (!row) return snapshot;
      const approval = coerce<ChamaApproval>(table, row);
      // Approvals carry no group id: keep only votes on this chama's payouts.
      if (!snapshot.payouts.some((p) => p.id === approval.payout_id)) return snapshot;
      return { ...snapshot, approvals: upsert(snapshot.approvals, approval) };
    }
    case 'chama_events': {
      if (removed != null) return { ...snapshot, events: snapshot.events.filter((e) => e.id !== removed) };
      if (!row) return snapshot;
      const event = coerce<ChamaEvent>(table, row);
      return { ...snapshot, events: [event, ...snapshot.events.filter((e) => e.id !== event.id)].slice(0, 100) };
    }
  }
}

/** The whole chama again from the server, for changes realtime doesn't carry (cycles, members). */
export async function fetchSnapshot(slug: string, signal?: AbortSignal): Promise<ChamaSnapshot> {
  const response = await fetch(`/api/chama/snapshot?slug=${encodeURIComponent(slug)}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
  return (await response.json()) as ChamaSnapshot;
}
