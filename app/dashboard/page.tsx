import type { Metadata } from 'next';
import { connection } from 'next/server';
import { aiEnabled, aiModels } from '@/lib/ai';
import { getChamaSnapshot } from '@/lib/chama/snapshot';
import { DEMO_GROUP_SLUG } from '@/lib/chama/types';
import { Dashboard } from './dashboard';

export const metadata: Metadata = {
  title: 'Treasurer dashboard',
  description: 'The Umoja Sisters ledger in AG Studio: the pot, the rotation, approvals and the constitution, live from PayPal webhooks.',
};

export default async function DashboardPage() {
  // The ledger changes with every PayPal webhook: render per request, never at build time.
  await connection();
  const snapshot = await getChamaSnapshot(DEMO_GROUP_SLUG);

  // Only model ids reach the client; the Anthropic key stays on the server (lib/ai.ts).
  return <Dashboard snapshot={snapshot} licenseKey={process.env.AG_STUDIO} aiModels={aiEnabled() ? aiModels() : undefined} />;
}
