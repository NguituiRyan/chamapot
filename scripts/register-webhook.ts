import { runScript } from './runtime';

export const webhookEventTypes = ['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.CANCELLED', 'PAYMENT.PAYOUTSBATCH.SUCCESS', 'PAYMENT.PAYOUTSBATCH.DENIED', 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', 'PAYMENT.PAYOUTS-ITEM.FAILED', 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED', 'PAYMENT.CAPTURE.COMPLETED'];
runScript(async () => {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!site) throw new Error('Set NEXT_PUBLIC_SITE_URL to your public HTTPS origin before registering the webhook');
  const origin = new URL(site);
  if (origin.protocol !== 'https:') throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS for PayPal webhooks');
  const url = new URL('/api/paypal/webhook', origin).toString();
  const { paypalFetch } = await import('../lib/paypal/rest');
  type Hook = { id: string; url: string; event_types?: { name: string }[] };
  const hooks = await paypalFetch<{ webhooks: Hook[] }>('/v1/notifications/webhooks');
  let hook = hooks.webhooks?.find(h => h.url === url);
  if (!hook) hook = await paypalFetch<Hook>('/v1/notifications/webhooks', { method: 'POST', body: { url, event_types: webhookEventTypes.map(name => ({ name })) } });
  console.info(`PAYPAL_WEBHOOK_ID=${hook.id}`);
  console.info(`Webhook URL: ${url}`);
  const missing = webhookEventTypes.filter(name => !hook.event_types?.some(t => t.name === name || t.name === '*'));
  if (missing.length) console.warn(`Existing webhook is missing event subscriptions: ${missing.join(', ')}. Update it in the sandbox dashboard.`);
});
