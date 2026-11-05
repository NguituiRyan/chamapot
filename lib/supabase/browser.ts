'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Browser Supabase client (publishable key, RLS = read-only demo data). Used for realtime
// subscriptions to chama_contributions / chama_payouts / chama_approvals / chama_events.

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
