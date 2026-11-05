import 'server-only';
import { supabaseAdmin, supabasePublicServer } from '@/lib/supabase/server';
import type { ChamaSnapshot } from './types';

// Loads one chama in a single round of parallel queries. Uses the secret-key client when configured,
// otherwise the publishable key (reads are allowed by RLS), so pages render before secrets exist.

function db() {
  return process.env.SUPABASE_SECRET_KEY ? supabaseAdmin() : supabasePublicServer();
}

const num = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T => {
  const out = { ...row };
  for (const k of keys) if (out[k] != null) (out as Record<keyof T, unknown>)[k] = Number(out[k]);
  return out;
};

export async function getChamaSnapshot(slug: string): Promise<ChamaSnapshot> {
  const supabase = db();
  const { data: group, error } = await supabase.from('chama_groups').select('*').eq('slug', slug).single();
  if (error || !group) throw new Error(`Chama "${slug}" not found: ${error?.message ?? 'no row'}`);

  const gid = group.id as string;
  const [members, cycles, contributions, payouts, rules, events] = await Promise.all([
    supabase.from('chama_members').select('*').eq('group_id', gid).order('rotation_position'),
    supabase.from('chama_cycles').select('*').eq('group_id', gid).order('number'),
    supabase.from('chama_contributions').select('*').eq('group_id', gid),
    supabase.from('chama_payouts').select('*').eq('group_id', gid).order('created_at'),
    supabase.from('chama_rules').select('*').eq('group_id', gid).order('created_at'),
    supabase.from('chama_events').select('*').eq('group_id', gid).order('created_at', { ascending: false }).limit(100),
  ]);
  for (const r of [members, cycles, contributions, payouts, rules, events]) {
    if (r.error) throw new Error(`Loading chama "${slug}": ${r.error.message}`);
  }
  const payoutIds = (payouts.data ?? []).map((p) => p.id as string);
  const approvals = payoutIds.length
    ? await supabase.from('chama_approvals').select('*').in('payout_id', payoutIds).order('created_at')
    : { data: [], error: null };
  if (approvals.error) throw new Error(`Loading approvals: ${approvals.error.message}`);

  const cyc = (cycles.data ?? []).map((c) => num(c, ['target_amount']));
  const current = cyc.find((c) => c.status === 'collecting') ?? cyc.find((c) => c.status === 'ready') ?? null;

  return {
    group: num(group, ['contribution_amount', 'late_fine', 'kes_per_usd']),
    members: members.data ?? [],
    cycles: cyc,
    contributions: (contributions.data ?? []).map((c) => num(c, ['amount', 'fine'])),
    payouts: (payouts.data ?? []).map((p) => num(p, ['amount'])),
    approvals: approvals.data ?? [],
    rules: (rules.data ?? []).map((r) => num(r, ['confidence'])),
    events: events.data ?? [],
    currentCycleId: (current?.id as string | undefined) ?? null,
  } as ChamaSnapshot;
}
