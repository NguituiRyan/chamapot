'use client';

import { useRouter } from 'next/navigation';
import { useId, useSyncExternalStore, useTransition } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import type { Role } from '@/lib/chama/types';
import { ACTING_AS_COOKIE, ACTING_AS_EVENT, DEFAULT_ACTING_HANDLE, isValidHandle } from './acting-as-shared';

export interface SwitcherMember {
  handle: string;
  full_name: string;
  role: Role;
}

function readCookie(): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${ACTING_AS_COOKIE}=`));
  const value = match ? decodeURIComponent(match.split('=')[1] ?? '') : '';
  return isValidHandle(value) ? value : DEFAULT_ACTING_HANDLE;
}

function subscribe(onChange: () => void) {
  window.addEventListener(ACTING_AS_EVENT, onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener(ACTING_AS_EVENT, onChange);
    window.removeEventListener('focus', onChange);
  };
}

/** Client hook: the acting member handle from the `chamapot_as` cookie (null during SSR). */
export function useActingAs(): string | null {
  return useSyncExternalStore(subscribe, readCookie, () => null);
}

export function setActingAs(handle: string) {
  document.cookie = `${ACTING_AS_COOKIE}=${encodeURIComponent(handle)}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new Event(ACTING_AS_EVENT));
}

const ROLE_SHORT: Record<Role, string> = { chair: 'Chair', treasurer: 'Treasurer', secretary: 'Secretary', member: 'Member' };
const OFFICIAL_ORDER: Role[] = ['chair', 'treasurer', 'secretary'];

/** "Viewing as" picker. Officials first; switching refreshes server components so votes re-evaluate. */
export function RoleSwitcher({
  members,
  current,
  className = '',
}: {
  members: SwitcherMember[];
  current: string;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const live = useActingAs();
  const value = live ?? current;

  const officials = OFFICIAL_ORDER.map((r) => members.find((m) => m.role === r)).filter(
    (m): m is SwitcherMember => !!m,
  );
  const others = members.filter((m) => m.role === 'member');

  if (members.length === 0) return null;

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
        <Eye className="size-3.5" aria-hidden />
        Viewing as
      </label>
      <div className="relative min-w-0 flex-1">
        <select
          id={id}
          value={value}
          disabled={pending}
          onChange={(e) => {
            setActingAs(e.target.value);
            startTransition(() => router.refresh());
          }}
          className="h-10 w-full cursor-pointer appearance-none truncate rounded-[10px] border border-line bg-card pl-3 pr-8 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-pot/50 disabled:cursor-wait disabled:opacity-60"
        >
          <optgroup label="Officials (can approve payouts)">
            {officials.map((m) => (
              <option key={m.handle} value={m.handle}>
                {m.full_name.split(' ')[0]} · {ROLE_SHORT[m.role]}
              </option>
            ))}
          </optgroup>
          <optgroup label="Members">
            {others.map((m) => (
              <option key={m.handle} value={m.handle}>
                {m.full_name.split(' ')[0]} · Member
              </option>
            ))}
          </optgroup>
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </div>
  );
}
