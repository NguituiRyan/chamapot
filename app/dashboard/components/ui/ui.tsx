'use client';

import { useEffect, useEffectEvent, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// ChamaPot building blocks for the dashboard shell: buttons, a modal dialog and a small popover
// menu. Styling only (classes in ../../chama-dashboard.css); behaviour stays in the callers.

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'cp-btn-primary',
  secondary: '',
  ghost: 'cp-btn-ghost',
  danger: 'cp-btn-danger',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return <button type="button" className={`cp-btn ${size === 'sm' ? 'cp-btn-sm' : ''} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={`cp-icon-btn ${className}`} {...props} />;
}

export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[14px] border border-[var(--cp-line)] bg-white p-0 text-[var(--cp-ink)] shadow-xl backdrop:bg-[#12261f]/40"
      style={{ fontFamily: 'var(--cp-sans)' }}
    >
      {open && (
        <div className="p-6">
          <h2 className="cp-display text-xl">{title}</h2>
          <div className="mt-3 text-[15px] text-[var(--cp-muted)]">{children}</div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

export function Menu({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass a new onClose each render; this keeps the listeners below from re-attaching.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-[10px] border border-[var(--cp-line)] bg-white py-1 shadow-lg"
    >
      {children}
    </div>
  );
}

export function MenuItem({ danger, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`block w-full px-4 py-2 text-left text-sm hover:bg-[var(--cp-pot-soft)] ${danger ? 'text-[var(--cp-danger)]' : 'text-[var(--cp-ink)]'}`}
      {...props}
    />
  );
}
