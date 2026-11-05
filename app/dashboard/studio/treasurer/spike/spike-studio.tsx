'use client';

// Development checkpoint for the Claude Treasurer: a bare AG Studio with the real Treasurer harness
// and the live chama data as one flat table, independent of the dashboard shell. `?mock=1` swaps
// Claude for the route's scripted stand-in. Not linked from anywhere; 404s in production.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AgStudioAiModule, type AgDataSourcesDefinition, type AgStudioApi } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import type { ChamaSnapshot } from '@/lib/chama/types';
import { buildAi, treasurerToolDisplay } from '../../ai';

const noSubscription = () => () => {};

function toData(snapshot: ChamaSnapshot): AgDataSourcesDefinition {
  const members = new Map(snapshot.members.map((m) => [m.id, m] as const));
  const cycles = new Map(snapshot.cycles.map((c) => [c.id, c] as const));
  const rows = snapshot.contributions.map((c) => {
    const m = members.get(c.member_id);
    const cycle = cycles.get(c.cycle_id);
    return {
      contribution_id: c.id,
      member: m?.full_name ?? '',
      city: m?.city ?? '',
      country: m?.country ?? '',
      pays_via: m?.pays_via ?? '',
      cycle: cycle?.number ?? 0,
      cycle_label: cycle?.label ?? '',
      amount: c.amount,
      status: c.status,
      days_late: c.days_late,
    };
  });
  return {
    description: `Contributions to the ${snapshot.group.name} chama: one row per member per monthly cycle, in USD.`,
    sources: [{ id: 'contributions', name: 'Contributions', description: 'One row per member per cycle.', data: rows }],
  };
}

export function SpikeStudio({ mock }: { mock: boolean }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const [snapshot, setSnapshot] = useState<ChamaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/chama/snapshot?slug=umoja-sisters', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`snapshot ${r.status}`))))
      .then(setSnapshot)
      .catch((e: Error) => setError(e.message));
  }, []);

  const data = useMemo(() => (snapshot ? toData(snapshot) : null), [snapshot]);
  const ai = useMemo(() => buildAi({ models: ['claude-sonnet-5-5'], slug: 'umoja-sisters', mock }), [mock]);

  if (!inBrowser) return null;
  if (error) return <p className="p-6">Could not load the chama: {error}</p>;
  if (!data) return <p className="p-6">Loading the chama...</p>;

  return (
    <div style={{ height: '88vh', width: '100%' }}>
      <AgStudioProvider modules={[AgStudioAiModule]}>
        <AgStudio
          style={{ height: '100%', width: '100%' }}
          data={data}
          ai={ai}
          aiToolDisplay={treasurerToolDisplay}
          mode="edit"
          onApiReady={(event) => {
            (window as unknown as { __studio?: AgStudioApi }).__studio = event.api;
          }}
        />
      </AgStudioProvider>
    </div>
  );
}
