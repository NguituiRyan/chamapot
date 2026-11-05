// Pure formatting helpers (server + client safe). Money is USD-first with a KES equivalent.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const kes = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

/** "$50.00" (or "$500" with whole: true). */
export function formatUsd(amount: number, opts: { whole?: boolean } = {}): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return opts.whole && Number.isInteger(value) ? usdWhole.format(value) : usd.format(value);
}

/** "KES 6,450" from a USD amount and the group's rate. */
export function formatKes(amountUsd: number, kesPerUsd: number): string {
  return `KES ${kes.format(Math.round(amountUsd * kesPerUsd))}`;
}

const TZ = 'Africa/Nairobi';

/** "28 Nov 2026" */
export function formatDate(iso: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    ...(opts.year === false ? {} : { year: 'numeric' }),
    ...(opts.weekday ? { weekday: 'short' } : {}),
  });
}

/** "28 Nov, 14:05" (Nairobi time) */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "just now", "4 min ago", "3 h ago", "2 days ago", then a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(iso);
}

/** Ordinal for rotation turns: 1st, 2nd, 3rd, 7th. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
