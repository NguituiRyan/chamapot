// Demo identity ("Viewing as"), shared by the server helper (acting-as.ts) and the client switcher
// (role-switcher.tsx). No sign-in in the demo: routes trust the handle they are sent (see CONTRACTS).

export const ACTING_AS_COOKIE = 'chamapot_as';

/** Who you are when nothing has been picked yet: Grace, the chair. */
export const DEFAULT_ACTING_HANDLE = 'grace';

export const ACTING_AS_EVENT = 'chamapot:acting-as';

export function isValidHandle(value: string | null | undefined): value is string {
  return !!value && /^[a-z0-9-]{2,32}$/.test(value);
}
