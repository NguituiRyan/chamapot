import type { ChamaGroup, ChamaCycle, ChamaMember, ChamaContribution, ChamaPayout } from '@/lib/chama/types';
import { getChamaSnapshot } from '@/lib/chama/snapshot';
import { createDraft, getInvoice, invoiceNumber, payerViewUrl, recordCashPayment, remind, sendInvoice } from '@/lib/paypal/invoices';
import { getPayoutBatch, sendPayout } from '@/lib/paypal/payouts';
import { requestId } from '@/lib/paypal/request-id';
import { checked, db, logEvent, row, update } from './store';
import { MoneyError } from './errors';

export { logEvent } from './store';
const cents = (amount: number) => Math.round(Number(amount) * 100);
export async function contributionContext(id: string) {
  const contribution = await row<ChamaContribution>('contributions', id);
  const [group, cycle, member] = await Promise.all([row<ChamaGroup>('groups', contribution.group_id), row<ChamaCycle>('cycles', contribution.cycle_id), row<ChamaMember>('members', contribution.member_id)]);
  return { contribution, group, cycle, member };
}
export async function official(groupId: string, handle: string) {
  const member = checked(await db().from('chama_members').select('*').eq('group_id', groupId).eq('handle', handle).maybeSingle()) as ChamaMember | null;
  if (!member || !['chair', 'treasurer', 'secretary'].includes(member.role)) throw new MoneyError(403, 'Only the chair, treasurer or secretary may perform this action');
  return member;
}
export async function ensureInvoice(id: string) {
  const { contribution: c, group, cycle, member } = await contributionContext(id);
  const key = requestId('invoice', group.slug, cycle.number, member.handle);
  let invoiceId = c.paypal_invoice_id;
  if (!invoiceId) {
    const draft = await createDraft(group, cycle, member, c);
    if (!draft.id) throw new Error('PayPal invoice response has no id');
    invoiceId = draft.id;
    // Persist draft before sending: a send failure can resume this same invoice.
    await update('contributions', id, { paypal_invoice_id: invoiceId, paypal_invoice_number: invoiceNumber(group, cycle, member), paypal_invoice_url: payerViewUrl(draft) });
  }
  let invoice = await getInvoice(invoiceId);
  if (invoice.status === 'CANCELLED') throw new MoneyError(409, 'This contribution invoice was cancelled. An official must resolve it before collecting payment.');
  if (invoice.status === 'DRAFT') { await sendInvoice(invoiceId, key); invoice = await getInvoice(invoiceId); }
  checked(await db().from('chama_contributions').update({ paypal_invoice_url: payerViewUrl(invoice), paypal_invoice_number: invoice.detail?.invoice_number ?? invoiceNumber(group, cycle, member), status: 'invoiced' }).eq('id', id).neq('status', 'paid'));
  return { contributionId: id, memberHandle: member.handle, invoiceId, invoiceNumber: invoice.detail?.invoice_number ?? invoiceNumber(group, cycle, member), url: payerViewUrl(invoice) };
}
export async function createCycleInvoices(slug: string) {
  const snapshot = await getChamaSnapshot(slug);
  if (!snapshot.currentCycleId) throw new MoneyError(409, 'No collecting or ready cycle');
  const created = [], skipped = [];
  for (const c of snapshot.contributions.filter(c => c.cycle_id === snapshot.currentCycleId)) {
    if (c.status === 'paid') { skipped.push({ contributionId: c.id, reason: 'paid' }); continue; }
    if (c.paypal_invoice_id) {
      // Recover an interrupted draft/send without creating a new invoice.
      const invoice = await getInvoice(c.paypal_invoice_id);
      if (invoice.status !== 'DRAFT') { skipped.push({ contributionId: c.id, reason: 'already invoiced' }); continue; }
    }
    const result = await ensureInvoice(c.id);
    created.push(result);
    await logEvent(c.group_id, 'contribution', 'system', `Sent ${result.invoiceNumber} contribution invoice`, result);
  }
  return { created, skipped };
}
export async function markContributionPaid(c: ChamaContribution, paidAt: string, method: 'paypal' | 'cash_recorded', paymentId?: string) {
  const [cycle, group] = await Promise.all([row<ChamaCycle>('cycles', c.cycle_id), row<ChamaGroup>('groups', c.group_id)]);
  const daysLate = Math.max(0, Math.floor((Date.parse(`${paidAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${cycle.due_on}T00:00:00Z`)) / 86_400_000) - group.grace_days);
  await update('contributions', c.id, { status: 'paid', paid_at: paidAt, method, ...(paymentId ? { paypal_payment_id: paymentId } : {}), days_late: daysLate, fine: daysLate > 0 ? Number(group.late_fine) : 0 });
  const contributions = checked(await db().from('chama_contributions').select('status').eq('cycle_id', cycle.id));
  if (contributions?.length && contributions.every(c => c.status === 'paid')) {
    checked(await db().from('chama_cycles').update({ status: 'ready' }).eq('id', cycle.id).in('status', ['collecting', 'upcoming']));
  }
}
export async function recordCash(id: string, recordedBy: string, note?: string) {
  let context = await contributionContext(id);
  await official(context.group.id, recordedBy);
  if (context.contribution.status === 'paid') return { status: 'paid', alreadyPaid: true };
  if (!context.contribution.paypal_invoice_id) { await ensureInvoice(id); context = await contributionContext(id); }
  const invoice = await getInvoice(context.contribution.paypal_invoice_id!);
  if (['PAID', 'MARKED_AS_PAID', 'CANCELLED'].includes(invoice.status ?? '')) throw new MoneyError(409, `PayPal invoice is ${invoice.status}; wait for confirmation or ask an official to reconcile it before recording cash`);
  const at = new Date().toISOString();
  const key = requestId('record-payment', context.group.slug, context.cycle.number, context.member.handle);
  await recordCashPayment(context.contribution.paypal_invoice_id!, Number(context.contribution.amount), at, note ?? `Cash recorded by ${recordedBy}`, key);
  await markContributionPaid(context.contribution, at, 'cash_recorded');
  await logEvent(context.group.id, 'contribution', recordedBy, `Recorded $${Number(context.contribution.amount).toFixed(2)} cash from ${context.member.full_name}`, { contributionId: id, invoiceId: context.contribution.paypal_invoice_id, note });
  return { status: 'paid', method: 'cash_recorded', contributionId: id };
}
export async function remindContribution(id: string, actor: string) {
  const { contribution: c, group, member } = await contributionContext(id);
  if (actor !== 'treasurer-agent') await official(group.id, actor);
  if (c.status === 'paid') throw new MoneyError(409, 'Contribution is already paid');
  if (!c.paypal_invoice_id) throw new MoneyError(409, 'Create the contribution invoice before sending a reminder');
  const now = Date.now();
  const remaining = c.last_reminded_at ? Math.ceil((Date.parse(c.last_reminded_at) + 600_000 - now) / 1000) : 0;
  if (remaining > 0) throw new MoneyError(429, 'A reminder was already sent in the last 10 minutes', undefined, remaining);
  const at = new Date(now).toISOString();
  let claim = db().from('chama_contributions').update({ last_reminded_at: at }).eq('id', id).neq('status', 'paid');
  claim = c.last_reminded_at ? claim.eq('last_reminded_at', c.last_reminded_at) : claim.is('last_reminded_at', null);
  if (!checked(await claim.select('id'))?.length) throw new MoneyError(429, 'A reminder is already in progress', undefined, 600);
  // Retain the reservation on ambiguous transport failure: do not send a duplicate reminder.
  const result = await remind(c.paypal_invoice_id, `Please pay your contribution to ${group.name}.`, `chamapot-remind-${id}-${Math.floor(now / 600_000)}`);
  await logEvent(group.id, 'reminder', actor, `Reminded ${member.full_name} about her contribution`, { contributionId: id, ...result });
  return { reminded: true, ...result, last_reminded_at: at };
}
export function assertRecipient(cycle: ChamaCycle, recipient: ChamaMember) {
  if (recipient.id !== cycle.recipient_member_id) throw new MoneyError(409, `Payout refused: ${recipient.full_name} is not scheduled to receive cycle ${cycle.number}. The constitution's rotation rule requires the scheduled recipient.`, 'payout_recipient');
}
export function assertVoter(payout: ChamaPayout, member: ChamaMember) {
  if (!['chair', 'treasurer', 'secretary'].includes(member.role)) throw new MoneyError(403, 'Only officials may approve a payout');
  if (member.id === payout.recipient_member_id) throw new MoneyError(403, 'The recipient may not approve her own pot');
}
async function potAmount(cycleId: string) {
  const rows = checked(await db().from('chama_contributions').select('*').eq('cycle_id', cycleId)) as ChamaContribution[];
  if (!rows.length || rows.some(c => c.status !== 'paid')) throw new MoneyError(409, 'Payout refused: every contribution must be paid before proposing or sending the pot', 'pot_complete');
  return rows.reduce((total, c) => total + cents(c.amount), 0) / 100;
}
export async function proposePayout(input: { slug: string; cycleId?: string; recipientHandle?: string; reason?: string }) {
  const s = await getChamaSnapshot(input.slug);
  const cycle = s.cycles.find(c => c.id === (input.cycleId ?? s.currentCycleId));
  if (!cycle) throw new MoneyError(404, 'Cycle not found');
  const recipient = input.recipientHandle ? s.members.find(m => m.handle === input.recipientHandle) : s.members.find(m => m.id === cycle.recipient_member_id);
  if (!recipient) throw new MoneyError(404, 'Recipient not found');
  try { assertRecipient(cycle, recipient); } catch (error) { await logEvent(s.group.id, 'payout', 'treasurer-agent', `Refused payout to ${recipient.full_name} for cycle ${cycle.number}`, { rule: 'payout_recipient' }); throw error; }
  const amount = await potAmount(cycle.id);
  const existing = checked(await db().from('chama_payouts').select('*').eq('cycle_id', cycle.id).maybeSingle());
  if (existing) return existing;
  const result = await db().from('chama_payouts').insert({ group_id: s.group.id, cycle_id: cycle.id, recipient_member_id: recipient.id, amount, currency: 'USD', proposed_by: 'treasurer-agent', reason: input.reason ?? null, status: 'proposed', sender_batch_id: requestId('payout', s.group.slug, cycle.number) }).select('*').single();
  if (result.error?.code === '23505') return checked(await db().from('chama_payouts').select('*').eq('cycle_id', cycle.id).single());
  const payout = checked(result);
  await logEvent(s.group.id, 'payout', 'treasurer-agent', `Proposed $${amount.toFixed(2)} pot for ${recipient.full_name}; officials must approve`, { payoutId: payout.id });
  return payout;
}
async function dispatchPayout(payout: ChamaPayout, group: ChamaGroup) {
  const [cycle, recipient] = await Promise.all([row<ChamaCycle>('cycles', payout.cycle_id), row<ChamaMember>('members', payout.recipient_member_id)]);
  assertRecipient(cycle, recipient);
  if (cents(await potAmount(cycle.id)) !== cents(payout.amount)) throw new MoneyError(409, 'Payout amount does not equal the paid pot');
  // Claim dispatch durably. A crashed sender can resume after 120s with the SAME PayPal batch key.
  const at = new Date().toISOString();
  if (payout.sent_at && Date.now() - Date.parse(payout.sent_at) < 120_000) return payout;
  let claim = db().from('chama_payouts').update({ sent_at: at }).eq('id', payout.id).eq('status', 'approved');
  claim = payout.sent_at ? claim.eq('sent_at', payout.sent_at) : claim.is('sent_at', null);
  if (!checked(await claim.select('id'))?.length) return row<ChamaPayout>('payouts', payout.id);
  const result = await sendPayout(group, cycle, recipient, Number(payout.amount));
  checked(await db().from('chama_payouts').update({ status: 'sent', paypal_batch_id: result.batch.batch_header!.payout_batch_id, sender_batch_id: result.senderBatchId, paypal_status: result.batch.batch_header!.batch_status, sent_at: at }).eq('id', payout.id).eq('status', 'approved'));
  await logEvent(group.id, 'payout', 'system', `Sent $${Number(payout.amount).toFixed(2)} pot to ${recipient.full_name} through PayPal sandbox`, { payoutId: payout.id, batchId: result.batch.batch_header!.payout_batch_id, receiver: result.receiver, scheduledEmail: result.scheduledEmail, sandboxStandIn: result.sandboxStandIn });
  return row<ChamaPayout>('payouts', payout.id);
}
export async function approvePayout(id: string, input: { memberHandle: string; decision: 'approve' | 'reject'; note?: string }) {
  let payout = await row<ChamaPayout>('payouts', id);
  const member = await official(payout.group_id, input.memberHandle);
  assertVoter(payout, member);
  const group = await row<ChamaGroup>('groups', payout.group_id);
  if (payout.status === 'approved') {
    if (input.decision === 'reject') throw new MoneyError(409, 'Voting is closed: the pot has already been approved for dispatch');
    return dispatchPayout(payout, group);
  }
  if (payout.status !== 'proposed') return payout;
  const vote = await db().from('chama_approvals').insert({ payout_id: id, member_id: member.id, decision: input.decision, note: input.note ?? null });
  if (vote.error && vote.error.code !== '23505') checked(vote);
  if (!vote.error) await logEvent(group.id, 'approval', member.handle, `${member.full_name} ${input.decision === 'approve' ? 'approved' : 'rejected'} the pot`, { payoutId: id, note: input.note });
  const votes = checked(await db().from('chama_approvals').select('*').eq('payout_id', id)) ?? [];
  if (votes.some(v => v.decision === 'reject')) {
    checked(await db().from('chama_payouts').update({ status: 'rejected' }).eq('id', id).eq('status', 'proposed'));
    return row<ChamaPayout>('payouts', id);
  }
  if (votes.filter(v => v.decision === 'approve').length >= group.approvals_required) {
    const changed = checked(await db().from('chama_payouts').update({ status: 'approved' }).eq('id', id).eq('status', 'proposed').select('*'));
    if (changed?.length) await logEvent(group.id, 'payout', 'system', 'Required official approvals reached; pot approved', { payoutId: id });
    payout = await row<ChamaPayout>('payouts', id);
    if (payout.status === 'approved') return dispatchPayout(payout, group);
  }
  return row<ChamaPayout>('payouts', id);
}
export async function applyPayoutStatus(payout: ChamaPayout, paypalStatus: string, itemId?: string, batchId?: string) {
  const succeeded = ['SUCCESS', 'SUCCEEDED'].includes(paypalStatus);
  const failed = ['DENIED', 'FAILED', 'UNCLAIMED', 'RETURNED', 'BLOCKED', 'CANCELED'].includes(paypalStatus);
  // Reversals/returns must override success, but a stale failure must never reopen a completed cycle.
  const values = { paypal_status: paypalStatus, ...(itemId ? { paypal_item_id: itemId } : {}), ...(batchId ? { paypal_batch_id: batchId } : {}), ...(succeeded ? { status: 'succeeded', completed_at: new Date().toISOString() } : failed ? { status: 'failed' } : {}) };
  await update('payouts', payout.id, values);
  if (succeeded) await update('cycles', payout.cycle_id, { status: 'paid_out' });
  return { ...payout, ...values };
}
export async function payoutStatus(id: string) {
  const payout = await row<ChamaPayout>('payouts', id);
  if (!payout.paypal_batch_id) return payout;
  const batch = await getPayoutBatch(payout.paypal_batch_id);
  const status = batch.items?.[0]?.transaction_status ?? batch.batch_header?.batch_status;
  if (!status) throw new Error('PayPal payout status missing');
  const refreshed = await applyPayoutStatus(payout, status, batch.items?.[0]?.payout_item_id);
  if (status !== payout.paypal_status) await logEvent(payout.group_id, 'payout', 'system', `PayPal payout is ${status.toLowerCase()}`, { payoutId: id });
  return refreshed;
}
