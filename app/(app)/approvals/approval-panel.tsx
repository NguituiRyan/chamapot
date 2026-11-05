'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Ban,
  BadgeCheck,
  Bot,
  CircleAlert,
  CircleCheck,
  CircleX,
  Hourglass,
  LoaderCircle,
  Lock,
  ScrollText,
  Send,
  UserRoundX,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { ROLE_LABEL } from '@/components/chama';
import { SourceQuote } from '@/components/confidence-meter';
import { firstName, formatDate, formatDateTime } from '@/components/format';
import { Money } from '@/components/money';
import { Pill, PayoutStatusPill } from '@/components/status-pill';
import { Card, buttonClass } from '@/components/ui';
import type { ChamaApproval, ChamaMember, ChamaPayout, ChamaRule } from '@/lib/chama/types';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Person = Pick<ChamaMember, 'id' | 'handle' | 'full_name' | 'role' | 'avatar_color'>;

interface Props {
  groupId: string;
  approvalsRequired: number;
  kesPerUsd: number;
  memberCount: number;
  payout: ChamaPayout;
  cycle: { number: number; label: string; payout_on: string };
  recipient: Person & Pick<ChamaMember, 'city' | 'country' | 'rotation_position'>;
  officials: Person[];
  votes: ChamaApproval[];
  acting: Person | null;
  rules: { rotation: ChamaRule | null; approval: ChamaRule | null };
}

const TERMINAL = new Set(['succeeded', 'failed', 'rejected']);

export function ApprovalPanel(props: Props) {
  const { payout: initial, recipient, officials, votes, acting, approvalsRequired, cycle, kesPerUsd, rules } = props;
  const router = useRouter();
  const noteId = useId();
  // Local updates (vote result, PayPal status polls) layered over the server's payout; reset when the server re-renders.
  const [base, setBase] = useState(initial);
  const [patch, setPatch] = useState<Partial<ChamaPayout>>({});
  if (base !== initial) {
    setBase(initial);
    setPatch({});
  }
  const payout: ChamaPayout = { ...initial, ...patch };
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(initial.status === 'sent' || initial.status === 'approved');
  const pollCount = useRef(0);

  // Realtime: another official voting, or the PayPal webhook settling the payout, refreshes this page.
  useEffect(() => {
    let client: ReturnType<typeof supabaseBrowser>;
    try {
      client = supabaseBrowser();
    } catch {
      return;
    }
    const channel = client
      .channel(`approvals-${initial.id}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chama_approvals', filter: `payout_id=eq.${initial.id}` }, () =>
        router.refresh(),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chama_payouts', filter: `id=eq.${initial.id}` }, () =>
        router.refresh(),
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [initial.id, router]);

  // While PayPal is processing, ask the server to refresh the payout status from PayPal.
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/chama/payouts/${initial.id}/status`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.status) {
        setPatch((p) => ({ ...p, ...body }));
        if (TERMINAL.has(body.status)) {
          setPolling(false);
          router.refresh();
        }
      }
    } catch {
      /* keep polling; network blips are fine */
    }
  }, [initial.id, router]);

  useEffect(() => {
    if (!polling) return;
    pollCount.current = 0;
    const t = setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current > 40) {
        setPolling(false);
        return;
      }
      void poll();
    }, 3000);
    return () => clearInterval(t);
  }, [polling, poll]);

  async function vote(decision: 'approve' | 'reject') {
    if (!acting) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/chama/payouts/${payout.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberHandle: acting.handle, decision, note: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The vote was not recorded (${res.status})`);
      if (body?.status) setPatch((p) => ({ ...p, ...body }));
      if (body?.status === 'sent' || body?.status === 'approved') setPolling(true);
      setConfirmReject(false);
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The vote failed');
    } finally {
      setBusy(null);
    }
  }

  // ---- Votes ----
  const voteBy = new Map(votes.map((v) => [v.member_id, v]));
  const approvals = votes.filter((v) => v.decision === 'approve').length;
  const myVote = acting ? voteBy.get(acting.id) : undefined;
  const actingIsOfficial = !!acting && acting.role !== 'member';
  const actingIsRecipient = !!acting && acting.id === recipient.id;
  const open = payout.status === 'proposed';
  const canVote = open && actingIsOfficial && !actingIsRecipient && !myVote;
  const sending = payout.status === 'approved' || payout.status === 'sent';

  return (
    <section aria-labelledby="proposal-title" className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/60 px-5 py-3">
          <p className="text-sm font-semibold text-muted">
            Payout proposal · Cycle {cycle.number}, {cycle.label}
          </p>
          <PayoutStatusPill status={payout.status} />
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar name={recipient.full_name} color={recipient.avatar_color} size="xl" />
              <div className="min-w-0">
                <p className="text-sm text-muted">Pay</p>
                <h2 id="proposal-title" className="font-display text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
                  {recipient.full_name}
                </h2>
                <p className="text-sm text-muted">
                  {recipient.city}, {recipient.country} · turn {recipient.rotation_position} of {props.memberCount}
                </p>
              </div>
            </div>
            <div className="sm:text-right">
              <Money usd={payout.amount} kesPerUsd={kesPerUsd} size="xl" stacked />
              <p className="mt-1 text-xs text-muted">via PayPal Payouts to her PayPal account</p>
            </div>
          </div>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-[10px] bg-sunken px-3 py-2.5">
              <dt className="text-xs text-muted">Proposed by</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
                <Bot className="size-4 text-pot-ink" aria-hidden />
                {payout.proposed_by === 'treasurer-agent' ? 'Treasurer agent' : payout.proposed_by}
              </dd>
              <dd className="text-xs text-muted">{formatDateTime(payout.created_at)}</dd>
            </div>
            <div className="rounded-[10px] bg-sunken px-3 py-2.5">
              <dt className="text-xs text-muted">Payout day</dt>
              <dd className="mt-0.5 font-semibold text-ink">{formatDate(cycle.payout_on, { weekday: true })}</dd>
            </div>
            <div className="rounded-[10px] bg-sunken px-3 py-2.5">
              <dt className="text-xs text-muted">Approvals</dt>
              <dd className="tabular mt-0.5 font-semibold text-ink">
                {approvals} of {approvalsRequired} needed
              </dd>
              <dd className="mt-1.5 flex gap-1" aria-hidden>
                {Array.from({ length: approvalsRequired }).map((_, i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${i < approvals ? 'bg-pot' : 'bg-line'}`} />
                ))}
              </dd>
            </div>
          </dl>

          {payout.reason ? (
            <p className="mt-4 text-sm text-muted">
              <span className="font-semibold text-ink">Agent&apos;s note: </span>
              {payout.reason}
            </p>
          ) : null}

          {/* Action area */}
          <div className="mt-6 border-t border-line pt-5">
            {sending ? (
              <div className="rounded-[12px] border border-pot/30 bg-pot-soft p-4" role="status" aria-live="polite">
                <p className="flex items-center gap-2 font-semibold text-pot-ink">
                  <LoaderCircle className="size-5 animate-spin" aria-hidden />
                  Sending via PayPal Payouts…
                </p>
                <ol className="mt-3 space-y-1.5 text-sm text-ink">
                  <li className="flex items-center gap-2">
                    <CircleCheck className="size-4 text-success" aria-hidden /> {approvalsRequired} officials approved
                  </li>
                  <li className="flex items-center gap-2">
                    {payout.status === 'sent' ? (
                      <CircleCheck className="size-4 text-success" aria-hidden />
                    ) : (
                      <LoaderCircle className="size-4 animate-spin text-pot-ink" aria-hidden />
                    )}
                    Payout batch sent to PayPal{payout.paypal_batch_id ? ` (${payout.paypal_batch_id})` : ''}
                  </li>
                  <li className="flex items-center gap-2 text-muted">
                    <Hourglass className="size-4" aria-hidden /> Waiting for PayPal to confirm{payout.paypal_status ? `: ${payout.paypal_status}` : ''}
                  </li>
                </ol>
              </div>
            ) : payout.status === 'succeeded' ? (
              <p className="flex items-center gap-2 rounded-[12px] bg-success-soft p-4 font-semibold text-success" role="status">
                <CircleCheck className="size-5" aria-hidden />
                Paid. PayPal confirmed the payout to {firstName(recipient.full_name)}.
              </p>
            ) : payout.status === 'failed' ? (
              <p className="flex items-center gap-2 rounded-[12px] bg-danger-soft p-4 font-semibold text-danger" role="alert">
                <CircleX className="size-5" aria-hidden />
                PayPal reported the payout as {payout.paypal_status?.toLowerCase() ?? 'failed'}. The money is still in the pot.
              </p>
            ) : payout.status === 'rejected' ? (
              <p className="flex items-center gap-2 rounded-[12px] bg-sunken p-4 font-semibold text-ink">
                <Ban className="size-5" aria-hidden />
                An official rejected this proposal. Nothing was sent.
              </p>
            ) : canVote ? (
              <div>
                <p className="text-sm text-muted">
                  Voting as <span className="font-semibold text-ink">{acting!.full_name}</span> ({ROLE_LABEL[acting!.role]})
                </p>
                <label htmlFor={noteId} className="mt-3 block text-sm font-semibold text-ink">
                  Note for the record <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id={noteId}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={240}
                  placeholder="e.g. Checked against the members register"
                  className="mt-1.5 h-11 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink placeholder:text-muted/70 focus:border-pot"
                />
                {confirmReject ? (
                  <div className="mt-4 rounded-[12px] border border-danger/30 bg-danger-soft p-3">
                    <p className="text-sm font-semibold text-ink">Reject this payout?</p>
                    <p className="mt-0.5 text-sm text-muted">The proposal closes and nothing is sent. The agent can propose again.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button type="button" onClick={() => vote('reject')} disabled={!!busy} className={buttonClass('danger')}>
                        {busy === 'reject' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
                        Yes, reject
                      </button>
                      <button type="button" onClick={() => setConfirmReject(false)} disabled={!!busy} className={buttonClass('ghost')}>
                        Keep it open
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => vote('approve')}
                      disabled={!!busy}
                      className={buttonClass('primary', 'h-12 flex-1 text-base sm:flex-none sm:px-8')}
                    >
                      {busy === 'approve' ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-5" aria-hidden />}
                      Approve payout
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmReject(true)}
                      disabled={!!busy}
                      className={buttonClass('danger', 'h-12')}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {approvals + 1 >= approvalsRequired ? (
                  <p className="mt-3 text-xs text-muted">
                    Yours is the deciding approval: the server sends the pot with PayPal Payouts straight after.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-[12px] bg-sunken p-4 text-sm text-ink">
                {myVote ? (
                  <>
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    You {myVote.decision === 'approve' ? 'approved' : 'rejected'} this on {formatDateTime(myVote.created_at)}. Waiting
                    for {Math.max(0, approvalsRequired - approvals)} more official{approvalsRequired - approvals === 1 ? '' : 's'}.
                  </>
                ) : actingIsRecipient ? (
                  <>
                    <UserRoundX className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
                    {firstName(recipient.full_name)} is receiving this pot, so she can&apos;t approve it. Two other officials must.
                  </>
                ) : (
                  <>
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span>
                      You are viewing as {acting?.full_name ?? 'a member'} ({acting ? ROLE_LABEL[acting.role] : 'Member'}). Only the
                      chair, treasurer and secretary vote on payouts. Switch to an official with &ldquo;Viewing as&rdquo;.
                    </span>
                  </>
                )}
              </p>
            )}
            {error ? (
              <p role="alert" className="mt-3 flex gap-2 rounded-[10px] border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        <Card className="p-5">
          <h3 className="font-display text-lg font-semibold text-ink">Officials&apos; votes</h3>
          <ul className="mt-3 space-y-2">
            {officials.map((o) => {
              const v = voteBy.get(o.id);
              const isRecipient = o.id === recipient.id;
              return (
                <li key={o.id} className="flex items-center gap-3 rounded-[10px] px-1 py-1.5">
                  <Avatar name={o.full_name} color={o.avatar_color} size="md" decorative />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {o.full_name}
                      {acting?.id === o.id ? <span className="ml-1.5 text-xs font-medium text-muted">(you)</span> : null}
                    </p>
                    <p className="text-xs text-muted">
                      {ROLE_LABEL[o.role]}
                      {v ? ` · ${formatDateTime(v.created_at)}` : ''}
                      {v?.note ? ` · “${v.note}”` : ''}
                    </p>
                  </div>
                  {isRecipient ? (
                    <Pill tone="neutral" icon={UserRoundX}>
                      Recipient
                    </Pill>
                  ) : v?.decision === 'approve' ? (
                    <Pill tone="success" icon={BadgeCheck}>
                      Approved
                    </Pill>
                  ) : v?.decision === 'reject' ? (
                    <Pill tone="danger" icon={CircleX}>
                      Rejected
                    </Pill>
                  ) : (
                    <Pill tone="neutral" icon={Hourglass}>
                      Waiting
                    </Pill>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <ScrollText className="size-5 text-pot-ink" aria-hidden />
            Rules this payout satisfies
          </h3>
          <ul className="mt-3 space-y-4 text-sm">
            <li>
              <p className="flex items-start gap-2 font-semibold text-ink">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {firstName(recipient.full_name)} is scheduled for cycle {cycle.number} (turn {recipient.rotation_position})
              </p>
              {rules.rotation?.source_quote ? <SourceQuote className="mt-2 text-sm">{rules.rotation.source_quote}</SourceQuote> : null}
            </li>
            <li>
              <p className="flex items-start gap-2 font-semibold text-ink">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {approvalsRequired} officials must approve; the recipient cannot
              </p>
              {rules.approval?.source_quote ? <SourceQuote className="mt-2 text-sm">{rules.approval.source_quote}</SourceQuote> : null}
            </li>
            <li>
              <p className="flex items-start gap-2 font-semibold text-ink">
                <Send className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
                The amount equals what was collected this cycle
              </p>
            </li>
          </ul>
        </Card>
      </div>
    </section>
  );
}
