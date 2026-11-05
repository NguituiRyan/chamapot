'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BellRing,
  Bot,
  CalendarClock,
  HandCoins,
  Landmark,
  Receipt,
  ScrollText,
  ShieldCheck,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { ROLE_LABEL } from '@/components/chama';
import { formatDateTime, relativeTime } from '@/components/format';
import { EmptyState } from '@/components/states';
import { Card } from '@/components/ui';
import type { ChamaEvent, ChamaMember } from '@/lib/chama/types';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Person = Pick<ChamaMember, 'handle' | 'full_name' | 'role' | 'avatar_color'>;
type Filter = 'all' | 'paypal' | 'agent' | 'officials' | 'rules';
type Live = 'connecting' | 'live' | 'offline';

const KIND_ICON: Record<string, LucideIcon> = {
  contribution: Receipt,
  payout: HandCoins,
  approval: BadgeCheck,
  reminder: BellRing,
  rules: ScrollText,
  cycle: CalendarClock,
  webhook: Webhook,
  agent: Bot,
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'agent', label: 'Treasurer agent' },
  { id: 'officials', label: 'Officials' },
  { id: 'rules', label: 'Rules' },
];

const isPayPal = (e: ChamaEvent) => e.actor === 'paypal-webhook' || e.kind === 'webhook';
const isAgent = (e: ChamaEvent) => e.actor === 'treasurer-agent' || e.kind === 'agent';

function matches(e: ChamaEvent, f: Filter) {
  switch (f) {
    case 'all':
      return true;
    case 'paypal':
      return isPayPal(e);
    case 'agent':
      return isAgent(e);
    case 'rules':
      return e.kind === 'rules';
    case 'officials':
      return !isPayPal(e) && !isAgent(e) && e.actor !== 'system';
  }
}

function dayLabel(iso: string, now: number) {
  const fmt = (t: number | string) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const d = fmt(iso);
  if (d === fmt(now)) return 'Today';
  if (d === fmt(now - 86_400_000)) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long' });
}

/** A few useful payload facts, when the writer included them. */
function payloadChips(p: ChamaEvent['payload']): string[] {
  if (!p) return [];
  const out: string[] = [];
  const pick = (...keys: string[]) => keys.map((k) => p[k]).find((v) => typeof v === 'string' || typeof v === 'number');
  const type = pick('event_type', 'eventType');
  const invoice = pick('invoice_number', 'invoiceNumber');
  const amount = pick('amount');
  const batch = pick('paypal_batch_id', 'batchId');
  if (type) out.push(String(type));
  if (invoice) out.push(`Invoice ${invoice}`);
  if (amount != null) out.push(typeof amount === 'number' ? `$${amount.toFixed(2)}` : String(amount));
  if (batch) out.push(`Batch ${batch}`);
  return out.slice(0, 3);
}

export function ActivityFeed({
  groupId,
  initialEvents,
  members,
}: {
  groupId: string;
  initialEvents: ChamaEvent[];
  members: Person[];
}) {
  const [events, setEvents] = useState<ChamaEvent[]>(initialEvents);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [live, setLive] = useState<Live>('connecting');
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState('');
  const timers = useRef<number[]>([]);

  const people = useMemo(() => new Map(members.map((m) => [m.handle, m])), [members]);
  const treasurer = members.find((m) => m.role === 'treasurer');

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const ingest = (e: ChamaEvent) => {
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [e, ...prev].slice(0, 200)));
      setFresh((prev) => new Set(prev).add(e.id));
      setNow(Date.now());
      setAnnounce(`${isPayPal(e) ? 'PayPal webhook' : 'New activity'}: ${e.summary}`);
      timers.current.push(
        window.setTimeout(
          () =>
            setFresh((prev) => {
              const next = new Set(prev);
              next.delete(e.id);
              return next;
            }),
          6000,
        ),
      );
    };
    // Dev-only rehearsal hook: window.__chamapotActivity({ ...event }) animates an event in without touching the DB.
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __chamapotActivity?: (e: Partial<ChamaEvent>) => void }).__chamapotActivity = (e) =>
        ingest({
          id: Date.now(),
          group_id: groupId,
          kind: 'contribution',
          actor: 'paypal-webhook',
          summary: 'Test event',
          payload: null,
          created_at: new Date().toISOString(),
          ...e,
        });
    }

    let client: ReturnType<typeof supabaseBrowser>;
    try {
      client = supabaseBrowser();
    } catch {
      void Promise.resolve().then(() => setLive('offline'));
      return;
    }
    let disposed = false;
    // Unique topic per mount: React dev double-mounts effects, and a reused topic would bind to the closing channel.
    const channel = client
      .channel(`activity-${groupId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chama_events', filter: `group_id=eq.${groupId}` },
        (payload) => ingest(payload.new as ChamaEvent),
      )
      .subscribe((status, err) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') setLive('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (err) console.warn('[activity] realtime', status, err.message);
          setLive('offline');
        }
      });
    const pending = timers.current;
    return () => {
      disposed = true;
      pending.forEach((t) => window.clearTimeout(t));
      client.removeChannel(channel);
    };
  }, [groupId]);

  const visible = events.filter((e) => matches(e, filter));
  const groups: { day: string; items: ChamaEvent[] }[] = [];
  for (const e of visible) {
    const day = dayLabel(e.created_at, now);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const webhookCount = events.filter(isPayPal).length;

  function actorView(e: ChamaEvent): { label: string; detail?: string; person?: Person } {
    if (isPayPal(e)) return { label: 'PayPal webhook', detail: 'Signature verified' };
    if (e.actor === 'treasurer-agent') return { label: 'Treasurer agent', detail: 'Claude' };
    if (e.actor === 'system') return { label: 'ChamaPot', detail: 'Server' };
    if (e.actor === 'treasurer' && treasurer) return { label: treasurer.full_name, detail: 'Treasurer', person: treasurer };
    const p = people.get(e.actor);
    if (p) return { label: p.full_name, detail: ROLE_LABEL[p.role], person: p };
    return { label: e.actor };
  }

  return (
    <div className="min-w-0">
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter activity">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-sm font-semibold transition-colors ${
                filter === f.id ? 'bg-ink text-cream' : 'border border-line bg-card text-muted hover:text-ink'
              }`}
            >
              {f.label}
              {f.id === 'paypal' && webhookCount > 0 ? <span className="ml-1 opacity-70">{webhookCount}</span> : null}
            </button>
          ))}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            live === 'live' ? 'bg-pot-soft text-pot-ink' : live === 'offline' ? 'bg-clay-soft text-clay' : 'bg-sunken text-muted'
          }`}
          role="status"
        >
          <span className="relative flex size-2">
            {live === 'live' ? <span className="absolute inline-flex size-full animate-live rounded-full bg-pot" /> : null}
            <span
              className={`relative inline-flex size-2 rounded-full ${live === 'live' ? 'bg-pot' : live === 'offline' ? 'bg-clay' : 'bg-muted'}`}
            />
          </span>
          {live === 'live' ? 'Live' : live === 'offline' ? 'Offline: refresh to update' : 'Connecting…'}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Activity} title={filter === 'all' ? 'No activity yet' : 'Nothing here yet'}>
          {filter === 'all'
            ? 'PayPal webhooks, reminders, votes and payouts appear here the moment they happen.'
            : 'Nothing of this kind has happened yet. It will appear here live.'}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted" suppressHydrationWarning>
                {g.day}
              </h2>
              <ol className="space-y-2">
                {g.items.map((e) => {
                  const a = actorView(e);
                  const paypal = isPayPal(e);
                  const agent = isAgent(e);
                  const Icon = paypal ? Webhook : (KIND_ICON[e.kind] ?? (e.actor === 'treasurer' ? Landmark : Activity));
                  const isFresh = fresh.has(e.id);
                  const chips = payloadChips(e.payload);
                  return (
                    <Card
                      as="li"
                      key={e.id}
                      className={`relative flex gap-3 p-3.5 sm:p-4 ${isFresh ? 'animate-feed-in' : ''} ${
                        paypal ? 'border-l-[3px] border-l-pot' : agent ? 'border-l-[3px] border-l-marigold' : ''
                      }`}
                    >
                      {isFresh ? <span className="pointer-events-none absolute inset-0 animate-flash rounded-[14px]" aria-hidden /> : null}
                      <span
                        className={`relative flex size-10 shrink-0 items-center justify-center rounded-[12px] ${
                          paypal ? 'bg-pot text-white' : agent ? 'bg-marigold-soft text-marigold-ink' : 'bg-sunken text-ink'
                        }`}
                      >
                        <Icon className="size-5" aria-hidden />
                        {a.person ? (
                          <Avatar
                            name={a.person.full_name}
                            color={a.person.avatar_color}
                            size="sm"
                            decorative
                            className="absolute -bottom-1.5 -right-1.5 !size-5 !text-[8px]"
                          />
                        ) : null}
                      </span>
                      <div className="relative min-w-0 flex-1">
                        <p className="text-[15px] leading-snug text-ink">{e.summary}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span className="font-semibold text-ink">{a.label}</span>
                          {paypal ? (
                            <span className="inline-flex items-center gap-1 font-medium text-pot-ink">
                              <ShieldCheck className="size-3.5" aria-hidden />
                              {a.detail}
                            </span>
                          ) : a.detail ? (
                            <span>{a.detail}</span>
                          ) : null}
                          <span aria-hidden>·</span>
                          <time dateTime={e.created_at} title={formatDateTime(e.created_at)} suppressHydrationWarning>
                            {relativeTime(e.created_at, now)}
                          </time>
                        </p>
                        {chips.length ? (
                          <p className="mt-2 flex flex-wrap gap-1.5">
                            {chips.map((c) => (
                              <code key={c} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] text-muted">
                                {c}
                              </code>
                            ))}
                          </p>
                        ) : null}
                      </div>
                      {isFresh ? (
                        <span className="relative self-start rounded-full bg-marigold px-2 py-0.5 text-[11px] font-bold text-[#3b2400]">
                          New
                        </span>
                      ) : null}
                    </Card>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
