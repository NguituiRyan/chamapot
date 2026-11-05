import { accessToken, PAYPAL_BASE_URL, paypalCredentials, paypalFetch } from './rest';
import { requestId } from './request-id';
import type { ChamaGroup, ChamaCycle, ChamaMember, ChamaContribution } from '@/lib/chama/types';

export interface PayPalInvoice {
  id: string;
  status?: string;
  detail?: { invoice_number?: string; metadata?: { recipient_view_url?: string } };
  links?: { rel: string; href: string }[];
}
export function invoiceNumber(group: ChamaGroup, cycle: ChamaCycle, member: ChamaMember) {
  return `${group.slug.split('-')[0].toUpperCase()}-C${cycle.number}-${member.handle.toUpperCase()}`;
}
export async function createDraft(group: ChamaGroup, cycle: ChamaCycle, member: ChamaMember, contribution: ChamaContribution) {
  return paypalFetch<PayPalInvoice>('/v2/invoicing/invoices', {
    method: 'POST', requestId: requestId('invoice', group.slug, cycle.number, member.handle),
    body: {
      detail: { invoice_number: invoiceNumber(group, cycle, member), currency_code: 'USD', payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: cycle.due_on }, note: `${cycle.label} contribution for ${group.name}. Cash payments are recorded by an official.` },
      invoicer: { business_name: group.name }, primary_recipients: [{ billing_info: { email_address: member.email } }],
      items: [{ name: `${cycle.label} contribution — ${group.name}`, quantity: '1', unit_amount: { currency_code: 'USD', value: Number(contribution.amount).toFixed(2) } }],
    },
  });
}
export const getInvoice = (id: string) => paypalFetch<PayPalInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(id)}`);
export const payerViewUrl = (invoice: PayPalInvoice) => invoice.detail?.metadata?.recipient_view_url ?? invoice.links?.find(l => ['payer-view', 'recipient_view', 'payer_view'].includes(l.rel))?.href ?? null;
export async function sendInvoice(id: string, deterministicId: string) {
  await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { method: 'POST', requestId: `${deterministicId}-send`, body: { send_to_recipient: true } });
}
export async function recordCashPayment(invoiceId: string, amount: number, date: string, note: string, deterministicId = `chamapot-record-payment-${invoiceId}`) {
  return paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: 'POST', requestId: deterministicId, body: { method: 'CASH', payment_date: date.slice(0, 10), amount: { currency_code: 'USD', value: amount.toFixed(2) }, note } });
}

export async function remind(invoiceId: string, note: string, deterministicId = `chamapot-remind-${invoiceId}`) {
  // Toolkit 1.11 wraps all errors in a JSON string; inspect that result explicitly.
  // A timeout is ambiguous: do not start a second reminder while Axios may still finish.
  let attempted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/ai-sdk');
    const { id, secret } = paypalCredentials();
    const toolkit = new PayPalAgentToolkit({ clientId: id, clientSecret: secret, configuration: { actions: { invoices: { sendReminder: true } }, context: { sandbox: true, request_id: deterministicId } } });
    // Toolkit 1.11 ignores context.access_token and defaults to api.sandbox.paypal.com.
    // Adapt its public client methods so EVERY call uses our sandbox host and bounded OAuth cache.
    toolkit.client.getBaseUrl = () => PAYPAL_BASE_URL;
    toolkit.client.getHeaders = async () => ({ Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': deterministicId });
    const execute = toolkit.getTools().send_invoice_reminder?.execute;
    if (!execute) throw new Error('Toolkit reminder execute is unavailable');
    attempted = true;
    console.info('[paypal.reminder]', { path: 'agent-toolkit', invoiceId, phase: 'execute' });
    const result = await Promise.race([
      execute({ invoice_id: invoiceId, note, send_to_recipient: true }, { toolCallId: deterministicId, messages: [] }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Toolkit reminder deadline exceeded; delivery is uncertain')), 15_000); }),
    ]);
    const parsed = typeof result === 'string' ? (result ? JSON.parse(result) : {}) : result;
    if (parsed && typeof parsed === 'object' && ('error' in parsed || ('ok' in parsed && parsed.ok === false))) {
      // Only a definite 4xx rejection is safe to fall back from; transport errors are ambiguous.
      const description = JSON.stringify(parsed);
      const status = 'status' in parsed ? Number(parsed.status) : undefined;
      if (![400, 404, 422].includes(status ?? 0)) throw new Error(`Toolkit reminder failed; delivery is uncertain: ${description.slice(0, 200)}`);
      attempted = false;
      throw new Error('Toolkit rejected reminder');
    }
    console.info('[paypal.reminder]', { path: 'agent-toolkit', invoiceId });
    return { path: 'agent-toolkit' };
  } catch (error) {
    if (attempted) throw error;
    console.info('[paypal.reminder]', { path: 'rest-fallback', invoiceId });
    await paypalFetch(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`, { method: 'POST', body: { note, send_to_recipient: true } });
    return { path: 'rest-fallback' };
  } finally { if (timer) clearTimeout(timer); }
}
