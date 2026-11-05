import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './fake-db';
import type { TestRow } from './fake-db';

const state = vi.hoisted(() => ({ tables: {} as Record<string, TestRow[]>, db: undefined as unknown, reminder: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: () => state.db }));
vi.mock('@/lib/chama/snapshot', () => ({ getChamaSnapshot: async () => ({ group: state.tables.chama_groups[0], members: state.tables.chama_members, cycles: state.tables.chama_cycles, contributions: state.tables.chama_contributions, payouts: state.tables.chama_payouts, approvals: state.tables.chama_approvals, currentCycleId: cycleId }) }));
vi.mock('@/lib/paypal/invoices', async importOriginal => ({ ...await importOriginal<object>(), remind: (...args: unknown[]) => state.reminder(...args) }));

import { approvePayout, createCycleInvoices, markContributionPaid, proposePayout, remindContribution } from '@/lib/chama/server/money';
import { applyWebhookEvent, webhookSchema } from '@/lib/chama/server/webhook';
import { route } from '@/lib/chama/server/errors';
import { POST as approveRoute } from '@/app/api/chama/payouts/[id]/approve/route';

const groupId = '10000000-0000-4000-8000-000000000001';
const cycleId = '10000000-0000-4000-8000-000000000002';
const payoutId = '10000000-0000-4000-8000-000000000003';
const contributionId = '10000000-0000-4000-8000-000000000004';
beforeEach(() => {
  state.tables = {
    chama_groups: [{ id: groupId, slug: 'umoja-sisters', name: 'Umoja Sisters', grace_days: 7, late_fine: 5, approvals_required: 2 }],
    chama_cycles: [{ id: cycleId, group_id: groupId, number: 7, label: 'November 2026', due_on: '2026-11-07', recipient_member_id: 'wanjiru', status: 'ready' }],
    chama_members: [
      { id: 'wanjiru', group_id: groupId, handle: 'wanjiru', full_name: 'Wanjiru Kamau', email: 'wanjiru@example.com', role: 'member' },
      { id: 'grace', group_id: groupId, handle: 'grace', full_name: 'Grace Wanjiku', email: 'grace@example.com', role: 'chair' },
      { id: 'akinyi', group_id: groupId, handle: 'akinyi', full_name: 'Akinyi Odhiambo', email: 'akinyi@example.com', role: 'treasurer' },
      { id: 'mumbi', group_id: groupId, handle: 'mumbi', full_name: 'Mumbi Njeri', role: 'secretary' },
    ],
    chama_contributions: [{ id: contributionId, group_id: groupId, cycle_id: cycleId, member_id: 'grace', amount: 50, status: 'paid', paypal_invoice_id: 'INV2-TEST', paypal_invoice_number: 'UMOJA-C7-GRACE', last_reminded_at: null }],
    chama_payouts: [{ id: payoutId, group_id: groupId, cycle_id: cycleId, recipient_member_id: 'wanjiru', amount: 50, status: 'proposed', sent_at: null, sender_batch_id: 'chamapot-payout-umoja-sisters-c7' }],
    chama_approvals: [], chama_events: [], chama_webhook_events: [],
  };
  state.db = fakeDb(state.tables);
  state.reminder.mockReset().mockResolvedValue({ path: 'agent-toolkit' });
});

describe('payout rules', () => {
  it('refuses an unscheduled recipient with HTTP 409 and logs the refusal', async () => {
    const response = await route(() => proposePayout({ slug: 'umoja-sisters', recipientHandle: 'grace' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ rule: 'payout_recipient', error: expect.stringContaining('Grace Wanjiku is not scheduled') });
    expect(state.tables.chama_events[0].summary).toContain('Refused payout to Grace');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forbids the recipient even when she is an official', async () => {
    state.tables.chama_members[0].role = 'chair';
    const response = await route(() => approvePayout(payoutId, { memberHandle: 'wanjiru', decision: 'approve' }));
    expect(response.status).toBe(403);
    expect(state.tables.chama_approvals).toHaveLength(0);
  });
  it('requires the whole pot and rejects ordinary voters', async () => {
    state.tables.chama_contributions[0].status = 'pending';
    expect((await route(() => proposePayout({ slug: 'umoja-sisters' }))).status).toBe(409);
    expect((await route(() => approvePayout(payoutId, { memberHandle: 'wanjiru', decision: 'approve' }))).status).toBe(403);
  });
  it('sends exactly once on the second approval, with deterministic request and batch ids', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'test-id'); vi.stubEnv('PAYPAL_SECRET', 'test-secret');
    vi.stubEnv('PAYPAL_SANDBOX_PERSONAL_EMAIL', 'stand-in@example.com');
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
      if (url.endsWith('/v1/payments/payouts')) return Response.json({ batch_header: { payout_batch_id: 'BATCH-7', batch_status: 'PENDING' } });
      throw new Error('Unexpected URL');
    }));
    await approvePayout(payoutId, { memberHandle: 'grace', decision: 'approve' });
    expect(calls).toHaveLength(0);
    await Promise.all([
      approvePayout(payoutId, { memberHandle: 'akinyi', decision: 'approve' }),
      approvePayout(payoutId, { memberHandle: 'mumbi', decision: 'approve' }),
    ]);
    await approvePayout(payoutId, { memberHandle: 'akinyi', decision: 'approve' });
    const payouts = calls.filter(c => c.url.endsWith('/v1/payments/payouts'));
    expect(payouts).toHaveLength(1);
    const body = JSON.parse(String(payouts[0].init?.body));
    expect(body.sender_batch_header.sender_batch_id).toBe('chamapot-payout-umoja-sisters-c7');
    expect(payouts[0].init?.headers).toMatchObject({ 'PayPal-Request-Id': body.sender_batch_header.sender_batch_id });
    expect(body.items[0].receiver).toBe('stand-in@example.com');
    expect(state.tables.chama_payouts[0].status).toBe('sent');
    expect(state.tables.chama_events.some(e => e.payload?.sandboxStandIn === true)).toBe(true);
  });
  it('enforces a unique vote and rejection closes the payout', async () => {
    await approvePayout(payoutId, { memberHandle: 'grace', decision: 'approve' });
    await approvePayout(payoutId, { memberHandle: 'grace', decision: 'approve' });
    expect(state.tables.chama_approvals).toHaveLength(1);
    await approvePayout(payoutId, { memberHandle: 'akinyi', decision: 'reject' });
    expect(state.tables.chama_payouts[0].status).toBe('rejected');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('route validates invalid input before touching money', async () => {
    const response = await approveRoute(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ memberHandle: 'grace', decision: 'yes' }) }), { params: Promise.resolve({ id: payoutId }) });
    expect(response.status).toBe(400);
    expect(state.tables.chama_approvals).toHaveLength(0);
  });
});

describe('reminder throttle', () => {
  it('returns retry-after and makes no request in the 10 minute window', async () => {
    state.tables.chama_contributions[0].status = 'invoiced';
    state.tables.chama_contributions[0].last_reminded_at = new Date(Date.now() - 60_000).toISOString();
    const response = await route(() => remindContribution(contributionId, 'treasurer-agent'));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(530);
    expect(state.reminder).not.toHaveBeenCalled();
  });
  it('claims the reminder slot atomically so concurrent requests send once', async () => {
    state.tables.chama_contributions[0].status = 'invoiced';
    const results = await Promise.all([route(() => remindContribution(contributionId, 'treasurer-agent')), route(() => remindContribution(contributionId, 'treasurer-agent'))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    expect(state.reminder).toHaveBeenCalledTimes(1);
  });
});

describe('verified webhook application', () => {
  it('deduplicates by event id before processing or logging', async () => {
    const event = webhookSchema.parse({ id: 'WH-UNKNOWN', event_type: 'SOMETHING.NEW', resource: { id: 'x' } });
    expect(await applyWebhookEvent(event)).toEqual({ status: 'processed' });
    expect(await applyWebhookEvent(event)).toEqual({ status: 'duplicate' });
    expect(state.tables.chama_events).toHaveLength(1);
    expect(state.tables.chama_webhook_events).toHaveLength(1);
  });
  it('records cash webhook payment, late fine and ready cycle', async () => {
    state.tables.chama_contributions[0].status = 'invoiced';
    state.tables.chama_cycles[0].status = 'collecting';
    await applyWebhookEvent(webhookSchema.parse({ id: 'WH-PAID', event_type: 'INVOICING.INVOICE.PAID', resource: { id: 'INV2-TEST', payments: { transactions: [{ payment_id: 'PAY-1', method: 'CASH', payment_date: '2026-11-17' }] } } }));
    expect(state.tables.chama_contributions[0]).toMatchObject({ status: 'paid', method: 'cash_recorded', paypal_payment_id: 'PAY-1', days_late: 3, fine: 5 });
    expect(state.tables.chama_cycles[0].status).toBe('ready');
  });
  it('sets payout succeeded and cycle paid_out', async () => {
    state.tables.chama_payouts[0].paypal_batch_id = 'BATCH-7';
    await applyWebhookEvent(webhookSchema.parse({ id: 'WH-PAYOUT', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_batch_id: 'BATCH-7', payout_item_id: 'ITEM-7', transaction_status: 'SUCCESS' } }));
    expect(state.tables.chama_payouts[0]).toMatchObject({ status: 'succeeded', paypal_item_id: 'ITEM-7' });
    expect(state.tables.chama_cycles[0].status).toBe('paid_out');
  });
  it('does not regress a paid-out cycle when another payment confirmation arrives', async () => {
    state.tables.chama_cycles[0].status = 'paid_out';
    await markContributionPaid(state.tables.chama_contributions[0] as any, '2026-11-07T12:00:00Z', 'paypal');
    expect(state.tables.chama_cycles[0].status).toBe('paid_out');
  });
});

it('creates and sends an invoice, persists the payer link and skips it on the next run', async () => {
  const c = state.tables.chama_contributions[0];
  Object.assign(c, { status: 'pending', paypal_invoice_id: null });
  vi.stubEnv('PAYPAL_CLIENT_ID', 'test'); vi.stubEnv('PAYPAL_SECRET', 'secret');
  let status = 'DRAFT';
  let creates = 0;
  let sends = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
    if (url.endsWith('/v2/invoicing/invoices') && init?.method === 'POST') {
      creates++;
      expect(JSON.parse(String(init.body))).toMatchObject({ detail: { invoice_number: 'UMOJA-C7-GRACE', currency_code: 'USD', payment_term: { due_date: '2026-11-07' } }, invoicer: { business_name: 'Umoja Sisters' }, primary_recipients: [{ billing_info: { email_address: 'grace@example.com' } }] });
      return Response.json({ id: 'INV2-NEW', status: 'DRAFT' });
    }
    if (url.endsWith('/INV2-NEW/send')) { sends++; status = 'SENT'; return new Response(null, { status: 202 }); }
    if (url.endsWith('/INV2-NEW')) return Response.json({ id: 'INV2-NEW', status, detail: { invoice_number: 'UMOJA-C7-GRACE', metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#INV2-NEW' } } });
    throw new Error(`Unexpected mocked URL: ${url}`);
  }));
  expect((await createCycleInvoices('umoja-sisters')).created).toHaveLength(1);
  expect(c).toMatchObject({ status: 'invoiced', paypal_invoice_id: 'INV2-NEW', paypal_invoice_url: 'https://www.sandbox.paypal.com/invoice/p/#INV2-NEW' });
  expect((await createCycleInvoices('umoja-sisters')).skipped).toHaveLength(1);
  expect(creates).toBe(1); expect(sends).toBe(1);
});
