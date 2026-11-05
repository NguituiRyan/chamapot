import type { TransactionDetails } from '@paypal/paypal-server-sdk';
import { getChamaSnapshot } from '@/lib/chama/snapshot';
import { paypalSdk, sdkCall } from '@/lib/paypal/sdk';
import { logEvent } from './store';

export async function reconcile(slug: string) {
  const snapshot = await getChamaSnapshot(slug);
  const end = new Date();
  const start = new Date(end.getTime() - 31 * 86_400_000);
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  const transactions: TransactionDetails[] = [];
  for (let page = 1; ; page++) {
    const response = await sdkCall('transactions.search', signal => paypalSdk().transactions.searchTransactions({ startDate: iso(start), endDate: iso(end), fields: 'all', pageSize: 500, page }, { abortSignal: signal }));
    const rows = response.result.transactionDetails ?? [];
    transactions.push(...rows);
    if (page >= (response.result.totalPages ?? 1)) break;
    if (page >= 100) throw new Error('Transaction Search exceeded 100 pages; narrow the reconciliation window');
  }
  const matched = [], unmatched = [];
  const seen = new Set<string>();
  for (const transaction of transactions) {
    const info = transaction.transactionInfo;
    const transactionId = info?.transactionId;
    if (transactionId && seen.has(transactionId)) continue;
    if (transactionId) seen.add(transactionId);
    const references = [transaction.cartInfo?.paypalInvoiceId, info?.invoiceId, info?.paypalReferenceId].filter(Boolean);
    const candidates = snapshot.contributions.filter(c => references.some(id => id === c.paypal_invoice_id || id === c.paypal_invoice_number) && info?.transactionStatus === 'S' && info.transactionAmount?.currencyCode === c.currency && Math.round(Number(info.transactionAmount?.value) * 100) === Math.round(Number(c.amount) * 100));
    // Amount alone is ambiguous (all members pay $50); never use it to assign someone else's payment.
    if (candidates.length === 1) matched.push({ transactionId, contributionId: candidates[0].id, invoiceId: candidates[0].paypal_invoice_id, ledgerStatus: candidates[0].status });
    else unmatched.push({ transactionId, reason: candidates.length ? 'ambiguous invoice' : 'No successful transaction with matching invoice, currency and amount', transaction });
  }
  await logEvent(snapshot.group.id, 'reconcile', 'system', `Reconciled last 31 days: ${matched.length} matched, ${unmatched.length} unmatched PayPal transactions`, { matched: matched.length, unmatched: unmatched.length });
  return { matched, unmatched };
}
