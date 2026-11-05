import Link from 'next/link';
import { CircleCheck, Clock } from 'lucide-react';
import type { ChamaSnapshot } from '@/lib/chama/types';
import { Avatar } from './avatar';
import { currentCycle, cycleProgress, memberMap } from './chama';
import { firstName, formatDate, formatKes, formatUsd } from './format';
import { PotRing } from './pot-ring';
import { Card } from './ui';

/** Live dot + label, used wherever data streams in. */
export function LiveBadge({ label = 'Live' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pot-soft px-2.5 py-1 text-xs font-semibold text-pot-ink">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-live rounded-full bg-pot" />
        <span className="relative inline-flex size-2 rounded-full bg-pot" />
      </span>
      {label}
    </span>
  );
}

/**
 * The current pot at a glance: collected vs target, who has paid, who receives. Server-rendered from
 * the snapshot (landing hero + approvals when nothing is proposed yet).
 */
export function PotStatusCard({ snapshot, compact = false }: { snapshot: ChamaSnapshot; compact?: boolean }) {
  const progress = cycleProgress(snapshot, currentCycle(snapshot));
  const rate = snapshot.group.kes_per_usd;

  if (!progress) {
    return (
      <Card className="p-6">
        <p className="font-display text-lg font-semibold text-ink">{snapshot.group.name}</p>
        <p className="mt-2 text-sm text-muted">No cycle is collecting right now. The next one opens on the 1st.</p>
      </Card>
    );
  }

  const { cycle, recipient, contributions, paid, collected, target, pct, outstanding } = progress;
  const members = memberMap(snapshot);
  const ringLabel = `${formatUsd(collected, { whole: true })} of ${formatUsd(target, { whole: true })} collected`;

  return (
    <Card className="overflow-hidden" aria-labelledby="pot-card-title">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p id="pot-card-title" className="truncate font-display text-lg font-semibold text-ink">
            {snapshot.group.name}
          </p>
          <p className="text-sm text-muted">
            Cycle {cycle.number} · {cycle.label}
          </p>
        </div>
        <LiveBadge />
      </div>

      <div className="flex flex-col items-center gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <PotRing pct={pct} label={ringLabel} size={compact ? 128 : 148}>
          <div>
            <p className="tabular font-display text-3xl font-semibold leading-none text-ink">
              {formatUsd(collected, { whole: true })}
            </p>
            <p className="tabular mt-1 text-xs text-muted">of {formatUsd(target, { whole: true })}</p>
          </div>
        </PotRing>
        <dl className="grid w-full grid-cols-2 gap-3 text-sm sm:grid-cols-1">
          <div className="rounded-[10px] bg-sunken px-3 py-2">
            <dt className="text-xs text-muted">Paid</dt>
            <dd className="tabular font-semibold text-ink">
              {paid.length} of {contributions.length} members
            </dd>
          </div>
          <div className="rounded-[10px] bg-sunken px-3 py-2">
            <dt className="text-xs text-muted">In shillings</dt>
            <dd className="tabular font-semibold text-ink">≈ {formatKes(collected, rate)}</dd>
          </div>
          <div className="col-span-2 rounded-[10px] bg-sunken px-3 py-2 sm:col-span-1">
            <dt className="text-xs text-muted">Contributions due</dt>
            <dd className="font-semibold text-ink">{formatDate(cycle.due_on, { weekday: true, year: false })}</dd>
          </div>
        </dl>
      </div>

      <ul className="flex flex-wrap gap-1.5 px-5" aria-label="Contributions this cycle">
        {contributions.map((c) => {
          const m = members.get(c.member_id);
          if (!m) return null;
          const done = c.status === 'paid';
          return (
            <li key={c.id} className="relative" title={`${m.full_name}: ${done ? 'paid' : 'not yet paid'}`}>
              <Avatar name={m.full_name} color={m.avatar_color} size="sm" decorative className={done ? '' : 'opacity-35 grayscale'} />
              <span className="sr-only">
                {m.full_name}: {done ? 'paid' : 'not yet paid'}
              </span>
              {done ? (
                <CircleCheck className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-card text-success" aria-hidden />
              ) : (
                <Clock className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-card text-clay" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>

      {outstanding.length > 0 ? (
        <p className="px-5 pt-3 text-sm text-muted">
          Waiting on{' '}
          {outstanding
            .map((c) => members.get(c.member_id))
            .filter((m) => !!m)
            .map((m, i, all) => (
              <span key={m!.id}>
                <Link href={`/members/${m!.handle}`} className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-pot">
                  {firstName(m!.full_name)}
                </Link>
                {i < all.length - 2 ? ', ' : i === all.length - 2 ? ' and ' : ''}
              </span>
            ))}
          .
        </p>
      ) : (
        <p className="px-5 pt-3 text-sm font-medium text-success">Everyone has paid. The pot is full.</p>
      )}

      {recipient ? (
        <div className="mx-5 mb-5 mt-4 flex items-center gap-3 rounded-[12px] border border-marigold/40 bg-marigold-soft px-3 py-3">
          <Avatar name={recipient.full_name} color={recipient.avatar_color} size="md" decorative />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-ink">
              {recipient.full_name} receives this pot
            </p>
            <p className="text-marigold-ink">
              Turn {recipient.rotation_position} of {snapshot.members.length} · {recipient.city} ·{' '}
              {formatDate(cycle.payout_on, { weekday: true, year: false })}
            </p>
          </div>
        </div>
      ) : (
        <div className="h-5" />
      )}
    </Card>
  );
}
