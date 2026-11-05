import { paypalFetch } from './rest';
import { requestId } from './request-id';
import type { ChamaGroup, ChamaCycle, ChamaMember } from '@/lib/chama/types';

export interface PayoutBatch { batch_header?: { payout_batch_id: string; batch_status: string; sender_batch_header?: { sender_batch_id?: string } }; items?: { payout_item_id?: string; transaction_status?: string }[] }
export async function sendPayout(group: ChamaGroup, cycle: ChamaCycle, recipient: ChamaMember, amount: number) {
  const id = requestId('payout', group.slug, cycle.number);
  const receiver = process.env.PAYPAL_SANDBOX_PERSONAL_EMAIL?.trim() || recipient.email;
  const batch = await paypalFetch<PayoutBatch>('/v1/payments/payouts', { method: 'POST', requestId: id, body: {
    sender_batch_header: { sender_batch_id: id, email_subject: 'Your Umoja Sisters pot is here', email_message: `${cycle.label} pot from ${group.name}` },
    items: [{ recipient_type: 'EMAIL', receiver, amount: { currency: 'USD', value: amount.toFixed(2) }, sender_item_id: id, note: `${cycle.label} pot` }],
  } });
  if (!batch.batch_header?.payout_batch_id) throw new Error('PayPal payout response has no batch id; retry using the same sender batch id');
  return { batch, receiver, scheduledEmail: recipient.email, sandboxStandIn: receiver !== recipient.email, senderBatchId: id };
}
export const getPayoutBatch = (id: string) => paypalFetch<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(id)}?page_size=1000`);
