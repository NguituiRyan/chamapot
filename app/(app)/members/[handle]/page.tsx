import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Banknote,
  CalendarClock,
  CreditCard,
  ExternalLink,
  HandCoins,
  MapPin,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { METHOD_LABEL, ROLE_LABEL, cycleOf, isOfficial, turnCycle } from '@/components/chama';
import { loadDemoSnapshot } from '@/components/data';
import { firstName, formatDate, formatKes, formatUsd, ordinal } from '@/components/format';
import { Money } from '@/components/money';
import { EmptyState, ErrorState } from '@/components/states';
import { Pill, PayoutStatusPill, StatusPill } from '@/components/status-pill';
import { Card, SectionTitle, buttonClass } from '@/components/ui';
import { PayFineButton } from './pay-fine-button';

export async function generateMetadata(props: PageProps<'/members/[handle]'>): Promise<Metadata> {
  const { handle } = await props.params;
  const result = await loadDemoSnapshot();
  const m = result.ok ? result.snapshot.members.find((x) => x.handle === handle) : null;
  return { title: m ? `${m.full_name} · Statement` : 'Member statement' };
}

export default async function MemberStatementPage(props: PageProps<'/members/[handle]'>) {
  const { handle } = await props.params;
  const result = await loadDemoSnapshot();
  if (!result.ok) return <ErrorState message={result.error} />;
  const s = result.snapshot;
  const member = s.members.find((m) => m.handle === handle);
  if (!member) notFound();

  const rate = s.group.kes_per_usd;
  const turn = turnCycle(s, member.id);
  const turnPayout = turn ? s.payouts.find((p) => p.cycle_id === turn.id) ?? null : null;
  const treasurer = s.members.find((m) => m.role === 'treasurer');

  const rows = s.contributions
    .filter((c) => c.member_id === member.id)
    .map((c) => ({ c, cycle: cycleOf(s, c.cycle_id) }))
    .filter((r) => r.cycle)
    .sort((a, b) => b.cycle!.number - a.cycle!.number);

  const paid = rows.filter((r) => r.c.status === 'paid');
  const contributed = paid.reduce((sum, r) => sum + r.c.amount, 0);
  const onTime = paid.filter((r) => r.c.days_late === 0).length;
  const fines = rows.filter((r) => r.c.fine > 0);
  const unpaidFines = fines.filter((r) => !r.c.fine_paid);
  const unpaidFineTotal = unpaidFines.reduce((sum, r) => sum + r.c.fine, 0);
  const open = rows.find((r) => r.c.status !== 'paid' && r.cycle?.status === 'collecting');
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || null;

  return (
    <div className="space-y-8">
      <Link href="/members" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All members
      </Link>

      {/* Identity + turn */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-4">
            <Avatar name={member.full_name} color={member.avatar_color} size="xl" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pot-ink">Member statement</p>
              <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">{member.full_name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {member.city}, {member.country}
                </span>
                <span className="inline-flex items-center gap-1">
                  {member.pays_via === 'paypal' ? (
                    <CreditCard className="size-3.5" aria-hidden />
                  ) : (
                    <Banknote className="size-3.5" aria-hidden />
                  )}
                  {member.pays_via === 'paypal' ? 'Pays by PayPal invoice' : 'Pays cash at the meeting'}
                </span>
                {isOfficial(member) ? (
                  <Pill tone="pot" icon={ShieldCheck}>
                    {ROLE_LABEL[member.role]}
                  </Pill>
                ) : null}
              </p>
            </div>
          </div>
        </div>
        {turn ? (
          <div className="flex flex-col items-start gap-3 border-t border-marigold/30 bg-marigold-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-start gap-3">
              <HandCoins className="mt-0.5 size-5 shrink-0 text-marigold-ink" aria-hidden />
              <div>
                <p className="font-semibold text-ink">
                  {ordinal(member.rotation_position)} turn of {s.members.length}: the {turn.label} pot
                </p>
                <p className="text-sm text-marigold-ink">
                  {turnPayout?.status === 'succeeded'
                    ? `Received ${formatUsd(turnPayout.amount)} on ${formatDate(turnPayout.completed_at ?? turnPayout.sent_at ?? turn.payout_on)}`
                    : turn.status === 'collecting'
                      ? `Receives this cycle, on ${formatDate(turn.payout_on, { weekday: true })}`
                      : `Scheduled for ${formatDate(turn.payout_on, { weekday: true })}`}
                </p>
              </div>
            </div>
            {turnPayout ? <PayoutStatusPill status={turnPayout.status} /> : <Pill tone="neutral" icon={CalendarClock}>Upcoming</Pill>}
          </div>
        ) : null}
      </Card>

      {/* Totals */}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 rounded-[14px] border border-line bg-card p-4 md:col-span-1">
          <dt className="text-xs font-medium text-muted">Contributed</dt>
          <dd className="mt-1">
            <Money usd={contributed} kesPerUsd={rate} size="lg" stacked />
          </dd>
        </div>
        <div className="rounded-[14px] border border-line bg-card p-4">
          <dt className="text-xs font-medium text-muted">Cycles paid</dt>
          <dd className="tabular mt-1 text-2xl font-semibold text-ink">
            {paid.length}
            <span className="text-base font-normal text-muted"> / {rows.length}</span>
          </dd>
        </div>
        <div className="rounded-[14px] border border-line bg-card p-4">
          <dt className="text-xs font-medium text-muted">On time</dt>
          <dd className="tabular mt-1 text-2xl font-semibold text-ink">
            {paid.length ? Math.round((onTime / paid.length) * 100) : 0}%
          </dd>
        </div>
        <div className="col-span-2 rounded-[14px] border border-line bg-card p-4 md:col-span-1">
          <dt className="text-xs font-medium text-muted">Fines</dt>
          <dd className="tabular mt-1 text-2xl font-semibold text-ink">
            {formatUsd(fines.reduce((sum, r) => sum + r.c.fine, 0))}
          </dd>
          <dd className={`text-xs ${unpaidFineTotal > 0 ? 'font-semibold text-clay' : 'text-muted'}`}>
            {unpaidFineTotal > 0 ? `${formatUsd(unpaidFineTotal)} unpaid` : fines.length ? 'All settled' : 'None'}
          </dd>
        </div>
      </dl>

      {/* Unpaid fines: pay with PayPal (JS SDK v6) */}
      {unpaidFines.map(({ c, cycle }) => (
        <Card key={`fine-${c.id}`} className="border-clay/40 p-5 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-clay-soft text-clay">
                <TriangleAlert className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold text-ink">
                  Late fine for {cycle!.label}: {formatUsd(c.fine)}{' '}
                  <span className="font-normal text-muted">≈ {formatKes(c.fine, rate)}</span>
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  The contribution was {c.days_late} day{c.days_late === 1 ? '' : 's'} late. Pay the fine with PayPal and the
                  books update straight away.
                </p>
              </div>
            </div>
            <div className="md:w-80">
              <PayFineButton contributionId={c.id} clientId={clientId} amountLabel={formatUsd(c.fine)} />
            </div>
          </div>
        </Card>
      ))}

      {/* This cycle's open contribution */}
      {open ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-ink">
                {open.cycle!.label} contribution: {formatUsd(open.c.amount)}{' '}
                <span className="font-normal text-muted">due {formatDate(open.cycle!.due_on, { weekday: true, year: false })}</span>
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {member.pays_via === 'cash'
                  ? `Pay cash to ${treasurer ? firstName(treasurer.full_name) : 'the treasurer'} at the meeting; she records it against ${firstName(member.full_name)}'s PayPal invoice${open.c.paypal_invoice_number ? ` ${open.c.paypal_invoice_number}` : ''}.`
                  : open.c.paypal_invoice_url
                    ? `PayPal invoice ${open.c.paypal_invoice_number ?? ''} is waiting. Paying it updates the pot for everyone, live.`
                    : 'The PayPal invoice for this cycle is being prepared.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusPill status={open.c.status} />
              {open.c.paypal_invoice_url && member.pays_via === 'paypal' ? (
                <a href={open.c.paypal_invoice_url} target="_blank" rel="noopener" className={buttonClass('primary')}>
                  Pay invoice
                  <ExternalLink className="size-4" aria-hidden />
                  <span className="sr-only">(opens PayPal in a new tab)</span>
                </a>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Ledger */}
      <section aria-labelledby="ledger-title">
        <SectionTitle id="ledger-title" aside={`${rows.length} cycles`}>
          Contributions
        </SectionTitle>
        {rows.length === 0 ? (
          <EmptyState title="No contributions yet">The first PayPal invoice goes out when the next cycle opens.</EmptyState>
        ) : (
          <Card as="div" className="overflow-hidden">
            <ul className="divide-y divide-line">
              {rows.map(({ c, cycle }) => (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 sm:justify-start">
                      <p className="font-semibold text-ink">
                        {cycle!.label}
                        <span className="ml-1.5 text-xs font-normal text-muted">Cycle {cycle!.number}</span>
                      </p>
                      <span className="sm:hidden">
                        <StatusPill status={c.status} />
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                      {c.status === 'paid' ? (
                        <span>
                          Paid {formatDate(c.paid_at)}
                          {c.method ? ` · ${METHOD_LABEL[c.method] ?? c.method}` : ''}
                        </span>
                      ) : (
                        <span>Due {formatDate(cycle!.due_on)}</span>
                      )}
                      {c.paypal_invoice_number ? (
                        c.paypal_invoice_url ? (
                          <a
                            href={c.paypal_invoice_url}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center gap-0.5 font-medium text-pot-ink underline-offset-2 hover:underline"
                          >
                            Invoice {c.paypal_invoice_number}
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span>Invoice {c.paypal_invoice_number}</span>
                        )
                      ) : null}
                      {c.days_late > 0 ? <span className="text-clay">{c.days_late} days late</span> : null}
                      {c.fine > 0 ? (
                        <span className={c.fine_paid ? '' : 'font-semibold text-clay'}>
                          Fine {formatUsd(c.fine)} {c.fine_paid ? '(paid)' : '(unpaid)'}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <Money usd={c.amount} kesPerUsd={rate} size="sm" />
                    <span className="hidden sm:inline-flex">
                      <StatusPill status={c.status} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
