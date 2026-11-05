'use client';

import { useEffect } from 'react';
import { AlertIcon } from './components/ui/icons';
import { AppShell } from './components/app-shell';
import { SidebarSkeleton } from './components/skeleton';
import { Button } from './components/ui/ui';

// Shown when the chama can't be loaded from Supabase while rendering the page.
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell sidebar={<SidebarSkeleton />}>
      <div className="flex flex-1 items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-lg rounded-[14px] border border-[var(--cp-line)] bg-white p-6 text-center md:p-8">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--cp-clay-soft)] text-[var(--cp-clay)]">
            <AlertIcon className="size-7" />
          </span>
          <h1 className="cp-display mt-4 text-2xl">We couldn&apos;t open the chama</h1>
          <p className="mt-2 text-[15px] text-[var(--cp-muted)]">
            The ledger didn&apos;t load. Check the Supabase settings in <code className="rounded bg-[var(--cp-cream)] px-1">.env.local</code>{' '}
            and try again.
          </p>
          {error.message && (
            <p className="mt-4 break-words rounded-[10px] bg-[var(--cp-cream)] px-4 py-3 text-left font-mono text-xs text-[var(--cp-muted)]">
              {error.message}
              {error.digest && <span className="block pt-1">Reference: {error.digest}</span>}
            </p>
          )}
          <Button variant="primary" className="mt-6" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
