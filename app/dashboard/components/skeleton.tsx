import { AppShell } from './app-shell';

// Placeholder for the dashboard while the chama loads (./loading.tsx) and while saved dashboards
// are read from this browser. Mirrors the "This cycle" page: KPI strip, three cards, a table.

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[10px] bg-[var(--cp-line)]/60 ${className}`} />;
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-3 p-4 pt-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-9" />
      {['w-28', 'w-24', 'w-36', 'w-20'].map((width) => (
        <Skeleton key={width} className={`ml-6 h-7 ${width}`} />
      ))}
    </div>
  );
}

export function ContentSkeleton() {
  return (
    <>
      <div className="border-b border-[var(--cp-line)] bg-white px-4 py-4 md:px-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-2 h-8 w-48" />
        <Skeleton className="mt-3 h-3 w-56" />
      </div>
      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-hidden p-4 md:grid-cols-3" aria-hidden>
        <div className="rounded-[14px] border border-[var(--cp-line)] bg-white p-5 md:col-span-3">
          <Skeleton className="h-4 w-40" />
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-72 items-center justify-center rounded-[14px] border border-[var(--cp-line)] bg-white p-5">
            <Skeleton className="size-40 rounded-full" />
          </div>
        ))}
        <div className="h-56 rounded-[14px] border border-[var(--cp-line)] bg-white p-5 md:col-span-3">
          <Skeleton className="h-full" />
        </div>
      </div>
      <p className="sr-only" role="status">
        Loading the chama…
      </p>
    </>
  );
}

export function DashboardSkeleton() {
  return (
    <AppShell sidebar={<SidebarSkeleton />}>
      <ContentSkeleton />
    </AppShell>
  );
}
