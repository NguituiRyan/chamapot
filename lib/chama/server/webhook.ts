import { z } from 'zod';
import type { ChamaContribution, ChamaPayout } from '@/lib/chama/types';
import { checked, db, logEvent } from './store';
import { applyPayoutStatus, markContributionPaid } from './money';

const transaction = z.object({ payment_id: z.string().optional(), payment_date: z.string().optional(), method: z.string().optional(), type: z.string().optional() }).passthrough();
export const webhookSchema = z.object({
  id: z.string().min(1).max(255), event_type: z.string().min(1).max(255), create_time: z.string().optional(),
  resource: z.object({
    id: z.string().optional(), status: z.string().optional(), payout_batch_id: z.string().optional(), payout_item_id: z.string().optional(), transaction_status: z.string().optional(),
    batch_header: z.object({ payout_batch_id: z.string().optional(), batch_status: z.string().optional(), sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).optional() }).passthrough().optional(),
    sender_batch_header: z.object({ sender_batch_id: z.string().optional() }).passthrough().optional(),
    payout_item: z.object({ sender_item_id: z.string().optional() }).passthrough().optional(),
    payments: z.object({ transactions: z.array(transaction).optional() }).passthrough().optional(),
  }).passthrough(),
}).passthrough();
export type WebhookEvent = z.infer<typeof webhookSchema>;

/** Insert before processing. Failed processing releases its claim so PayPal's next delivery can retry. */
export async function applyWebhookEvent(event: WebhookEvent) {
  const inserted = await db().from('chama_webhook_events').insert({ id: event.id, event_type: event.event_type, resource_id: event.resource.id ?? null, verified: true, payload: event });
  if (inserted.error?.code === '23505') return { status: 'duplicate' };
  checked(inserted);
  try {
    const r = event.resource;
    let groupId: string | null = null;
    let summary = `Received PayPal ${event.event_type}`;
    if (event.event_type.startsWith('INVOICING.INVOICE.')) {
      const c = checked(await db().from('chama_contributions').select('*').eq('paypal_invoice_id', r.id ?? '').maybeSingle()) as ChamaContribution | null;
      if (c) {
        groupId = c.group_id;
        if (event.event_type === 'INVOICING.INVOICE.PAID') {
          const payments = r.payments?.transactions ?? [];
          const cash = payments.find(p => ['CASH', 'OTHER'].includes(p.method ?? ''));
          const payment = cash ?? payments[payments.length - 1];
          const candidate = payment?.payment_date ?? event.create_time;
          const paidAt = candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : new Date().toISOString();
          // Preserve the immediate cash entry date/method when webhook omits the recorded payment.
          await markContributionPaid(c, c.paid_at ?? paidAt, cash || c.method === 'cash_recorded' ? 'cash_recorded' : 'paypal', payment?.payment_id);
          summary = `PayPal confirmed contribution ${c.paypal_invoice_number ?? c.id} paid${cash ? ' (cash recorded)' : ''}`;
        } else if (event.event_type === 'INVOICING.INVOICE.CANCELLED') {
          // A cancelled invoice cannot collect money; clear the link for an official to investigate.
          checked(await db().from('chama_contributions').update({ status: 'pending' }).eq('id', c.id).neq('status', 'paid'));
          summary = `PayPal cancelled invoice ${c.paypal_invoice_number ?? c.id}; official attention required`;
        }
      }
    } else if (/^PAYMENT\.PAYOUTS(?:BATCH|-ITEM)\./.test(event.event_type)) {
      const batchId = r.batch_header?.payout_batch_id ?? r.payout_batch_id;
      const senderId = r.batch_header?.sender_batch_header?.sender_batch_id ?? r.sender_batch_header?.sender_batch_id ?? r.payout_item?.sender_item_id;
      let p: ChamaPayout | null = null;
      if (batchId) p = checked(await db().from('chama_payouts').select('*').eq('paypal_batch_id', batchId).maybeSingle()) as ChamaPayout | null;
      if (!p && senderId) p = checked(await db().from('chama_payouts').select('*').eq('sender_batch_id', senderId).maybeSingle()) as ChamaPayout | null;
      if (p) {
        groupId = p.group_id;
        const suffix = event.event_type.split('.').at(-1)!;
        const status = r.transaction_status ?? r.batch_header?.batch_status ?? suffix;
        await applyPayoutStatus(p, status, r.payout_item_id, batchId);
        summary = `PayPal payout ${p.id} ${status.toLowerCase()}`;
      }
    }
    await logEvent(groupId, 'webhook', 'paypal-webhook', summary, { eventId: event.id, eventType: event.event_type, resourceId: r.id });
    return { status: 'processed' };
  } catch (error) {
    checked(await db().from('chama_webhook_events').delete().eq('id', event.id));
    throw error;
  }
}
