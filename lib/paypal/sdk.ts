import { ApiError, Client, Environment, OrdersController, PaymentsController, TransactionSearchController } from '@paypal/paypal-server-sdk';
import { PayPalApiError, paypalCredentials } from './rest';

let instance: ReturnType<typeof createSdk> | undefined;
function createSdk() {
  const { id, secret } = paypalCredentials();
  const client = new Client({ environment: Environment.Sandbox, timeout: 15_000,
    clientCredentialsAuthCredentials: { oAuthClientId: id, oAuthClientSecret: secret, oAuthClockSkew: 60 },
    // POST retries are managed by callers with stable paypalRequestId. No hidden write retries.
    httpClientOptions: { timeout: 15_000, retryConfig: { maxNumberOfRetries: 2, maximumRetryWaitTime: 8, retryInterval: 0.5, backoffFactor: 2, httpMethodsToRetry: ['GET'], httpStatusCodesToRetry: [429, 500, 502, 503, 504] } },
  });
  return { client, orders: new OrdersController(client), payments: new PaymentsController(client), transactions: new TransactionSearchController(client) };
}
export function paypalSdk() { return instance ??= createSdk(); }
export async function sdkCall<T>(path: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PayPalApiError(504, path, { message: 'SDK deadline exceeded; retry with the same request id' })); }, 30_000); })]);
  } catch (error) {
    // OAuth failures can leave a rejected token promise cached by APIMatic's auth adapter.
    // Rebuild lazily on the next request, while retaining the same caller-provided operation key.
    instance = undefined;
    if (error instanceof ApiError) {
      const body = error.result ?? (typeof error.body === 'string' ? error.body : {});
      const wrapped = new PayPalApiError(error.statusCode, path, body as string | Record<string, unknown>);
      console.error('[paypal.sdk]', { path, status: wrapped.status, debug_id: wrapped.debug_id });
      throw wrapped;
    }
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}
