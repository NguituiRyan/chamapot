# ChamaPot build plan

Deadline Thu 12 Nov 2026 12:00 PST (23:00 EAT). Checkpoint 1: Fri 6 Nov (Claude drives AG Studio, else Bryntum).
Checkpoint 2: Mon 9 Nov (full sandbox loop on the hosted URL, logged out, at 375px).

## Foundation (coordinator)
- [x] Starter copied, deps upgraded (AG Studio 3.1, AI SDK 7, Supabase, PayPal SDKs), MIT licence
- [x] Supabase schema + RLS + realtime (chama_* in shared project), Umoja Sisters demo seed
- [x] Shared types, snapshot loader, Supabase clients, contracts doc, footer credit
- [ ] Credentials from the team: PayPal sandbox app, Anthropic key, AG Studio trial key, Supabase secret key
- [ ] APIMatic context plugin installed (Claude Code + Codex), `.mcp.json` committed

## Money layer (Codex)
- [ ] PayPal REST helper (token reuse, request ids derived from chama/cycle/member), Invoicing, Payouts
- [ ] Webhook route: signature verification, idempotency, invoice paid / payout events
- [ ] Contribution routes: create invoices, record cash, remind (Agent Toolkit)
- [ ] Payout routes: propose (recipient rule), approve (2 officials) -> Payouts, status refresh
- [ ] Fines via Orders v2 + reconcile via Transaction Search (paypal-server-sdk)
- [ ] Scripts: seed:paypal, paypal:webhook; vitest tests; docs/apimatic evidence

## AG Studio dashboard (Agent A)
- [ ] Chama data model in Studio (members, cycles, contributions, payouts, rules) with descriptions
- [ ] Report: This cycle / Ledger / Payouts & approvals / Rules; ChamaPot theme
- [ ] Custom widgets: pot progress, rotation wheel, approval tracker
- [ ] Live data: Supabase realtime -> applyTransaction (cells flash)
- [ ] Context menu (send reminder / record cash), drill-through to member statement, 375px layout

## Treasurer agent (Agent C)
- [ ] Claude adapter for the Studio Direct LLM Runner + /api/ai/claude (rate limited)
- [ ] Custom primary Treasurer agent delegating to built-in Data/Planning/Page/Widget agents
- [ ] Chama tools: late members, rotation status, send reminder, propose payout; aiToolDisplay labels

## Experience (Agent D)
- [ ] Landing page (story, how it works, Built with PayPal + Claude + AG Studio)
- [ ] Rules: upload constitution -> Claude extraction with quotes + confidence -> apply
- [ ] Approvals page with role switcher; member statement (pay fine with PayPal JS SDK v6); activity feed
- [ ] App shell/nav, 404, 375px, footer everywhere

## Integration and ship (coordinator)
- [ ] Integrate, `npm run build`, fix
- [ ] GitHub repo NguituiRyan/chamapot, Vercel deploy, chamapot.rytrix.co.ke, register PayPal webhook
- [ ] End-to-end sandbox loop on the hosted URL; 375px check; Codex review
- [ ] README "For judges", Devpost story, demo video script
