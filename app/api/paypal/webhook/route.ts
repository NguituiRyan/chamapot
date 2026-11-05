import { MoneyError, route } from '@/lib/chama/server/errors';
import { applyWebhookEvent, webhookSchema } from '@/lib/chama/server/webhook';
import { verifyWebhook } from '@/lib/paypal/webhooks';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return route(async () => {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1_000_000) throw new MoneyError(413, 'Webhook body exceeds 1 MB');
    if (!await verifyWebhook(raw, request.headers)) throw new MoneyError(401, 'Invalid PayPal webhook signature');
    return applyWebhookEvent(webhookSchema.parse(JSON.parse(raw)));
  });
}
