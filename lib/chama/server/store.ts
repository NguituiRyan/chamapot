import { supabaseAdmin } from '@/lib/supabase/server';
import { MoneyError } from './errors';

export const db = () => supabaseAdmin();
export function checked<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new Error(`Chama ledger: ${result.error.message}`);
  return result.data;
}
export async function row<T>(table: string, id: string): Promise<T> {
  const result = await db().from(`chama_${table}`).select('*').eq('id', id).maybeSingle();
  const data = checked(result);
  if (!data) throw new MoneyError(404, `${table} record not found`);
  return data as T;
}
export async function update(table: string, id: string, values: Record<string, unknown>) {
  checked(await db().from(`chama_${table}`).update(values).eq('id', id));
}
export async function logEvent(groupId: string | null, kind: string, actor: string, summary: string, payload: Record<string, unknown> = {}) {
  checked(await db().from('chama_events').insert({ group_id: groupId, kind, actor, summary, payload }));
}
