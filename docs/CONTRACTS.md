# ChamaPot build contracts (read before writing code)

ChamaPot is an AI treasurer for a chama (rotating savings group). Demo chama: **Umoja Sisters** (slug
`umoja-sisters`): 10 women in Nairobi, London, Dallas, Dubai, Minneapolis and Manchester, $50/month each,
$500 pot, rotation of 10. Cycles 1–6 are seeded history; **cycle 7 (November 2026) is collecting** with
3 contributions outstanding (atieno, halima, nyokabi). Wanjiru (Dallas) receives this cycle's pot.

Hackathon: PayPal AI Hackathon (Devpost), deadline Thu 12 Nov 2026 12:00 PST. Judges score Technological
Implementation, Design, Impact, Innovation, Presentation — mostly from a <3 min video. Sponsor target:
**AG Grid** (AG Studio 3.1 + Studio Agent Framework); backup **APIMatic** (PayPal Server SDK + context plugin).

## The story the product must tell (the demo video)
1. Officials upload the chama constitution; **Claude extracts the rules** (amount, due day, fines, rotation,
   two-official approval) with source quotes + confidence → rules enforced in code.
2. Every contribution, PayPal or cash, lives on a **PayPal invoice**. Diaspora members pay the invoice with
   PayPal; Nairobi members pay cash at the meeting and the treasurer **records the cash payment against the
   PayPal invoice** (PayPal "record payment" API). Either way PayPal fires `INVOICING.INVOICE.PAID`.
3. The **verified webhook** updates Supabase → realtime → the **AG Studio dashboard cell flashes** and the
   pot ring fills, no refresh.
4. The **Claude Treasurer agent** (inside AG Studio) answers "who's behind?", sends PayPal invoice
   reminders, builds dashboard widgets by delegating to Studio's built-in agents, and **proposes** the payout
   when the pot is full. It can never move money itself.
5. Two officials approve (the recipient can't approve her own pot) → server sends **PayPal Payouts** →
   payout webhook → done. A request to pay someone not scheduled for this cycle is **refused** by the server.

## Stack (installed; do NOT add packages without telling the coordinator)
Next.js 16.3.6 App Router (read `node_modules/next/dist/docs/` — this Next has breaking changes, see AGENTS.md),
React 19.2, Tailwind 4, TypeScript. ag-studio / ag-studio-react **3.1.0**, ag-grid-community/react 36.3.0.
`ai` 7 + `@ai-sdk/anthropic` 4 + `@ai-sdk/react` 4, `zod` 4, `@supabase/supabase-js`, `@paypal/paypal-server-sdk`
2.5.0 (APIMatic-generated), `@paypal/agent-toolkit` 1.11, `lucide-react`, `server-only`, dev: `vitest`, `tsx`.
Claude model: **`claude-sonnet-5-5` everywhere** (team decision) — env `CHAMAPOT_MODEL` for the Treasurer agent,
`CHAMAPOT_EXTRACT_MODEL` for constitution extraction. Provider: `@ai-sdk/anthropic` with `ANTHROPIC_API_KEY`.

## Shared code (coordinator-owned; import, don't fork)
- `lib/chama/types.ts` — row types + `ChamaSnapshot`, `DEMO_GROUP_SLUG`.
- `lib/chama/snapshot.ts` — `getChamaSnapshot(slug)` (server only).
- `lib/supabase/server.ts` — `supabaseAdmin()` (secret key, writes) / `supabasePublicServer()`.
- `lib/supabase/browser.ts` — `supabaseBrowser()` for realtime.
- `supabase/migrations/0001_chamapot.sql` — schema. **Shared Supabase project: only touch `chama_*` tables.**
- `components/site-footer.tsx` — "Built by Rytrix" credit; must render on every page incl. /dashboard.

## Ownership (one writer per file — stay inside your area)
| Area | Owner | Files |
|---|---|---|
| Money layer (PayPal + API) | **Codex** | `lib/paypal/**`, `lib/chama/server/**`, `app/api/paypal/**`, `app/api/chama/**` (except `rules`), `scripts/**`, `tests/money/**`, `docs/apimatic/**`, `vitest.config.ts` |
| AG Studio dashboard | **Agent A** | `app/dashboard/**` except the AI files below; delete `lib/dashboard-data.ts` |
| Claude adapter + Treasurer agent | **Agent C** | `app/dashboard/studio/ai.ts`, `app/dashboard/studio/claude-adapter.ts`, `app/dashboard/studio/treasurer/**`, `app/api/ai/claude/**`, `lib/ai.ts`, `lib/rate-limit.ts`; delete `app/dashboard/studio/openai-adapter.ts` and `app/api/ai/responses` |
| Experience (landing, rules, approvals, members, activity) | **Agent D** | `app/page.tsx`, `app/(app)/**`, `app/not-found.tsx`, `app/globals.css`, `app/layout.tsx` (keep footer), `components/**` (except site-footer), `app/api/ai/extract-rules/**`, `app/api/chama/rules/**`, `public/**` |

Fixed module contracts between Agent A and Agent C:
- `lib/ai.ts` (C) exports `aiEnabled(): boolean` (true when `ANTHROPIC_API_KEY` is set) and `aiModels(): string[]`
  (first = default). `app/dashboard/page.tsx` (A) passes `aiModels={aiEnabled() ? aiModels() : undefined}`.
- `app/dashboard/studio/ai.ts` (C) exports `buildAi(options: { models: string[]; slug: string }): AgAiHarnessSetup`.
  `dashboard.tsx` (A) passes the result to Studio's `ai` prop exactly like the starter does.
- Custom widget types (A) are registered in `app/dashboard/studio/widgets/index.ts` as `chamaWidgets`; each has
  `formatShape` + `ai` so Studio's built-in Widget/Page agents (and C's Treasurer) can place them.
- Member drill-through/links go to `/members/[handle]` (D). Approvals UI is `/approvals` (D).

Integration points between owners are the HTTP routes below and the shared types. If you need something
from another owner, code against the contract and leave a `// CONTRACT:` note; the coordinator integrates.

## HTTP API (implemented by Codex unless noted). All JSON. Errors: `{ error: string }` with 4xx/5xx.
| Route | Body | Returns / behaviour |
|---|---|---|
| `GET /api/chama/snapshot?slug=umoja-sisters` | — | `ChamaSnapshot` (no-store) |
| `POST /api/chama/cycles/current/invoices` | `{ slug }` | Creates + sends a PayPal invoice for every unpaid contribution of the current cycle that has none (cash payers too). Idempotent. `{ created: [...], skipped: [...] }` |
| `POST /api/chama/contributions/:id/record-cash` | `{ recordedBy: handle, note? }` | PayPal "record payment" (method CASH) on the contribution's invoice → PayPal fires INVOICE.PAID. Marks paid immediately too (webhook is the confirmation). |
| `POST /api/chama/contributions/:id/remind` | `{ actor: 'treasurer-agent'|handle }` | PayPal invoice reminder (Agent Toolkit `send_invoice_reminder`, REST fallback). Updates `last_reminded_at`, logs event. Max once / 10 min / contribution. |
| `POST /api/chama/payouts/propose` | `{ slug, cycleId?, recipientHandle?, reason? }` | Validates: pot complete, recipient == cycle's scheduled member, amount == sum paid. Creates `proposed` payout (proposed_by 'treasurer-agent'). Mismatched recipient → **409** `{ error, rule: 'payout_recipient' }`. |
| `POST /api/chama/payouts/:id/approve` | `{ memberHandle, decision: 'approve'|'reject', note? }` | Officials only; recipient can't approve own; one vote each. On reaching `approvals_required` → PayPal Payouts (deterministic `sender_batch_id` + `PayPal-Request-Id`), status `sent`. |
| `GET /api/chama/payouts/:id/status` | — | Refreshes payout status from PayPal (`succeeded`/`failed`). |
| `POST /api/paypal/webhook` | PayPal event | Verifies signature (`PAYPAL_WEBHOOK_ID`), dedupes on event id (`chama_webhook_events`), handles INVOICING.INVOICE.PAID / CANCELLED, PAYMENT.PAYOUTSBATCH.*, PAYMENT.PAYOUTS-ITEM.*; logs `chama_events`. |
| `POST /api/chama/fines/orders` | `{ contributionId }` | PayPal Orders v2 via `@paypal/paypal-server-sdk` → `{ orderId }` for the JS SDK v6 button. |
| `POST /api/chama/fines/orders/:orderId/capture` | `{ contributionId }` | Capture via server SDK → marks `fine_paid`. |
| `POST /api/chama/reconcile` | `{ slug }` | Transaction Search (server SDK) last 31 days vs ledger → `{ matched, unmatched }`. |
| `POST /api/ai/claude` (Agent C) | AG Studio adapter request | Streams Claude turns for the Studio harness. Rate-limited. |
| `POST /api/ai/extract-rules` (Agent D) | multipart `file` (image/PDF) or `{ text }` | Claude → `{ rules: [{ key,label,value,source_quote,confidence }], settings: { contribution_amount, grace_days, late_fine, approvals_required } }` |
| `POST /api/chama/rules` (Agent D) | `{ slug, rules, settings }` | Upserts `chama_rules`, updates group settings, logs event. |

Demo identity: no sign-in. A "Viewing as" role switcher (Agent D, `components/role-switcher.tsx`) stores a
member handle in the `chamapot_as` cookie; officials are grace (chair), akinyi (treasurer), mumbi (secretary).
Routes trust the handle sent in the body (documented as demo mode in the README).

## Brand (all surfaces, AG Studio theme included)
Name **ChamaPot** · tagline "The AI treasurer for your chama." · tone: warm, trustworthy, Kenyan, never cute.
Tokens: `--ink #12261F` · `--pot #0E7C66` (primary) · `--pot-deep #0A5A4A` · `--marigold #F2A93B` (accent/
highlight) · `--clay #C2410C` (late/warning) · `--cream #FBF7F0` (page bg) · `--card #FFFFFF` · `--line #E6DED0`
· `--muted #5E6B66` · success `#15803D` · danger `#B91C1C`. Dark mode: bg `#0E1714`, card `#15211D`, ink `#EAF2EE`.
Fonts (next/font/google): display **Fraunces** (600), body **Inter**. Radius 14px cards, 10px controls.
Money: USD primary (`$50.00`), KES equivalent in muted text (`≈ KES 6,450`, rate from `group.kes_per_usd`).
Mobile: everything must work at **375px** wide.

## Rules for every agent
- Do not run `next build`, `git commit`, `git push`, or start another dev server. A shared dev server runs at
  http://localhost:3000 — use it (and the browser tools) to check your pages. Typecheck with `npx tsc --noEmit`.
- Never put secrets in code or commit `.env*` (only `.env.example`). Read env via `process.env` on the server.
- PayPal: **sandbox only** (`https://api-m.sandbox.paypal.com`). Money moves only via server routes after the
  checks above — never from an AI tool directly.
- When done, report: files changed, what works, what you could not verify, and any contract changes needed.
