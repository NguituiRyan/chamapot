import 'server-only';

export const PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';

export class PayPalApiError extends Error {
  readonly debug_id?: string;
  readonly details?: unknown;
  constructor(readonly status: number, readonly path: string, body: string | Record<string, unknown>) {
    let data: Record<string, unknown> = {};
    try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* non-JSON upstream error */ }
    super(`PayPal ${status} on ${path}: ${String(data.message ?? data.error_description ?? 'request failed')}`);
    this.name = String(data.name ?? 'PayPalApiError');
    this.debug_id = typeof data.debug_id === 'string' ? data.debug_id : undefined;
    this.details = data.details;
  }
}

export function paypalCredentials() {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_SECRET?.trim();
  if (!id || !secret) throw new Error('PayPal sandbox is not configured: set PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env.local');
  return { id, secret };
}

let cachedToken: { value: string; expiresAt: number } | undefined;
let tokenFlight: Promise<string> | undefined;
export async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (tokenFlight) return tokenFlight;
  tokenFlight = (async () => {
    const { id, secret } = paypalCredentials();
    const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());
    const token = await res.json() as { access_token: string; expires_in: number };
    if (!token.access_token || !Number.isFinite(token.expires_in)) throw new Error('Invalid PayPal OAuth token response');
    cachedToken = { value: token.access_token, expiresAt: Date.now() + Math.max(0, token.expires_in - 60) * 1000 };
    return token.access_token;
  })();
  try { return await tokenFlight; } finally { tokenFlight = undefined; }
}

export type PayPalFetchOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; requestId?: string; timeoutMs?: number };
export async function paypalFetch<T = Record<string, unknown>>(path: string, options: PayPalFetchOptions = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('PayPal path must be relative to the sandbox API');
  const method = options.method ?? 'GET';
  const safe = ['GET', 'PUT', 'DELETE'].includes(method) || !!options.requestId;
  for (let attempt = 0; ; attempt++) {
    // Authentication failures are not treated as operation/network retries.
    const token = await accessToken();
    try {
      const res = await fetch(`${PAYPAL_BASE_URL}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.requestId ? { 'PayPal-Request-Id': options.requestId } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      });
      const raw = await res.text();
      if (!res.ok) throw new PayPalApiError(res.status, path, raw);
      return (raw ? JSON.parse(raw) : {}) as T;
    } catch (error) {
      const transient = error instanceof PayPalApiError ? error.status === 429 || error.status >= 500 : error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
      console.error('[paypal]', { method, path, attempt, status: error instanceof PayPalApiError ? error.status : 'transport', debug_id: error instanceof PayPalApiError ? error.debug_id : undefined });
      if (!safe || !transient || attempt >= 3) {
        if (transient && !(error instanceof PayPalApiError)) throw new PayPalApiError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 504 : 502, path, { name: 'PAYPAL_TRANSPORT_ERROR', message: 'PayPal transport failed; retry using the same request id' });
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(4000, 250 * 2 ** attempt)));
    }
  }
}
const get = <T>(path: string) => paypalFetch<T>(path);

// `path` must already carry whatever flag makes the endpoint report `total_pages`.
async function listAll<T>(path: string, key: string, pageSize: number): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const res = await get<{ total_pages?: number } & Record<string, unknown>>(
      `${path}${sep}page_size=${pageSize}&page=${page}`,
    );
    items.push(...((res[key] as T[] | undefined) ?? []));
    if (page >= (res.total_pages ?? 1)) return items;
  }
}

export type Money = { value: string; currency_code: string };

// PayPal sends amounts as decimal strings; missing amounts count as 0.
export const amountOf = (m?: Money | null) => (m?.value === undefined ? 0 : Number(m.value));

// --- Catalog products & billing plans ------------------------------------------

export type Product = {
  id: string;
  name: string;
  description?: string;
  type?: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  category?: string;
  create_time: string;
};

export type IntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export type BillingCycle = {
  frequency: { interval_unit: IntervalUnit; interval_count: number };
  tenure_type: 'REGULAR' | 'TRIAL';
  sequence: number;
  total_cycles: number;
  pricing_scheme?: { fixed_price?: Money };
};

export type Plan = {
  id: string;
  product_id: string;
  name: string;
  status: 'CREATED' | 'INACTIVE' | 'ACTIVE';
  create_time: string;
  billing_cycles: BillingCycle[];
  payment_preferences?: { setup_fee?: Money };
};

// The list endpoints return summaries (no product type/category, no billing cycles),
// so each record is fetched in full.
export async function listProducts(): Promise<Product[]> {
  const summaries = await listAll<{ id: string }>('/v1/catalogs/products?total_required=true', 'products', 20);
  return Promise.all(summaries.map((p) => get<Product>(`/v1/catalogs/products/${encodeURIComponent(p.id)}`)));
}

export async function listPlans(): Promise<Plan[]> {
  const summaries = await listAll<{ id: string }>('/v1/billing/plans?total_required=true', 'plans', 20);
  return Promise.all(summaries.map((p) => get<Plan>(`/v1/billing/plans/${encodeURIComponent(p.id)}`)));
}

// --- Invoicing -------------------------------------------------------------------

export type InvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SCHEDULED'
  | 'UNPAID'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'PARTIALLY_PAID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'MARKED_AS_REFUNDED'
  | 'CANCELLED';

export type Invoice = {
  id: string;
  status: InvoiceStatus;
  detail: {
    invoice_number: string;
    currency_code: string;
    invoice_date?: string;
    payment_term?: { term_type?: string; due_date?: string };
  };
  primary_recipients?: {
    billing_info?: {
      name?: { full_name?: string };
      business_name?: string;
      email_address?: string;
    };
  }[];
  items?: {
    id?: string;
    name: string;
    quantity: string;
    unit_amount: Money;
    unit_of_measure?: string;
    tax?: { percent?: string; amount?: Money };
    discount?: { percent?: string; amount?: Money };
  }[];
  amount?: Money & { breakdown?: { tax_total?: Money; shipping?: { amount?: Money } } };
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: { payment_id?: string; payment_date?: string; method?: string; amount: Money }[];
  };
  refunds?: {
    refund_amount?: Money;
    transactions?: { recipient_transaction_id?: string; refund_date?: string; method?: string; amount: Money }[];
  };
};

// The list omits line items, payments and refunds; the detail endpoint has them.
export async function listInvoices(): Promise<Invoice[]> {
  const summaries = await listAll<{ id: string }>('/v2/invoicing/invoices?total_required=true', 'items', 100);
  return Promise.all(summaries.map((i) => get<Invoice>(`/v2/invoicing/invoices/${encodeURIComponent(i.id)}`)));
}

// --- Transaction Search & balances -------------------------------------------------

export type Transaction = {
  transaction_info: {
    transaction_id: string;
    paypal_reference_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: Money;
    fee_amount?: Money;
    transaction_status?: string;
    ending_balance?: Money;
    transaction_subject?: string;
    transaction_note?: string;
    custom_field?: string;
  };
  payer_info?: { email_address?: string };
};

// Transaction Search allows ranges of at most 31 days and rejects fractional seconds.
export const TRANSACTION_SEARCH_MAX_DAYS = 31;

export function searchTransactions(start: Date, end: Date): Promise<Transaction[]> {
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  return listAll<Transaction>(
    `/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&fields=all`,
    'transaction_details',
    500,
  );
}

export type Balances = {
  as_of_time?: string;
  balances?: { currency: string; total_balance?: Money; available_balance?: Money; withheld_balance?: Money }[];
};

export function getBalances(): Promise<Balances> {
  return get<Balances>('/v1/reporting/balances');
}

