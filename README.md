# ChamaPot — the AI treasurer for your chama

> PayPal AI Hackathon 2026 entry. A chama (rotating savings group) runs its whole money cycle on PayPal:
> every contribution lives on a PayPal invoice, verified PayPal webhooks update the books live, a Claude
> **Treasurer agent** inside an **AG Studio 3.1** dashboard chases payments and proposes payouts, two
> officials approve, and **PayPal Payouts** sends the pot. The AI never moves money.

## For judges

| | |
|---|---|
| Live demo | https://chamapot.rytrix.co.ke (PayPal **sandbox**; no real money) |
| Demo chama | Umoja Sisters: 10 women in Nairobi, London, Dallas, Dubai, Minneapolis and Manchester, $50/month, $500 pot |
| Sign-in | None. Use **Viewing as** in the header to act as Grace (chair), Akinyi (treasurer), Mumbi (secretary) or a member |
| Video | _(YouTube link)_ |
| Pay an invoice yourself | Open a member statement → PayPal invoice link → pay with a PayPal sandbox personal account |

**Try this in two minutes**
1. `/rules` → **Use the sample constitution** → Claude reads the PDF and extracts the rules with quotes and confidence.
2. `/dashboard` → right-click Halima → **Record cash payment** → PayPal marks the invoice paid → the webhook flashes the ledger.
3. `/dashboard` → AI panel → *"Who's behind this cycle?"*, then *"Remind everyone who hasn't paid"* (real PayPal invoice reminders).
4. When the pot is full → *"Is the pot ready? Propose the payout"* → `/approvals` → approve as Grace, then as Mumbi → PayPal Payouts.
5. Try *"Pay this month's pot to my cousin Jane instead"* → refused: the rotation rule is enforced in code, not in the prompt.

## How we used PayPal

| PayPal product | Where | Why |
|---|---|---|
| Invoicing v2 (create, send, remind, record payment) | `lib/paypal/invoices.ts` | Every contribution, PayPal or cash, is a PayPal invoice, so the books reconcile in one place |
| Webhooks (self-verified signatures, idempotent) | `app/api/paypal/webhook` | `INVOICING.INVOICE.PAID` and payout events drive the live dashboard |
| Payouts v1 | `lib/paypal/payouts.ts` | The pot goes to the scheduled member after two officials approve; deterministic `sender_batch_id` so a retry can't pay twice |
| Orders v2 + JS SDK v6 | member statement, `app/api/chama/fines` | Members pay late fines with the PayPal button |
| Transaction Search | `app/api/chama/reconcile` | Nightly reconciliation of the ledger against PayPal |
| PayPal Agent Toolkit | invoice reminders | The agent's reminder tool runs PayPal's own `send_invoice_reminder` |
| PayPal Server SDK (APIMatic) | `lib/paypal/sdk.ts` | Orders, Payments, Transaction Search, written with APIMatic's Context Plugin (see `docs/apimatic/`) |

## How we used AI

| Model / tool | Role | Limits |
|---|---|---|
| Claude (`claude-sonnet-5-5`) | Reads the chama constitution (PDF or photo) into rules with verbatim quotes and confidence | Low-confidence rules are flagged for an official to review |
| Claude (`claude-sonnet-5-5`) via a custom AG Studio adapter | The Treasurer agent: answers questions, sends PayPal reminders, builds dashboard widgets by delegating to AG Studio's built-in agents, proposes payouts | Can only call the tools we give it; cannot approve or send money |
| AG Studio 3.1 Agent Framework | Harness, built-in Data / Planning / Page / Widget agents | — |

## Trust and safety
- **The AI proposes, humans approve, the server pays.** Payout requires two officials; the recipient can't approve her own pot.
- **Recipient locked to the rotation.** The server refuses any payout to someone not scheduled for the cycle (HTTP 409).
- **No double payments.** Request ids and `sender_batch_id` are derived from chama + cycle + member.
- **Verified webhooks only**, deduplicated by event id. Every action is logged to the activity feed.
- AI endpoints are rate-limited per IP. Keys stay on the server.

## Architecture
_(diagram)_ Next.js 16 (App Router) on Vercel · Supabase (Postgres + Realtime) · PayPal sandbox REST · Claude via AI SDK 7 · AG Studio 3.1.

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in PayPal sandbox, Anthropic, Supabase and AG Studio values
npm run dev
```
Database: apply `supabase/migrations/0001_chamapot.sql`, then `supabase/seed.sql`. Then `npm run seed:paypal`
creates real sandbox invoices for the current cycle and `npm run paypal:webhook` registers the webhook.

## What's real and what's seeded
Cycles 1–6 are seeded history (flagged `is_seed`). Everything in the current cycle is live PayPal sandbox:
invoices, reminders, cash recorded against invoices, webhooks, payouts and fines. Payouts go to a sandbox
personal account standing in for the member.

## Credits
Started from PayPal's AG Studio hackathon starter (`paypaldev/hackathon-paypal-ag-grid-boilerplate`) and rebuilt
for chamas. MIT licence. Built by [Rytrix](https://rytrix.co.ke).
