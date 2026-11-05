import 'server-only';
import { cookies } from 'next/headers';
import type { ChamaMember } from '@/lib/chama/types';
import { ACTING_AS_COOKIE, DEFAULT_ACTING_HANDLE, isValidHandle } from './acting-as-shared';

/** Server helper: the member handle from the `chamapot_as` cookie (defaults to the chair). */
export async function getActingHandle(): Promise<string> {
  const value = (await cookies()).get(ACTING_AS_COOKIE)?.value;
  return isValidHandle(value) ? value : DEFAULT_ACTING_HANDLE;
}

/** Server helper: the acting member, falling back to the chair when the cookie names nobody. */
export async function getActingMember(members: ChamaMember[]): Promise<ChamaMember | null> {
  const handle = await getActingHandle();
  return (
    members.find((m) => m.handle === handle) ??
    members.find((m) => m.handle === DEFAULT_ACTING_HANDLE) ??
    members[0] ??
    null
  );
}
