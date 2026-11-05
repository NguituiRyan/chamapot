# ChamaPot build plan

Deadline Thu 12 Nov 2026 12:00 PST (23:00 EAT). Checkpoint 1 (Claude drives AG Studio): **PASSED Thu 5 Nov**.
Checkpoint 2: Mon 9 Nov (full sandbox loop on the hosted URL, logged out, at 375px).

## Foundation (coordinator)
- [x] Starter copied, deps upgraded (AG Studio 3.1, AI SDK 7, Supabase, PayPal SDKs), MIT licence
- [x] Supabase schema + RLS + realtime (chama_* in shared project), Umoja Sisters demo seed
- [x] Shared types, snapshot loader, Supabase clients, contracts doc, footer credit
- [x] Anthropic key (Claude Sonnet 5.5 everywhere)
- [ ] Credentials from the team: PayPal sandbox app + sandbox personal email, AG Studio trial key, Supabase secret key
- [x] APIMatic context plugin installed (Claude Code + Codex), `.mcp.json` committed

## Money layer (Codex)
- [x] PayPal REST helper (token reuse, deterministic request ids), Invoicing, Payouts
- [x] Webhook route: self-verified signatures, idempotency, invoice paid / payout events
- [x] Contribution routes: create invoices, record cash, remind (Agent Toolkit + REST fallback)
- [x] Payout routes: propose (rotation rule, 409 incl. non-members), approve (2 officials) -> Payouts, status
- [x] Fines via Orders v2 + reconcile via Transaction Search (paypal-server-sdk)
- [x] Scripts: seed:paypal, paypal:webhook; 26 vitest tests; docs/apimatic evidence
- [ ] Live sandbox run (needs PayPal + Supabase secret)

## AG Studio dashboard (Agent A)
- [x] Chama data model in Studio with descriptions, measures, relationships
- [x] Report: This cycle / Ledger / Payouts & approvals / Rules; ChamaPot theme
- [x] Custom widgets: pot progress, rotation wheel, approval tracker (formatShape + ai)
- [x] Live data: Supabase realtime -> applyTransaction (cells flash) + 20s polling fallback
- [x] Context menu (reminder / record cash / statement), drill-through, focus mode, 375px layout

## Treasurer agent (Agent C)
- [x] Claude adapter for the Studio Direct LLM Runner + /api/ai/claude (rate limited)
- [x] Custom primary Treasurer agent delegating to built-in Data/Planning/Page/Widget agents
- [x] Chama tools + display labels; verified live on /dashboard ("Who's behind this cycle?")

## Experience (Agent D)
- [x] Landing page with live pot preview
- [x] Rules: constitution -> Claude extraction with quotes, confidence, review flags (verified live)
- [x] Approvals, member statements (JS SDK v6 fine button), realtime activity feed, role switcher
- [x] App shell/nav, 404, 375px, footer everywhere

## Integration and ship (coordinator)
- [x] Integrate, `npm run build` passes, browser check desktop + 375px
- [x] Vercel deploy (project `chamapot`, framework pinned in vercel.json), live at https://chamapot.rytrix.co.ke
- [x] Private GitHub repo NguituiRyan/chamapot
- [ ] Add PayPal / Supabase secret / AG Studio env vars on Vercel, redeploy
- [ ] `npm run seed:paypal` (real invoices for cycle 7), `npm run paypal:webhook` (webhook -> PAYPAL_WEBHOOK_ID)
- [ ] Dashboard first-load speed (AG Studio bundle; consider Vercel region dub1 next to Supabase eu-west-1)
- [ ] End-to-end sandbox loop on the hosted URL; 375px check; Codex review
- [ ] README final (architecture diagram, video link), Devpost story, demo video script
- [ ] GitHub repo NguituiRyan/chamapot made public for submission
