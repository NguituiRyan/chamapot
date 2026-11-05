import { formatKes, formatUsd } from './format';

const SIZES = {
  sm: { usd: 'text-sm font-semibold', kes: 'text-xs' },
  md: { usd: 'text-base font-semibold', kes: 'text-xs' },
  lg: { usd: 'text-2xl font-semibold', kes: 'text-sm' },
  xl: { usd: 'font-display text-4xl font-semibold tracking-tight', kes: 'text-sm' },
} as const;

/** USD first, KES equivalent muted: "$50.00 ≈ KES 6,450". */
export function Money({
  usd,
  kesPerUsd,
  size = 'md',
  stacked = false,
  whole = false,
  className = '',
}: {
  usd: number;
  kesPerUsd?: number | null;
  size?: keyof typeof SIZES;
  stacked?: boolean;
  whole?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span className={`tabular inline-flex ${stacked ? 'flex-col' : 'flex-wrap items-baseline gap-x-1.5'} ${className}`}>
      <span className={`${s.usd} text-ink`}>{formatUsd(usd, { whole })}</span>
      {kesPerUsd ? <span className={`${s.kes} font-normal text-muted`}>≈ {formatKes(usd, kesPerUsd)}</span> : null}
    </span>
  );
}
