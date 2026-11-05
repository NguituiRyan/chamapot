'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bot, CircleAlert, LoaderCircle } from 'lucide-react';
import { buttonClass } from '@/components/ui';

/** Asks the server to create the treasurer agent's proposal for the full pot (same checks as the agent tool). */
export function ProposeButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/chama/payouts/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, reason: 'Pot complete: proposed from the approvals page' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `The proposal was refused (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The proposal failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={propose} disabled={busy} className={buttonClass('primary')}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Bot className="size-4" aria-hidden />}
        Have the treasurer agent propose
      </button>
      {error ? (
        <p role="alert" className="mt-2 flex gap-1.5 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
