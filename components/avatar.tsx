import { initials } from './format';

const SIZES = {
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-12 text-sm',
  xl: 'size-16 text-lg',
} as const;

/** Initials on the member's colour. Name is announced unless `decorative`. */
export function Avatar({
  name,
  color,
  size = 'md',
  className = '',
  decorative = false,
}: {
  name: string;
  color: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-card ${SIZES[size]} ${className}`}
      style={{ backgroundColor: color ?? 'var(--pot)' }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {initials(name)}
    </span>
  );
}
