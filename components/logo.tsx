import Link from 'next/link';

/** The ChamaPot mark: a sufuria (cooking pot) with a coin going in. Decorative unless titled. */
export function PotMark({ className = 'size-8', title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="16" cy="7.5" r="4.75" fill="var(--marigold)" />
      <rect x="14.75" y="5.25" width="2.5" height="4.5" rx="1.25" fill="var(--pot-deep)" opacity="0.55" />
      <rect x="1.5" y="17.25" width="5" height="3" rx="1.5" fill="var(--pot-deep)" />
      <rect x="25.5" y="17.25" width="5" height="3" rx="1.5" fill="var(--pot-deep)" />
      <path d="M5.5 15.5h21v5.25a8.75 8.75 0 0 1-8.75 8.75h-3.5a8.75 8.75 0 0 1-8.75-8.75z" fill="var(--pot)" />
      <rect x="4" y="13.5" width="24" height="3.25" rx="1.6" fill="var(--pot-deep)" />
      <path d="M9 20.5c.4 2.9 2.6 5 5.6 5.4" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-[1.35rem] font-semibold leading-none tracking-tight text-ink ${className}`}>
      Chama<span className="text-pot-ink">Pot</span>
    </span>
  );
}

/** Mark + wordmark, linking home. */
export function Logo({ href = '/', className = '' }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 rounded-[10px] ${className}`} aria-label="ChamaPot home">
      <PotMark className="size-8 shrink-0" />
      <Wordmark />
    </Link>
  );
}
