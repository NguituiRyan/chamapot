@AGENTS.md

# ChamaPot — the AI treasurer for your chama

PayPal AI Hackathon 2026 entry (Devpost). Deadline **Thu 12 Nov 2026 12:00 PST (23:00 EAT)**; judging 1–15 Dec
(the hosted demo must keep working until 15 Dec). Team: Rytrix (Nairobi). Built from PayPal's AG Studio
hackathon starter (paypaldev/hackathon-paypal-ag-grid-boilerplate), heavily modified.

**Read `docs/CONTRACTS.md` first** — product story, ownership, HTTP API, brand tokens. Build plan: `docs/PLAN.md`.
Research behind every decision: `docs/research/reports/`.

## Users
Chama officials (chair Grace, treasurer Akinyi, secretary Mumbi) and members (Nairobi cash payers, diaspora
PayPal payers). Demo mode: "Viewing as" role switcher, no sign-in.

## Stack
Next.js 16.3 App Router + React 19 + Tailwind 4 + TS · AG Studio 3.1 (+ Studio Agent Framework) · Claude via
AI SDK 7 (`@ai-sdk/anthropic`) · Supabase (shared project `tkuareehtpbbbahneift`, **chama_* tables only**) ·
PayPal sandbox: Invoicing v2, Payouts v1, Webhooks, Orders v2 + Transaction Search via `@paypal/paypal-server-sdk`,
`@paypal/agent-toolkit` · Vercel hosting (target: chamapot.rytrix.co.ke).

## Commands
`npm run dev` (port 3000) · `npm run build` · `npx tsc --noEmit` · `npm test` (vitest) ·
`npm run seed:paypal` (real sandbox invoices for the current cycle) · `npm run paypal:webhook` (register webhook).
DB: schema `supabase/migrations/0001_chamapot.sql`, demo data `supabase/seed.sql` (re-runnable).

## Key decisions
- Every contribution (PayPal or cash) lives on a PayPal invoice; cash is recorded via PayPal's record-payment API.
- AI never moves money: the agent proposes, two officials approve, the server pays (PayPal Payouts).
- Payout recipient must be the cycle's scheduled member (server-enforced, 409 otherwise).
- AG Grid is the target sponsor prize; Bryntum Scheduler is the fallback if Claude can't drive AG Studio.
- Shared Supabase project: RLS on, public read of demo data, writes only with the secret key.

## Done criteria
`npm run build` passes · works at 375px · "Built by Rytrix" footer on every page · live URL verified ·
full sandbox loop (invoice → paid webhook → dashboard flash → proposal → 2 approvals → payout) on the hosted URL.
