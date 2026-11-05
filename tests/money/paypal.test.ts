import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Client, CustomError, CheckoutPaymentIntent, Environment, OrdersController } from '@paypal/paypal-server-sdk';
import { crc32, trustedCertificateUrl, verifyLocalSignature, verifyWebhook } from '@/lib/paypal/webhooks';
import { requestId } from '@/lib/paypal/request-id';

describe('deterministic request ids', () => {
  it('produces stable invoice, payout, cash, and order ids', () => {
    expect(requestId('invoice', 'umoja-sisters', 7, 'atieno')).toBe('chamapot-invoice-umoja-sisters-c7-atieno');
    expect(requestId('payout', 'umoja-sisters', 7)).toBe('chamapot-payout-umoja-sisters-c7');
    for (const kind of ['invoice', 'record-payment', 'fine-order', 'fine-capture']) expect(requestId(kind, 'umoja-sisters', 7, 'atieno')).toBe(requestId(kind, 'umoja-sisters', 7, 'atieno'));
    expect(requestId('invoice', 'umoja-sisters', 8, 'atieno')).not.toBe(requestId('invoice', 'umoja-sisters', 7, 'atieno'));
  });
  it('keeps long keys bounded without losing deterministic identity', () => {
    const a = requestId('invoice', 'x'.repeat(200), 7, 'atieno');
    expect(a.length).toBeLessThanOrEqual(108);
    expect(a).not.toBe(requestId('invoice', 'x'.repeat(200), 7, 'halima'));
  });
});

describe('webhook certificate verification', () => {
  let pem: string;
  let privateKey: string;
  let directory: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'chamapot-cert-'));
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
    privateKey = pair.privateKey;
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    writeFileSync(keyPath, privateKey);
    // Git for Windows supplies OpenSSL in the task environment; other hosts normally expose it on PATH.
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/mingw64/bin/openssl.exe' : 'openssl';
    execFileSync(openssl, ['req', '-new', '-x509', '-key', keyPath, '-out', certPath, '-subj', '/CN=chamapot-local-test', '-days', '1'], { windowsHide: true, stdio: 'pipe' });
    pem = readFileSync(certPath, 'utf8');
  });
  afterAll(() => {
    if (directory && resolve(directory).startsWith(`${resolve(tmpdir())}${sep}`) && basename(directory).startsWith('chamapot-cert-')) rmSync(directory, { recursive: true, force: true });
  });
  const raw = '{"id":"WH-1","event_type":"TEST","resource":{}}';
  const id = 'transmission-1';
  const time = '2026-11-05T12:00:00Z';
  function signature() { return sign('sha256', Buffer.from(`${id}|${time}|WH-CONFIG|${crc32(raw)}`), privateKey).toString('base64'); }
  it('calculates standard unsigned CRC32', () => { expect(crc32('123456789')).toBe(3421780262); });
  it('verifies a locally generated certificate and rejects altered raw bytes', () => {
    expect(verifyLocalSignature(raw, id, time, 'WH-CONFIG', signature(), pem)).toBe(true);
    expect(verifyLocalSignature(raw + ' ', id, time, 'WH-CONFIG', signature(), pem)).toBe(false);
  });
  it('downloads a trusted certificate once and verifies without the fallback API', async () => {
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'WH-CONFIG');
    const fetchMock = vi.fn(async () => new Response(pem));
    vi.stubGlobal('fetch', fetchMock);
    const headers = new Headers({ 'paypal-transmission-id': id, 'paypal-transmission-time': time, 'paypal-transmission-sig': signature(), 'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/TEST-CERT', 'paypal-auth-algo': 'SHA256withRSA' });
    expect(await verifyWebhook(raw, headers)).toBe(true);
    expect(await verifyWebhook(raw, headers)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toBeDefined();
  });
  it('rejects hostile URLs before downloading anything', () => {
    for (const url of ['https://paypal.com.evil.test/cert', 'http://api.paypal.com/cert', 'https://evilpaypal.com/cert', 'https://api.paypal.com:444/cert', 'https://user:pass@api.paypal.com/cert']) expect(() => trustedCertificateUrl(url)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('REST transport with mocked fetch', () => {
  it('does not retry an unsafe POST, but retries a keyed POST with the same key', async () => {
    vi.resetModules();
    vi.stubEnv('PAYPAL_CLIENT_ID', 'test'); vi.stubEnv('PAYPAL_SECRET', 'secret');
    const { paypalFetch, PayPalApiError } = await import('@/lib/paypal/rest');
    let operationCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'mock-token', expires_in: 3600 });
      operationCalls++;
      return Response.json({ name: 'SERVICE_UNAVAILABLE', debug_id: 'debug-test', message: 'Try later' }, { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(paypalFetch('/unsafe', { method: 'POST', body: {} })).rejects.toBeInstanceOf(PayPalApiError);
    expect(operationCalls).toBe(1);
    operationCalls = 0;
    await expect(paypalFetch('/safe', { method: 'POST', body: {}, requestId: 'stable-key' })).rejects.toMatchObject({ status: 503, name: 'SERVICE_UNAVAILABLE', debug_id: 'debug-test' });
    expect(operationCalls).toBe(4);
    const safeCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/safe'));
    expect(safeCalls).toHaveLength(4);
  });
  it('fails clearly for blank credentials at call time', async () => {
    vi.resetModules(); vi.stubEnv('PAYPAL_CLIENT_ID', ''); vi.stubEnv('PAYPAL_SECRET', '');
    const { paypalFetch } = await import('@/lib/paypal/rest');
    await expect(paypalFetch('/test')).rejects.toThrow('PAYPAL_CLIENT_ID and PAYPAL_SECRET');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('APIMatic SDK negative testing', () => {
  it('serializes paypalMockResponse and raises the generated typed error without network', async () => {
    const captured: { url: string; headers: Record<string, string>; data?: string }[] = [];
    const client = new Client({
      environment: Environment.Sandbox, timeout: 1000,
      clientCredentialsAuthCredentials: { oAuthClientId: 'mock-id', oAuthClientSecret: 'mock-secret', oAuthToken: { accessToken: 'seeded-token', tokenType: 'Bearer', expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) } },
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } },
      unstable_httpClientOptions: { adapter: async (config: { url: string; headers: Record<string, string>; data?: string }) => {
        captured.push(config);
        return { data: JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', message: 'Forced sandbox error', debug_id: 'debug-mock', details: [{ issue: 'INSTRUMENT_DECLINED' }] }), status: 422, statusText: 'Unprocessable Entity', headers: { 'content-type': 'application/json' }, config };
      } },
    });
    const operation = new OrdersController(client).createOrder({ body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ amount: { currencyCode: 'USD', value: '5.00' } }] }, paypalRequestId: 'chamapot-fine-order-umoja-sisters-c7-atieno', paypalMockResponse: JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' }) });
    await expect(operation).rejects.toBeInstanceOf(CustomError);
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(captured[0].headers['PayPal-Request-Id']).toBe('chamapot-fine-order-umoja-sisters-c7-atieno');
    expect(captured[0].headers['PayPal-Mock-Response']).toContain('INSTRUMENT_DECLINED');
    expect(JSON.parse(captured[0].data!)).toMatchObject({ intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '5.00' } }] });
    expect(fetch).not.toHaveBeenCalled();
  });
});
