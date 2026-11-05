# ChamaPot PayPal sandbox implementation

All PayPal calls target `https://api-m.sandbox.paypal.com`. Credentials are read lazily; importing the money layer does not require configured secrets. Shared database writes use `supabaseAdmin()` and only `chama_*` tables. Identity handles are trusted demo identity, per CONTRACTS.md; this is not production authentication.

## Server SDK 2.5.0 calls

| Controller | Method | Purpose | Request identity |
| --- | --- | --- | --- |
| OrdersController | createOrder | Create a USD fine order with contribution customId and unique invoiceId | `chamapot-fine-order-<slug>-c<N>-<handle>` via paypalRequestId |
| OrdersController | getOrder | Check ownership, amount, currency, invoice id and existing completion before capture | Read only |
| OrdersController | captureOrder | Capture the approved fine order | `chamapot-fine-capture-<slug>-c<N>-<handle>` via paypalRequestId |
| PaymentsController | getCapturedPayment | Independently confirm completed capture status, currency and amount before setting fine_paid | Read only |
| TransactionSearchController | searchTransactions | Page through the last 31 days with fields=all and pageSize=500 | Read only; explicit page loop |

The client is lazy and reused. It explicitly sets Environment.Sandbox, a 15,000 ms per-request timeout, OAuth clock skew of 60 seconds, and GET-only retries on 429/500/502/503/504 (two retries, 8-second wait budget). Writes have no implicit SDK retries. Caller retries reuse the same paypalRequestId. `sdkCall` applies a 30-second outer deadline and abort signal because an SDK token exchange is a separate request. A failed SDK client is discarded to avoid reusing a rejected cached OAuth promise.

SDK calls return ApiResponse; code consumes `.result`, never raw wire field names. Model interfaces use separate `import type` statements. `ApiError` is normalized to `PayPalApiError`, retaining status, error name, debug_id and details. Error payloads retain snake_case. The mocked negative test uses the real OrdersController with `paypalMockResponse` and an Axios adapter, and asserts `CustomError` plus the serialized headers/body without contacting PayPal.

## REST and Toolkit calls

Invoicing and Payouts use `paypalFetch`; these operations are not in this SDK's Orders/Payments/Transaction Search controllers. REST OAuth uses a shared in-flight token promise, a cache refreshed 60 seconds early, and a 15-second timeout. REST operations use AbortSignal.timeout (default 15 seconds per attempt). Only GET/PUT/DELETE or a call carrying PayPal-Request-Id can retry; retries are limited to network/timeouts, 429 and 5xx, with three bounded exponential waits. Validation and other 4xx responses are not retried. Logs omit tokens, credentials and payment bodies.

| Operation | API | Stable identity / recovery |
| --- | --- | --- |
| Draft invoice | POST /v2/invoicing/invoices | `chamapot-invoice-umoja-sisters-c7-atieno`; invoice_number `UMOJA-C7-ATIENO` |
| Send invoice | POST /v2/invoicing/invoices/:id/send | Same invoice key plus `-send`; persist the draft id before sending; recover existing drafts |
| Record cash | POST /v2/invoicing/invoices/:id/payments | `chamapot-record-payment-<slug>-c<N>-<handle>`; reject remotely paid/cancelled invoices |
| Reminder | Toolkit send_invoice_reminder.execute, then REST /remind if unavailable or definitely rejected | Reserve contribution.last_reminded_at conditionally before sending; 10-minute throttle and Retry-After |
| Payout | POST /v1/payments/payouts | `chamapot-payout-umoja-sisters-c7` is both sender_batch_id and PayPal-Request-Id |
| Payout refresh | GET /v1/payments/payouts/:id | Read only |
| Webhook verification fallback | POST /v1/notifications/verify-webhook-signature | No write retry; signature validation only |

Toolkit 1.11 exposes a public client and getTools(). The integration enables only invoices.sendReminder with sandbox context and calls the tool's execute directly. Public getBaseUrl/getHeaders adapters ensure the required sandbox host and bounded REST OAuth cache; the installed Toolkit otherwise uses api.sandbox.paypal.com and ignores context.access_token. A 15-second deadline bounds the caller. Toolkit Axios itself has no exposed cancellation hook; an ambiguous deadline/network error retains the throttle reservation and does not start a second reminder. Definite 400/404/422 Toolkit rejections or an unavailable tool fall back to REST. The selected path is logged. The REST reminder does not retry an ambiguous POST.

Payouts use the scheduled member email, with PAYPAL_SANDBOX_PERSONAL_EMAIL as an explicit optional stand-in. Audit payloads include receiver, scheduledEmail and sandboxStandIn. Conditional approved-row dispatch claims prevent simultaneous senders; a crashed sender can resume after 120 seconds using exactly the same PayPal batch key. PayPal's own duplicate batch protection remains necessary across process failures. No retry generates a new key.

## Contract routes

Every route validates its input with zod, returns JSON errors, and is force-dynamic with no-store responses. Dynamic params are awaited, following the installed Next.js route-handler guide.

| Route | Behavior |
| --- | --- |
| GET /api/chama/snapshot | Shared ChamaSnapshot; optional slug defaults to umoja-sisters |
| POST /api/chama/cycles/current/invoices | Create/send missing unpaid invoices, recover drafts, return created/skipped |
| POST /api/chama/contributions/:id/record-cash | Officials only; record CASH against invoice, immediately mark paid, compute lateness/fine, log |
| POST /api/chama/contributions/:id/remind | Agent or official; claim throttle window, execute Toolkit/REST reminder, log path |
| POST /api/chama/payouts/propose | Check full pot and scheduled recipient; wrong recipient returns 409 + payout_recipient and refusal event; existing cycle payout reused |
| POST /api/chama/payouts/:id/approve | Officials only, no recipient vote, unique vote; rejection closes proposed payout; required approvals trigger deterministic dispatch |
| GET /api/chama/payouts/:id/status | Read PayPal batch/item state, update payout/cycle and log changes |
| POST /api/paypal/webhook | Verify raw bytes, insert event id first, dedupe, apply contribution/cancellation/payout updates, log unknown events too |
| POST /api/chama/fines/orders | Create SDK order for an outstanding positive fine; persist/reuse order association in chama_events |
| POST /api/chama/fines/orders/:orderId/capture | Validate stored association and PayPal order; capture/confirm with SDK; mark fine_paid |
| POST /api/chama/reconcile | SDK Transaction Search for 31 days; match invoice reference + amount + currency + success, return matched/unmatched and log summary; no automatic money mutation |

Webhook verification signs `transmissionId|transmissionTime|webhookId|unsignedCRC32(raw UTF-8 bytes)` using crypto.verify('sha256'). Certificate downloads require HTTPS, a `.paypal.com` hostname, no credentials/nonstandard port, and no redirects; certificates are cached for one hour. Invalid local verification falls back to PayPal. Missing/invalid signature headers fail closed. Event body is read as text before parsing. Unhandled event types are stored and audited. Failed application releases its dedupe claim so a later PayPal retry can finish idempotent ledger updates.

## Scripts and verification

- `npm run seed:paypal`: lazily load server modules under Node's react-server export condition; validate sandbox credentials, optionally update Wanjiru's stand-in email, create/send current outstanding invoices, print created/skipped rows.
- `npm run paypal:webhook`: validate public HTTPS URL, list hooks, create the required subscriptions if that URL is absent, print PAYPAL_WEBHOOK_ID. An existing hook is reused and missing subscriptions are reported.
- `npm test`: Node Vitest tests, all network blocked unless explicitly mocked. Tests cover request ids, locally generated RSA key/self-signed certificate verification, certificate cache/URL restrictions, safe REST retries, blank configuration, SDK negative testing, invoice lifecycle, recipient/voter rules, unique votes, concurrent dispatch and reminder claims, Toolkit fallback/uncertainty, webhook dedupe/cash/fines/payout/cycle handling.
- Typecheck: `npx tsc --noEmit` (Windows uses npx.cmd where PowerShell blocks the .ps1 shim).

## Limits requiring coordinator follow-up

No PayPal or Supabase requests were made during implementation, and neither script was run. Sandbox account permissions, actual webhook payload shapes/delivery, external subscription setup, and live API responses remain for coordinator live tests.

The existing schema exposes independent REST writes, without a transaction/RPC spanning votes, payout state, webhook receipt, and audit events. Unique constraints and conditional claims cover duplicate votes, simultaneous dispatch, and reminder races, but cannot provide a fully serializable simultaneous reject/final-approval boundary or atomic webhook/audit commit. A database transaction/RPC and durable outbox are required before real-money production use. Schema/migration files were outside the assigned ownership and were not changed. A returned payout is marked failed while its historically completed cycle remains paid_out; an official must resolve the return. Cancelled invoices retain their identity for investigation rather than automatically issuing a replacement. SDK Orders idempotency retention is finite; persisted order associations and invoice ids provide longer-lived protection but are not a substitute for an outbox.
