'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import '../chama-dashboard.css';

// The ChamaPot app frame: a white top bar with the group and its cycle, links to the other
// ChamaPot pages, a dashboard sidebar on wide screens and the cream canvas. Shared by the
// dashboard, its loading skeleton and its error page.
//
// The root layout renders the "Built by Rytrix" footer after this frame. On wide screens the frame
// leaves room for it, so the credit sits visible under the dashboard; on phones it follows on scroll.

export type ShellGroup = { name: string; cycleLine: string };

export const DEFAULT_GROUP: ShellGroup = { name: 'Umoja Sisters Chama', cycleLine: 'November 2026 · cycle 7 of 10' };

export const APP_LINKS = [
  { href: '/rules', label: 'Rules' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/activity', label: 'Activity' },
] as const;

function TopBar({ group }: { group: ShellGroup }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--cp-line)] bg-white px-4 md:gap-5 md:px-6">
      <Logo className="-ml-1 p-1" />
      <span className="hidden h-7 w-px bg-[var(--cp-line)] md:block" aria-hidden />
      <div className="hidden min-w-0 leading-tight md:block">
        <p className="truncate text-sm font-semibold text-[var(--cp-ink)]">{group.name}</p>
        <p className="truncate text-xs text-[var(--cp-muted)]">{group.cycleLine}</p>
      </div>
      <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="ChamaPot">
        {APP_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="cp-link px-3 py-1.5 text-sm">
            {link.label}
          </Link>
        ))}
      </nav>
      <span className="ml-auto flex items-center gap-2 md:ml-2" title="Viewing as Akinyi Odhiambo, treasurer (demo mode)">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#15803D] text-xs font-bold text-white">AO</span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-semibold text-[var(--cp-ink)]">Akinyi</span>
          <span className="block text-xs text-[var(--cp-muted)]">Treasurer</span>
        </span>
      </span>
    </header>
  );
}

export function AppShell({ sidebar, children, group = DEFAULT_GROUP }: { sidebar: ReactNode; children: ReactNode; group?: ShellGroup }) {
  return (
    <div className="cp-root flex h-dvh min-h-[560px] flex-col md:h-[calc(100dvh-58px)]">
      <TopBar group={group} />
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-60 shrink-0 flex-col border-r border-[var(--cp-line)] bg-white md:flex" aria-label="Dashboards">
          {sidebar}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
