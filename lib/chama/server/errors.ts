import { ZodError } from 'zod';
import { PayPalApiError } from '@/lib/paypal/rest';

export class MoneyError extends Error {
  constructor(readonly status: number, message: string, readonly rule?: string, readonly retryAfter?: number) { super(message); this.name = 'MoneyError'; }
}
export async function route(action: () => Promise<unknown>) {
  try { return Response.json(await action(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: error instanceof ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : 'Invalid JSON body' }, { status: 400 });
    if (error instanceof MoneyError) return Response.json({ error: error.message, ...(error.rule ? { rule: error.rule } : {}) }, { status: error.status, headers: error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : undefined });
    if (error instanceof PayPalApiError) return Response.json({ error: error.message, debug_id: error.debug_id }, { status: error.status === 429 ? 429 : 502 });
    console.error('[chamapot.money]', { error: error instanceof Error ? error.message : 'Unknown failure' });
    const message = error instanceof Error && /not configured|set .*KEY|set .*PAYPAL/i.test(error.message) ? error.message : 'Money operation failed. Retry safely or check the server logs.';
    return Response.json({ error: message }, { status: 500 });
  }
}
