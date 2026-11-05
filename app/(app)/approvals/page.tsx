import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, CalendarClock, CircleDashed, History, LayoutDashboard } from 'lucide-react';
import { getActingMember } from '@/components/acting-as';
import { Avatar } from '@/components/avatar';
import { activePayout, currentCycle, cycleOf, cycleProgress, isOfficial, memberMap, officials } from '@/components/chama';
import { loadDemoSnapshot } from '@/components/data';
import { firstName, formatDate, formatUsd } from '@/components/format';
import { Money } from '@/components/money';
import { PotStatusCard } from '@/components/pot-status-card';
import { EmptyState, ErrorState } from '@/components/states';
import { PayoutStatusPill, StatusPill } from '@/components/status-pill';
import { Card, PageHeader, SectionTitle, buttonClass } from '@/components/ui';
import { ApprovalPanel } from './approval-panel';
import { ProposeButton } from './propose-button';

export const metadata: Metadata = { title: 'Approvals' };

export default async function ApprovalsPage() {
  const result = await loadDemoSnapshot();
  if (!result.ok) return <ErrorState message={result.error} />;
  const s = result.snapshot;
  const acting = await getActingMember(s.members);
  const members = memberMap(s);
  const payout = activePayout(s);
  const offs = officials(s);
  const history = s.payouts
    .filter((p) => p.id !== payout?.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const progress = cycleProgress(s, currentCycle(s));
  const ruleBy = (key: string) => s.rules.find((r) => r.key === key) ?? null;

  const payoutCycle = payout ? cycleOf(s, payout.cycle_id) : null;
  const recipient = payout ? members.get(payout.recipient_member_id) ?? null : null;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={s.group.name}
        title="Payout approvals"
        description={`The treasurer agent proposes; ${s.group.approvals_required} officials approve; then the server sends the pot with PayPal Payouts. The recipient can never approve her own pot.`}
      />

      {payout && payoutCycle && recipient ? (
        <ApprovalPanel
          key={payout.id}
          groupId={s.group.id}
          approvalsRequired={s.group.approvals_required}
          kesPerUsd={s.group.kes_per_usd}
          memberCount={s.members.length}
          payout={payout}
          cycle={{ number: payoutCycle.number, label: payoutCycle.label, payout_on: payoutCycle.payout_on }}
          recipient={recipient}
          officials={offs}
          votes={s.approvals.filter((a) => a.payout_id === payout.id)}
          acting={acting}
          rules={{
            rotation: ruleBy('rotation'),
            approval: ruleBy('payout_approval'),
          }}
        />
      ) : (
        <section aria-labelledby="no-proposal" className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Card className="p-5 sm:p-6">
            <span className="flex size-11 items-center justify-center rounded-[12px] bg-marigold-soft text-marigold-ink">
              <CircleDashed className="size-5" aria-hidden />
            </span>
            <h2 id="no-proposal" className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
              Nothing to approve yet
            </h2>
            {progress ? (
              progress.outstanding.length > 0 ? (
                <>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">
                    The pot for {progress.cycle.label} has {formatUsd(progress.collected, { whole: true })} of{' '}
                    {formatUsd(progress.target, { whole: true })}. When the last contribution lands, the treasurer agent
                    proposes paying {progress.recipient?.full_name ?? 'the scheduled member'} and the officials vote here.
                  </p>
                  <h3 className="mt-5 text-sm font-semibold text-ink">Still needed</h3>
                  <ul className="mt-2 divide-y divide-line rounded-[12px] border border-line">
                    {progress.outstanding.map((c) => {
                      const m = members.get(c.member_id);
                      if (!m) return null;
                      return (
                        <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                          <Avatar name={m.full_name} color={m.avatar_color} size="sm" decorative />
                          <div className="min-w-0 flex-1">
                            <Link href={`/members/${m.handle}`} className="text-sm font-semibold text-ink hover:text-pot-ink">
                              {m.full_name}
                            </Link>
                            <p className="text-xs text-muted">
                              {m.pays_via === 'cash' ? 'Cash at the meeting' : 'PayPal invoice'} · {m.city}
                            </p>
                          </div>
                          <span className="tabular hidden text-sm font-semibold text-ink sm:inline">{formatUsd(c.amount)}</span>
                          <StatusPill status={c.status} />
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">
                    The pot for {progress.cycle.label} is full. The treasurer agent proposes the payout to{' '}
                    {progress.recipient?.full_name ?? 'the scheduled member'} next; you can ask it from the dashboard, or
                    have it propose now.
                  </p>
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    {isOfficial(acting) ? <ProposeButton slug={s.group.slug} /> : null}
                    <Link href="/dashboard" className={buttonClass('secondary')}>
                      <LayoutDashboard className="size-4" aria-hidden />
                      Ask the treasurer on the dashboard
                    </Link>
                  </div>
                </>
              )
            ) : (
              <p className="mt-2 text-[15px] text-muted">No cycle is collecting right now.</p>
            )}
            <p className="mt-6 flex items-start gap-2 rounded-[10px] bg-sunken px-3 py-2.5 text-sm text-muted">
              <Bot className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
              The agent can only propose the member scheduled for the cycle, for exactly what was collected. The server
              refuses anything else.
            </p>
          </Card>
          <PotStatusCard snapshot={s} />
        </section>
      )}

      <section aria-labelledby="history-title">
        <SectionTitle id="history-title" aside={`${history.length} payout${history.length === 1 ? '' : 's'}`}>
          Payout history
        </SectionTitle>
        {history.length === 0 ? (
          <EmptyState icon={History} title="No payouts yet">
            Every payout, with its approvals and PayPal reference, will be listed here.
          </EmptyState>
        ) : (
          <Card as="div" className="overflow-hidden">
            <ul className="divide-y divide-line">
              {history.map((p) => {
                const m = members.get(p.recipient_member_id);
                const c = cycleOf(s, p.cycle_id);
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {m ? <Avatar name={m.full_name} color={m.avatar_color} size="md" decorative /> : null}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {m ? (
                            <Link href={`/members/${m.handle}`} className="hover:text-pot-ink">
                              {m.full_name}
                            </Link>
                          ) : (
                            'Unknown member'
                          )}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-muted">
                          <CalendarClock className="size-3.5" aria-hidden />
                          Cycle {c?.number} · {c?.label} · {formatDate(p.completed_at ?? p.sent_at ?? p.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Money usd={p.amount} kesPerUsd={s.group.kes_per_usd} size="sm" stacked className="text-right" />
                      <PayoutStatusPill status={p.status} />
                    </div>
                    <p className="w-full text-xs text-muted sm:pl-12">
                      {[
                        p.is_seed ? `${p.reason ?? 'Paid at the meeting'} (history from before ChamaPot)` : p.reason,
                        (() => {
                          const yes = s.approvals
                            .filter((v) => v.payout_id === p.id && v.decision === 'approve')
                            .map((v) => members.get(v.member_id))
                            .filter((v) => !!v)
                            .map((v) => firstName(v!.full_name));
                          return yes.length ? `Approved by ${yes.join(' and ')}` : null;
                        })(),
                        p.paypal_batch_id ? `PayPal batch ${p.paypal_batch_id}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
