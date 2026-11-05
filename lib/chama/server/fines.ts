import { CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';
import type { Order } from '@paypal/paypal-server-sdk';
import { paypalSdk, sdkCall } from '@/lib/paypal/sdk';
import { requestId } from '@/lib/paypal/request-id';
import { checked, db, logEvent, update } from './store';
import { contributionContext } from './money';
import { MoneyError } from './errors';

async function context(id: string) {
  const c = await contributionContext(id);
  if (Number(c.contribution.fine) <= 0) throw new MoneyError(409, 'This contribution has no fine to pay');
  return c;
}
export async function createFineOrder(contributionId: string) {
  const { contribution: c, group, cycle, member } = await context(contributionId);
  if (c.fine_paid) throw new MoneyError(409, 'This fine is already paid');
  // Persist order association in the existing event ledger; never accept an arbitrary client order.
  const events = checked(await db().from('chama_events').select('*').eq('group_id', group.id).eq('kind', 'fine-order').contains('payload', { contributionId }).order('created_at', { ascending: false }).limit(1));
  if (events?.[0]?.payload?.orderId) return { orderId: events[0].payload.orderId as string };
  const result = await sdkCall('orders.create', signal => paypalSdk().orders.createOrder({
    paypalRequestId: requestId('fine-order', group.slug, cycle.number, member.handle), prefer: 'return=representation',
    body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ customId: c.id, invoiceId: `chamapot-fine-${c.id}`, description: `${cycle.label} late contribution fine`, amount: { currencyCode: 'USD', value: Number(c.fine).toFixed(2) } }] },
  }, { abortSignal: signal }));
  if (!result.result.id) throw new Error('PayPal order response has no id');
  await logEvent(group.id, 'fine-order', member.handle, `Created fine payment order for ${member.full_name}`, { contributionId, orderId: result.result.id });
  return { orderId: result.result.id };
}
function validateOrder(order: Order, contributionId: string, fine: number) {
  const units = order.purchaseUnits ?? [];
  if (units.length !== 1 || units[0].customId !== contributionId || units[0].invoiceId !== `chamapot-fine-${contributionId}` || units[0].amount?.currencyCode !== 'USD' || units[0].amount?.value !== fine.toFixed(2)) throw new MoneyError(409, 'PayPal order does not match this contribution and fine amount');
}
export async function captureFineOrder(orderId: string, contributionId: string) {
  const { contribution: c, group, cycle, member } = await context(contributionId);
  const events = checked(await db().from('chama_events').select('id').eq('group_id', group.id).eq('kind', 'fine-order').contains('payload', { contributionId, orderId }).limit(1));
  if (!events?.length) throw new MoneyError(409, 'Order was not created for this fine');
  if (c.fine_paid) return { orderId, fine_paid: true, alreadyPaid: true };
  let order = (await sdkCall('orders.get', signal => paypalSdk().orders.getOrder({ id: orderId }, { abortSignal: signal }))).result;
  validateOrder(order, c.id, Number(c.fine));
  if (order.status !== 'COMPLETED') order = (await sdkCall('orders.capture', signal => paypalSdk().orders.captureOrder({ id: orderId, paypalRequestId: requestId('fine-capture', group.slug, cycle.number, member.handle), prefer: 'return=representation' }, { abortSignal: signal }))).result;
  validateOrder(order, c.id, Number(c.fine));
  const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
  if (order.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' || capture.amount?.currencyCode !== 'USD' || capture.amount?.value !== Number(c.fine).toFixed(2)) throw new MoneyError(409, 'Fine payment is not completed');
  if (!capture.id) throw new MoneyError(409, 'Completed capture has no payment id');
  const payment = (await sdkCall('payments.getCapturedPayment', signal => paypalSdk().payments.getCapturedPayment({ captureId: capture.id! }, { abortSignal: signal }))).result;
  if (payment.status !== 'COMPLETED' || payment.amount?.currencyCode !== 'USD' || payment.amount?.value !== Number(c.fine).toFixed(2)) throw new MoneyError(409, 'PayPal Payments has not confirmed the completed fine');
  await update('contributions', c.id, { fine_paid: true });
  await logEvent(group.id, 'contribution', member.handle, `Fine of $${Number(c.fine).toFixed(2)} paid by ${member.full_name}`, { contributionId, orderId, captureId: capture.id });
  return { orderId, fine_paid: true, captureId: capture.id };
}
