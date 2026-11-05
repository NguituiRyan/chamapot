import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { REVIEW_THRESHOLD, normalizeRuleKey } from '@/components/rule-keys';

// POST /api/chama/rules { slug, rules, settings, appliedBy? }: officials apply the rules Claude extracted
// from the constitution. Upserts chama_rules (extracted_by 'claude'), updates the group's enforced
// settings, and logs a 'rules' event. Shared Supabase project: only chama_* tables are touched.

export const dynamic = 'force-dynamic';

const Rule = z.object({
  key: z.string().min(1).max(64).transform(normalizeRuleKey),
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(500),
  source_quote: z.string().trim().max(2000).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

const Body = z.object({
  slug: z.string().trim().min(1).max(64),
  rules: z.array(Rule).min(1).max(40),
  settings: z
    .object({
      contribution_amount: z.number().positive().max(100_000).nullable().optional(),
      grace_days: z.number().int().min(0).max(60).nullable().optional(),
      late_fine: z.number().min(0).max(10_000).nullable().optional(),
      approvals_required: z
        .number()
        .int()
        .min(2, 'ChamaPot always requires at least two officials to approve a payout')
        .max(5)
        .nullable()
        .optional(),
    })
    .default({}),
  appliedBy: z.string().trim().max(32).optional(),
});

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail(400, 'Invalid JSON body');
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return fail(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  const { slug, rules, settings, appliedBy } = parsed.data;

  if (!process.env.SUPABASE_SECRET_KEY) {
    return fail(503, 'Saving rules needs the Supabase secret key on the server (SUPABASE_SECRET_KEY). Nothing was changed.');
  }

  try {
    const db = supabaseAdmin();
    const { data: group, error: groupError } = await db.from('chama_groups').select('id, name').eq('slug', slug).maybeSingle();
    if (groupError) throw new Error(groupError.message);
    if (!group) return fail(404, `No chama with slug "${slug}"`);

    // Demo identity: if the caller says who is applying, it must be one of the chama's officials.
    const actor = 'treasurer-agent';
    if (appliedBy) {
      const { data: member, error } = await db
        .from('chama_members')
        .select('handle, full_name, role')
        .eq('group_id', group.id)
        .eq('handle', appliedBy)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!member) return fail(404, `No member "${appliedBy}" in this chama`);
      if (member.role === 'member') return fail(403, 'Only officials (chair, treasurer or secretary) can change the rules');
    }

    // Last write wins for duplicate keys in one request.
    const byKey = new Map(rules.map((r) => [r.key, r]));
    const now = new Date().toISOString();
    const rows = [...byKey.values()].map((r) => ({
      group_id: group.id,
      key: r.key,
      label: r.label,
      value: r.value,
      source_quote: r.source_quote ?? null,
      confidence: r.confidence ?? null,
      extracted_by: 'claude',
      created_at: now,
    }));
    const { data: saved, error: upsertError } = await db
      .from('chama_rules')
      .upsert(rows, { onConflict: 'group_id,key' })
      .select('*');
    if (upsertError) throw new Error(upsertError.message);

    const groupUpdate = Object.fromEntries(
      Object.entries(settings).filter(([, v]) => v !== null && v !== undefined),
    ) as Record<string, number>;
    if (Object.keys(groupUpdate).length) {
      const { error } = await db.from('chama_groups').update(groupUpdate).eq('id', group.id);
      if (error) throw new Error(error.message);
    }

    const review = rows.filter((r) => r.confidence != null && r.confidence < REVIEW_THRESHOLD).map((r) => r.key);
    const summary = `Constitution re-read by Claude: ${rows.length} rule${rows.length === 1 ? '' : 's'}, ${review.length} need${
      review.length === 1 ? 's' : ''
    } review`;
    const { error: eventError } = await db.from('chama_events').insert({
      group_id: group.id,
      kind: 'rules',
      actor,
      summary,
      payload: { keys: rows.map((r) => r.key), needs_review: review, settings: groupUpdate, applied_by: appliedBy ?? null },
    });
    if (eventError) console.error('[chama.rules] event log failed', eventError.message);

    return Response.json(
      { ok: true, applied: rows.length, needsReview: review.length, summary, rules: saved ?? [], settings: groupUpdate },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[chama.rules]', err);
    return fail(500, 'Saving the rules failed. Try again: applying the same rules twice is safe.');
  }
}
