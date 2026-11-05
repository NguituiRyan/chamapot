'use client';

import { useCallback, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, HandCoins, Info, X } from 'lucide-react';

// Small, quiet notifications for the dashboard: payments landing from PayPal webhooks, and the
// result of the treasurer's actions (reminders, cash recorded). Bottom-right on desktop, full width
// above the fold on phones. Announced politely to screen readers.

export type ToastTone = 'success' | 'error' | 'info' | 'payment';
export type Toast = { id: number; tone: ToastTone; title: string; detail?: string };

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info, payment: HandCoins } as const;
const ACCENT: Record<ToastTone, string> = {
  success: 'var(--cp-success)',
  error: 'var(--cp-danger)',
  info: 'var(--cp-pot)',
  payment: 'var(--cp-marigold)',
};

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === 'error' ? 9000 : 6000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:w-[380px]"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="cp-toast pointer-events-auto flex items-start gap-3 rounded-[14px] border border-[var(--cp-line)] bg-white p-3.5 pr-2 shadow-[0_10px_30px_rgba(18,38,31,0.14)]"
            style={{ fontFamily: 'var(--cp-sans)', borderLeft: `4px solid ${ACCENT[toast.tone]}` }}
          >
            <Icon className="mt-0.5 size-5 shrink-0" style={{ color: ACCENT[toast.tone] === 'var(--cp-marigold)' ? '#B7791F' : ACCENT[toast.tone] }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--cp-ink)]">{toast.title}</p>
              {toast.detail && <p className="mt-0.5 text-xs leading-snug text-[var(--cp-muted)]">{toast.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="cp-icon-btn size-7 shrink-0 text-[var(--cp-muted)]"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
