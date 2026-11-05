import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import { getChamaSnapshot } from '@/lib/chama/snapshot';
import { DEMO_GROUP_SLUG, type ChamaSnapshot } from '@/lib/chama/types';

export type SnapshotResult = { ok: true; snapshot: ChamaSnapshot } | { ok: false; error: string };

/**
 * The demo chama for this request, loaded once and shared by the (app) layout and its page
 * (React cache is per request). Never throws: pages render an error state instead.
 */
export const loadDemoSnapshot = cache(async (): Promise<SnapshotResult> => {
  await connection();
  try {
    return { ok: true, snapshot: await getChamaSnapshot(DEMO_GROUP_SLUG) };
  } catch (err) {
    console.error('[chamapot] snapshot failed', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not load the chama' };
  }
});
