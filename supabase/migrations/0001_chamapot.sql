-- ChamaPot schema. Lives in a SHARED Supabase project, so every object is prefixed chama_.
-- Reads: public (demo data only, read-only via RLS select policies) so the browser can subscribe to
-- realtime changes. Writes: server only, with the secret key (no insert/update/delete policies).

create table if not exists public.chama_groups (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  currency text not null default 'USD',
  contribution_amount numeric(12,2) not null,
  cycle_frequency text not null default 'monthly',
  meeting_place text,
  meeting_day text,
  grace_days int not null default 7,
  late_fine numeric(12,2) not null default 0,
  approvals_required int not null default 2,
  kes_per_usd numeric(10,2) not null default 129.00,
  created_at timestamptz not null default now()
);

create table if not exists public.chama_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chama_groups(id) on delete cascade,
  handle text not null,
  full_name text not null,
  email text not null,
  phone text,
  city text not null,
  country text not null,
  role text not null default 'member' check (role in ('member','chair','treasurer','secretary')),
  pays_via text not null default 'paypal' check (pays_via in ('paypal','cash')),
  rotation_position int not null,
  avatar_color text,
  joined_on date not null default current_date,
  unique (group_id, handle),
  unique (group_id, rotation_position)
);

create table if not exists public.chama_cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chama_groups(id) on delete cascade,
  number int not null,
  label text not null,
  starts_on date not null,
  due_on date not null,
  payout_on date not null,
  recipient_member_id uuid not null references public.chama_members(id),
  target_amount numeric(12,2) not null,
  status text not null default 'upcoming' check (status in ('upcoming','collecting','ready','paid_out')),
  unique (group_id, number)
);

create table if not exists public.chama_contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chama_groups(id) on delete cascade,
  cycle_id uuid not null references public.chama_cycles(id) on delete cascade,
  member_id uuid not null references public.chama_members(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','invoiced','paid','late')),
  method text check (method in ('paypal','cash_recorded')),
  paypal_invoice_id text,
  paypal_invoice_number text,
  paypal_invoice_url text,
  paypal_payment_id text,
  paid_at timestamptz,
  days_late int not null default 0,
  fine numeric(12,2) not null default 0,
  fine_paid boolean not null default false,
  last_reminded_at timestamptz,
  is_seed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (cycle_id, member_id)
);

create table if not exists public.chama_payouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chama_groups(id) on delete cascade,
  cycle_id uuid not null unique references public.chama_cycles(id) on delete cascade,
  recipient_member_id uuid not null references public.chama_members(id),
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  status text not null default 'proposed' check (status in ('proposed','approved','sent','succeeded','failed','rejected')),
  proposed_by text not null default 'treasurer-agent',
  reason text,
  sender_batch_id text unique,
  paypal_batch_id text,
  paypal_item_id text,
  paypal_status text,
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.chama_approvals (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.chama_payouts(id) on delete cascade,
  member_id uuid not null references public.chama_members(id),
  decision text not null check (decision in ('approve','reject')),
  note text,
  created_at timestamptz not null default now(),
  unique (payout_id, member_id)
);

create table if not exists public.chama_rules (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chama_groups(id) on delete cascade,
  key text not null,
  label text not null,
  value text not null,
  source_quote text,
  confidence numeric(4,3),
  extracted_by text not null default 'seed',
  created_at timestamptz not null default now(),
  unique (group_id, key)
);

-- Activity feed + audit log: webhooks received, agent actions, approvals, payouts.
create table if not exists public.chama_events (
  id bigint generated always as identity primary key,
  group_id uuid references public.chama_groups(id) on delete cascade,
  kind text not null,
  actor text not null,
  summary text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Idempotency for PayPal webhooks (PayPal retries deliveries). Never exposed to the browser.
create table if not exists public.chama_webhook_events (
  id text primary key,
  event_type text not null,
  resource_id text,
  verified boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists chama_contributions_cycle_idx on public.chama_contributions(cycle_id);
create index if not exists chama_contributions_member_idx on public.chama_contributions(member_id);
create index if not exists chama_contributions_invoice_idx on public.chama_contributions(paypal_invoice_id);
create index if not exists chama_events_group_created_idx on public.chama_events(group_id, created_at desc);
create index if not exists chama_members_group_idx on public.chama_members(group_id);
create index if not exists chama_cycles_group_idx on public.chama_cycles(group_id);
create index if not exists chama_cycles_recipient_idx on public.chama_cycles(recipient_member_id);
create index if not exists chama_payouts_group_idx on public.chama_payouts(group_id);
create index if not exists chama_payouts_recipient_idx on public.chama_payouts(recipient_member_id);
create index if not exists chama_approvals_member_idx on public.chama_approvals(member_id);
create index if not exists chama_rules_group_idx on public.chama_rules(group_id);
create index if not exists chama_contributions_group_idx on public.chama_contributions(group_id);

create or replace function public.chama_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists chama_contributions_touch on public.chama_contributions;
create trigger chama_contributions_touch before update on public.chama_contributions
  for each row execute function public.chama_touch_updated_at();

-- RLS: on for everything; public read of demo data; no write policies (server uses the secret key).
alter table public.chama_groups enable row level security;
alter table public.chama_members enable row level security;
alter table public.chama_cycles enable row level security;
alter table public.chama_contributions enable row level security;
alter table public.chama_payouts enable row level security;
alter table public.chama_approvals enable row level security;
alter table public.chama_rules enable row level security;
alter table public.chama_events enable row level security;
alter table public.chama_webhook_events enable row level security;

create policy "chama demo read" on public.chama_groups for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_members for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_cycles for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_contributions for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_payouts for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_approvals for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_rules for select to anon, authenticated using (true);
create policy "chama demo read" on public.chama_events for select to anon, authenticated using (true);
-- chama_webhook_events: no policies at all => invisible to anon/authenticated.

-- Realtime: the dashboard flashes when these change.
alter publication supabase_realtime add table public.chama_contributions;
alter publication supabase_realtime add table public.chama_payouts;
alter publication supabase_realtime add table public.chama_approvals;
alter publication supabase_realtime add table public.chama_events;
