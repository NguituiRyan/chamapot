import { createHash } from 'node:crypto';

/** Stable across retries, processes and deployments. Shorten only when the API limit requires it. */
export function requestId(kind: string, groupSlug: string, cycleNumber: number, memberHandle?: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const id = `chamapot-${clean(kind)}-${clean(groupSlug)}-c${cycleNumber}${memberHandle ? `-${clean(memberHandle)}` : ''}`;
  return id.length <= 108 ? id : `${id.slice(0, 75)}-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
}
