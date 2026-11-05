import { AppHeader } from '@/components/app-header';
import { getActingHandle } from '@/components/acting-as';
import { activePayout } from '@/components/chama';
import { loadDemoSnapshot } from '@/components/data';

// Shell for the product pages outside the AG Studio dashboard: rules, approvals, members, activity.
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const [result, acting] = await Promise.all([loadDemoSnapshot(), getActingHandle()]);
  const members = result.ok
    ? result.snapshot.members.map(({ handle, full_name, role }) => ({ handle, full_name, role }))
    : [];
  const pending = result.ok && activePayout(result.snapshot)?.status === 'proposed' ? 1 : 0;

  return (
    <>
      <AppHeader members={members} acting={acting} pendingApprovals={pending} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        {children}
      </main>
    </>
  );
}
