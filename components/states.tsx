import Link from 'next/link';
import { CircleAlert, Inbox, type LucideIcon } from 'lucide-react';
import { buttonClass } from './ui';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  action,
  className = '',
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center rounded-[14px] border border-dashed border-line bg-card/60 px-6 py-10 text-center ${className}`}>
      <span className="flex size-12 items-center justify-center rounded-full bg-pot-soft text-pot-ink">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="mt-3 font-display text-lg font-semibold text-ink">{title}</h3>
      {children ? <div className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{children}</div> : null}
      {action ? (
        <Link href={action.href} className={buttonClass('secondary', 'mt-5')}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = 'We could not load the chama',
  message,
  className = '',
}: {
  title?: string;
  message?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={`flex gap-3 rounded-[14px] border border-danger/25 bg-danger-soft p-4 text-sm ${className}`}>
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold text-ink">{title}</p>
        {message ? <p className="mt-1 break-words text-muted">{message}</p> : null}
        <p className="mt-1 text-muted">Refresh the page to try again. The ledger itself is unaffected.</p>
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[10px] bg-sunken ${className}`} aria-hidden />;
}
