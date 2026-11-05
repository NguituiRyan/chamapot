// In-memory abuse limits for the public AI demo: a sliding-window limit per key (the caller's IP) and
// a fixed daily cap across everyone. Memory is per server instance, so on Vercel each warm instance
// counts separately - good enough to stop a runaway client or a casual abuser, not a billing control.

const HOUR_MS = 60 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the window after this one (0 when refused). */
  remaining: number;
  /** Seconds until a request would be allowed again (0 when allowed). */
  retryAfterSeconds: number;
  /** Which limit refused the request. */
  reason?: 'per_ip' | 'daily_cap';
}

const windows = new Map<string, number[]>();
let day = '';
let dayCount = 0;

function utcDay(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: number) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

/** Drop the least recently used keys once the table gets large, so memory stays bounded. */
function evictIfFull() {
  if (windows.size <= MAX_TRACKED_KEYS) return;
  const excess = windows.size - MAX_TRACKED_KEYS;
  let i = 0;
  for (const key of windows.keys()) {
    if (i++ >= excess) break;
    windows.delete(key);
  }
}

/**
 * Count one request for `key` and say whether it may proceed. Refused requests are not counted, so a
 * client that keeps retrying while limited does not extend its own lock-out.
 */
export function rateLimit(
  key: string,
  options: { limit: number; windowMs?: number; dailyCap?: number; now?: number },
): RateLimitResult {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? HOUR_MS;

  const today = utcDay(now);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (options.dailyCap !== undefined && dayCount >= options.dailyCap) {
    return { ok: false, remaining: 0, retryAfterSeconds: secondsUntilNextUtcDay(now), reason: 'daily_cap' };
  }

  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= options.limit) {
    windows.set(key, recent);
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSeconds, reason: 'per_ip' };
  }

  recent.push(now);
  // Re-insert so Map order tracks recency for eviction.
  windows.delete(key);
  windows.set(key, recent);
  evictIfFull();
  dayCount += 1;
  return { ok: true, remaining: options.limit - recent.length, retryAfterSeconds: 0 };
}

/** The caller's IP as the platform reports it (Vercel sets x-forwarded-for), or 'unknown'. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** For tests: forget every window and the daily count. */
export function resetRateLimits() {
  windows.clear();
  day = '';
  dayCount = 0;
}
