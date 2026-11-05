import { beforeEach, expect, it, vi } from 'vitest';

const toolkitState = vi.hoisted(() => ({ result: {} as unknown, execute: vi.fn(), options: undefined as any, client: undefined as any }));
vi.mock('@paypal/agent-toolkit/ai-sdk', () => ({ PayPalAgentToolkit: class {
  client = { getBaseUrl: () => 'https://api.paypal.com', getHeaders: async () => ({}) };
  constructor(options: unknown) { toolkitState.options = options; toolkitState.client = this.client; }
  getTools() { return { send_invoice_reminder: { execute: toolkitState.execute } }; }
} }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PAYPAL_CLIENT_ID', 'test'); vi.stubEnv('PAYPAL_SECRET', 'secret');
  toolkitState.execute.mockReset().mockImplementation(async () => toolkitState.result);
});

it('executes the toolkit in sandbox and adapts its public client to the required host/cache', async () => {
  toolkitState.result = '{}';
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: 'cached-token', expires_in: 3600 })));
  const { remind } = await import('@/lib/paypal/invoices');
  expect(await remind('INV2-TEST', 'Please pay', 'stable-reminder')).toEqual({ path: 'agent-toolkit' });
  expect(toolkitState.options.configuration).toMatchObject({ context: { sandbox: true, request_id: 'stable-reminder' }, actions: { invoices: { sendReminder: true } } });
  expect(toolkitState.client.getBaseUrl()).toBe('https://api-m.sandbox.paypal.com');
  expect(await toolkitState.client.getHeaders()).toMatchObject({ Authorization: 'Bearer cached-token', 'PayPal-Request-Id': 'stable-reminder' });
  expect(toolkitState.execute).toHaveBeenCalledWith({ invoice_id: 'INV2-TEST', note: 'Please pay', send_to_recipient: true }, expect.anything());
});

it('detects toolkit LlmError JSON and falls back after a definite rejection', async () => {
  toolkitState.result = JSON.stringify({ ok: false, status: 400, code: 'PAYPAL_API_HTTP_ERROR', message: 'Unsupported payload field' });
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return url.endsWith('/v1/oauth2/token') ? Response.json({ access_token: 'token', expires_in: 3600 }) : new Response(null, { status: 204 });
  }));
  const { remind } = await import('@/lib/paypal/invoices');
  expect(await remind('INV2-TEST', 'Please pay', 'stable-reminder')).toEqual({ path: 'rest-fallback' });
  expect(calls).toContain('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-TEST/remind');
});

it('does not send a second reminder after an ambiguous toolkit network failure', async () => {
  toolkitState.result = JSON.stringify({ ok: false, code: 'PAYPAL_API_NO_RESPONSE', message: 'Network error' });
  const { remind } = await import('@/lib/paypal/invoices');
  await expect(remind('INV2-TEST', 'Please pay')).rejects.toThrow('delivery is uncertain');
  expect(fetch).not.toHaveBeenCalled();
});
