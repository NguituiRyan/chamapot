import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  FileText,
  HandCoins,
  History,
  Lock,
  Receipt,
  ScrollText,
  Send,
  ShieldCheck,
  UserRoundX,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABEL, currentCycle, memberMap, officials, totalPaidOut } from '@/components/chama';
import { loadDemoSnapshot } from '@/components/data';
import { formatUsd } from '@/components/format';
import { KangaBorder } from '@/components/kanga-border';
import { Logo } from '@/components/logo';
import { PotStatusCard } from '@/components/pot-status-card';
import { ErrorState } from '@/components/states';
import { Eyebrow, buttonClass } from '@/components/ui';

const STEPS: { icon: LucideIcon; title: string; body: string; tag: string }[] = [
  {
    icon: ScrollText,
    title: 'The constitution becomes the rules',
    body: 'Upload the chama constitution. Claude reads it and turns the clauses that matter (contribution, due date, fines, rotation, who signs off) into rules the app enforces, each with the sentence it came from.',
    tag: 'Claude',
  },
  {
    icon: Receipt,
    title: 'A PayPal invoice for every contribution',
    body: 'Each cycle every member gets an invoice. Diaspora members pay it with PayPal; cash handed over at the meeting is recorded against the same invoice, so one ledger covers both.',
    tag: 'PayPal Invoicing',
  },
  {
    icon: Webhook,
    title: 'Verified webhooks keep the books',
    body: 'PayPal signs every payment event. ChamaPot verifies the signature, updates the ledger and the dashboard live. No more payment screenshots in the WhatsApp group.',
    tag: 'PayPal Webhooks',
  },
  {
    icon: HandCoins,
    title: 'AI proposes, two officials approve, PayPal pays',
    body: 'When the pot is full the Claude treasurer proposes the payout to the member whose turn it is. Two officials approve, then PayPal Payouts sends the money.',
    tag: 'PayPal Payouts',
  },
];

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Lock,
    title: 'The AI never moves money',
    body: 'The treasurer agent reads the ledger, sends reminders and drafts proposals. Sending money is a server action that runs only after two officials say yes.',
  },
  {
    icon: UserRoundX,
    title: 'The recipient is locked to the rotation',
    body: "A payout can only go to the member scheduled for that cycle, and she can't approve her own pot. Ask for anyone else and the server refuses.",
  },
  {
    icon: History,
    title: 'Every action is on the record',
    body: 'Webhooks, reminders, votes and payouts land in an activity log every member can read, each tied to its PayPal reference.',
  },
];

const BUILT_WITH = ['PayPal Invoicing', 'PayPal Payouts', 'PayPal Webhooks', 'PayPal Orders', 'Claude', 'AG Studio'];

export default async function Home() {
  const result = await loadDemoSnapshot();
  const s = result.ok ? result.snapshot : null;
  const countries = s ? new Set(s.members.map((m) => m.country)).size : 0;
  const cities = s ? new Set(s.members.map((m) => m.city)).size : 0;
  const paidOut = s ? totalPaidOut(s) : 0;
  const cyclesDone = s ? s.cycles.filter((c) => c.status === 'paid_out').length : 0;
  const cycle = s ? currentCycle(s) : null;
  const recipient = s && cycle ? (memberMap(s).get(cycle.recipient_member_id) ?? null) : null;
  const officialsList = s ? officials(s) : [];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Page" className="ml-auto hidden items-center gap-1 text-sm font-medium text-muted md:flex">
            <a href="#how" className="rounded-[10px] px-3 py-2 hover:bg-sunken hover:text-ink">
              How it works
            </a>
            <a href="#trust" className="rounded-[10px] px-3 py-2 hover:bg-sunken hover:text-ink">
              Safeguards
            </a>
            <Link href="/activity" className="rounded-[10px] px-3 py-2 hover:bg-sunken hover:text-ink">
              Live activity
            </Link>
          </nav>
          <Link href="/dashboard" className={buttonClass('primary', 'ml-auto md:ml-2')}>
            Open demo
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-40 -top-40 size-[36rem] rounded-full bg-[radial-gradient(closest-side,var(--marigold-soft),transparent)] opacity-80"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-48 -left-40 size-[32rem] rounded-full bg-[radial-gradient(closest-side,var(--pot-soft),transparent)]"
          />
          <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:pb-24 lg:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold text-muted shadow-sm">
                <span className="size-1.5 rounded-full bg-marigold" aria-hidden />
                For chamas at home and in the diaspora
              </p>
              <h1 className="mt-5 font-display text-[2.6rem] font-semibold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-[4.1rem]">
                The AI treasurer for your <span className="text-pot-ink">chama</span>.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                Every contribution lives on a PayPal invoice. A Claude treasurer chases payments and proposes payouts.
                Two officials approve, and PayPal pays.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/dashboard" className={buttonClass('primary', 'h-12 px-6 text-base')}>
                  Open the Umoja Sisters demo
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a href="#how" className={buttonClass('secondary', 'h-12 px-6 text-base')}>
                  See how it works
                </a>
              </div>
              <p className="mt-6 flex items-start gap-2 text-sm text-muted">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
                PayPal sandbox demo. The AI never moves money, and every action is logged.
              </p>
            </div>

            <div className="relative">
              {s ? (
                <>
                  <PotStatusCard snapshot={s} />
                  <p className="mt-3 text-center text-xs text-muted">
                    Live from the Umoja Sisters ledger. It updates the moment PayPal confirms a payment.
                  </p>
                </>
              ) : (
                <ErrorState title="The live pot preview is unavailable" message={result.ok ? undefined : result.error} />
              )}
            </div>
          </div>
        </section>

        {/* Proof strip */}
        {s ? (
          <section aria-label="Umoja Sisters at a glance" className="border-y border-line bg-card">
            <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 divide-line px-4 sm:px-6 md:grid-cols-4 md:divide-x">
              {[
                { k: 'Members', v: `${s.members.length}`, d: `${cities} cities, ${countries} countries` },
                { k: 'Monthly contribution', v: formatUsd(s.group.contribution_amount, { whole: true }), d: 'each, on a PayPal invoice' },
                { k: 'Paid out so far', v: formatUsd(paidOut, { whole: true }), d: `across ${cyclesDone} pots so far` },
                { k: 'Approvals per payout', v: `${s.group.approvals_required}`, d: 'officials, never the recipient' },
              ].map((item) => (
                <div key={item.k} className="px-2 py-6 md:px-6">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted">{item.k}</dt>
                  <dd className="tabular mt-1 font-display text-3xl font-semibold text-ink">{item.v}</dd>
                  <dd className="mt-0.5 text-sm text-muted">{item.d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
          <div className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-title" className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              From the constitution to the payout, in four steps.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">
              The chama keeps its own rules and its own officials. ChamaPot does the bookkeeping, the chasing and the
              paperwork, on PayPal rails.
            </p>
          </div>
          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body, tag }, i) => (
              <li key={title} className="relative flex flex-col rounded-[14px] border border-line bg-card p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-[12px] bg-pot-soft text-pot-ink">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="tabular font-display text-3xl font-semibold text-line" aria-hidden>
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold leading-snug text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{body}</p>
                <p className="mt-4 text-xs font-semibold text-pot-ink">{tag}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Safeguards */}
        <section id="trust" aria-labelledby="trust-title" className="scroll-mt-16 bg-[#12261F] text-[#EAF2EE]">
          <KangaBorder />
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F2A93B]">Safeguards</p>
              <h2 id="trust-title" className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Money moves only when people say so.
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#B9CBC3]">
                A chama runs on trust between members. ChamaPot keeps that trust in the code: the AI can advise and
                prepare, and the chama&apos;s officials decide.
              </p>
              {recipient && cycle ? (
                <div className="mt-8 rounded-[14px] border border-white/10 bg-white/5 p-4" aria-label="Example approval trail">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <HandCoins className="size-4 text-[#F2A93B]" aria-hidden />
                    {cycle.label} pot to {recipient.full_name} · {formatUsd(cycle.target_amount)}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-[#B9CBC3]">
                    <li className="flex items-start gap-2">
                      <FileText className="mt-0.5 size-4 shrink-0" aria-hidden />
                      Proposed by the treasurer agent: rotation turn {recipient.rotation_position}
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[#5FCFAE]" aria-hidden />
                      Two of {officialsList.map((o) => `${o.full_name.split(' ')[0]} (${ROLE_LABEL[o.role]})`).join(', ')} approve
                    </li>
                    <li className="flex items-start gap-2">
                      <UserRoundX className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {recipient.full_name.split(' ')[0]} cannot vote on her own pot
                    </li>
                    <li className="flex items-start gap-2">
                      <Send className="mt-0.5 size-4 shrink-0 text-[#F2A93B]" aria-hidden />
                      PayPal Payouts sends it, and the webhook closes the books
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
            <ul className="grid gap-4 self-center">
              {TRUST.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4 rounded-[14px] border border-white/10 bg-white/[0.04] p-5">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[#F2A93B] text-[#12261F]">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#B9CBC3]">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Built with */}
        <section aria-labelledby="built-title" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="built-title" className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Built with
          </h2>
          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {BUILT_WITH.map((name) => (
              <li
                key={name}
                className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold text-ink shadow-sm"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-[20px] bg-pot px-6 py-10 text-white sm:px-10 sm:py-12">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgba(242,169,59,0.45),transparent)]"
            />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  See November&apos;s pot fill up.
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed text-white/85">
                  Open the Umoja Sisters dashboard, ask the treasurer who is behind, and watch a PayPal payment land in
                  the books without a refresh.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard"
                  className={`${buttonClass('accent', 'h-12 px-6 text-base')}`}
                >
                  Open the Umoja Sisters demo
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="/approvals"
                  className="inline-flex h-12 items-center justify-center rounded-[10px] border border-white/30 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10"
                >
                  View approvals
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
