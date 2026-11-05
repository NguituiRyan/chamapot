import { REVIEW_THRESHOLD } from './rule-keys';

/** Confidence 0..1 as a labelled bar. Low confidence (< 0.75) is flagged in clay. */

export function confidenceLevel(c: number | null | undefined): { label: string; tone: 'high' | 'medium' | 'low' | 'none' } {
  if (c == null || Number.isNaN(c)) return { label: 'No score', tone: 'none' };
  if (c >= 0.9) return { label: 'High', tone: 'high' };
  if (c >= REVIEW_THRESHOLD) return { label: 'Medium', tone: 'medium' };
  return { label: 'Low', tone: 'low' };
}

const BAR = { high: 'bg-pot', medium: 'bg-marigold', low: 'bg-clay', none: 'bg-line' } as const;
const TEXT = { high: 'text-pot-ink', medium: 'text-marigold-ink', low: 'text-clay', none: 'text-muted' } as const;

export function ConfidenceMeter({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  const level = confidenceLevel(value);
  const pct = value == null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Extraction confidence"
      >
        <div className={`h-full rounded-full ${BAR[level.tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`tabular text-xs font-semibold ${TEXT[level.tone]}`}>
        {value == null ? level.label : `${pct}% · ${level.label}`}
      </span>
    </div>
  );
}

/** Verbatim source text from the constitution. */
export function SourceQuote({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <blockquote
      className={`border-l-[3px] border-marigold bg-marigold-soft/60 py-2 pl-3 pr-2 font-display text-[15px] italic leading-relaxed text-ink ${className}`}
    >
      “{children}”
    </blockquote>
  );
}
