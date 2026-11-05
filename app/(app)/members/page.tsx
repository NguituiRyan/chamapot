import type { Metadata } from 'next';
import Link from 'next/link';
import { Banknote, ChevronRight, CreditCard, HandCoins, MapPin, ShieldCheck } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { ROLE_LABEL, contributionFor, currentCycle, cycleProgress, isOfficial, turnCycle } from '@/components/chama';
import { loadDemoSnapshot } from '@/components/data';
import { formatUsd, ordinal } from '@/components/format';
import { ErrorState } from '@/components/states';
import { Pill, StatusPill } from '@/components/status-pill';
import { Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage() {
  const result = await loadDemoSnapshot();
  if (!result.ok) return <ErrorState message={result.error} />;
  const s = result.snapshot;
  const cycle = currentCycle(s);
  const progress = cycleProgress(s, cycle);
  const countries = new Set(s.members.map((m) => m.country)).size;
  const paypalCount = s.members.filter((m) => m.pays_via === 'paypal').length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={s.group.name}
        title="Members"
        description={`${s.members.length} members in ${countries} countries. ${paypalCount} pay their PayPal invoice from abroad; ${
          s.members.length - paypalCount
        } pay cash at the Nairobi meeting, recorded on the same PayPal invoice.`}
      />

      {progress ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="font-semibold text-ink">
            Cycle {progress.cycle.number} · {progress.cycle.label}:
          </span>
          {progress.paid.length} of {progress.contributions.length} paid ·{' '}
          {formatUsd(progress.collected, { whole: true })} of {formatUsd(progress.target, { whole: true })} collected
        </p>
      ) : null}

      <Card as="div" className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-4 border-b border-line bg-sunken px-5 py-2.5 text-xs font-medium text-muted md:grid">
          <span>Member</span>
          <span>Pays via</span>
          <span>Turn</span>
          <span>{cycle ? `${cycle.label}` : 'This cycle'}</span>
          <span className="sr-only">Open</span>
        </div>
        <ul className="divide-y divide-line">
          {s.members.map((m) => {
            const turn = turnCycle(s, m.id);
            const c = cycle ? contributionFor(s, cycle.id, m.id) : null;
            const receivingNow = cycle && cycle.recipient_member_id === m.id;
            return (
              <li key={m.id}>
                <Link
                  href={`/members/${m.handle}`}
                  className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 transition-colors hover:bg-pot-soft/40 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:gap-4"
                >
                  <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
                    <Avatar name={m.full_name} color={m.avatar_color} size="md" decorative />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                        <span className="truncate">{m.full_name}</span>
                        {isOfficial(m) ? (
                          <Pill tone="pot" icon={ShieldCheck} className="!py-0">
                            {ROLE_LABEL[m.role]}
                          </Pill>
                        ) : null}
                      </p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted">
                        <MapPin className="size-3 shrink-0" aria-hidden />
                        {m.city}, {m.country}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="row-span-2 size-4 self-center text-muted transition-transform group-hover:translate-x-0.5 md:order-last md:row-span-1" aria-hidden />
                  <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-12 text-sm md:contents">
                    <span className="inline-flex items-center gap-1.5 text-ink md:pl-0">
                      {m.pays_via === 'paypal' ? (
                        <CreditCard className="size-4 text-pot-ink" aria-hidden />
                      ) : (
                        <Banknote className="size-4 text-marigold-ink" aria-hidden />
                      )}
                      {m.pays_via === 'paypal' ? 'PayPal invoice' : 'Cash at meeting'}
                    </span>
                    <span className="tabular text-muted md:text-ink">
                      {ordinal(m.rotation_position)} turn
                      {turn ? <span className="text-muted"> · {turn.label.split(' ')[0]}</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {receivingNow ? (
                        <Pill tone="marigold" icon={HandCoins}>
                          Receives
                        </Pill>
                      ) : null}
                      {c ? <StatusPill status={c.status} /> : <span className="text-xs text-muted">No contribution</span>}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
