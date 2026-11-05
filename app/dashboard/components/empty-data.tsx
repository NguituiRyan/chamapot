import Link from 'next/link';
import { InboxIcon } from './ui/icons';

// Shown in place of Studio when the chama has no members yet, so Studio would only draw empty widgets.
export function EmptyData() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-[var(--cp-pot-soft)] text-[var(--cp-pot)]">
        <InboxIcon className="size-7" />
      </span>
      <h2 className="cp-display mt-4 text-xl">No chama data yet</h2>
      <p className="mt-2 max-w-md text-[15px] text-[var(--cp-muted)]">
        This chama has no members or cycles yet. Upload the constitution and add members to start the first cycle.
      </p>
      <Link href="/rules" className="cp-btn cp-btn-primary mt-6">
        Set up the constitution
      </Link>
    </div>
  );
}
