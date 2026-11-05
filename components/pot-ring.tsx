/** Progress ring for the pot. `pct` is 0..1. Labelled for screen readers by the caller's text. */
export function PotRing({
  pct,
  size = 148,
  stroke = 12,
  children,
  label,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pot-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--pot)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
        {p > 0 && p < 1 ? (
          <circle
            cx={size / 2 + r * Math.cos(2 * Math.PI * p)}
            cy={size / 2 + r * Math.sin(2 * Math.PI * p)}
            r={stroke / 2 - 1}
            fill="var(--marigold)"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
