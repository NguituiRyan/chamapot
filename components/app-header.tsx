'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, BadgeCheck, LayoutDashboard, Menu, ScrollText, Users, X, type LucideIcon } from 'lucide-react';
import { Logo } from './logo';
import { RoleSwitcher, type SwitcherMember } from './role-switcher';

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/rules', label: 'Rules', icon: ScrollText },
  { href: '/approvals', label: 'Approvals', icon: BadgeCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/members', label: 'Members', icon: Users },
];

export function AppHeader({
  members,
  acting,
  pendingApprovals = 0,
}: {
  members: SwitcherMember[];
  acting: string;
  pendingApprovals?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape (links close it on click).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const badge = (href: string) =>
    href === '/approvals' && pendingApprovals > 0 ? (
      <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-marigold text-[11px] font-bold text-[#3b2400]">
        {pendingApprovals}
        <span className="sr-only"> waiting</span>
      </span>
    ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur-md supports-[backdrop-filter]:bg-cream/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="ml-4 hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? 'page' : undefined}
                  className={`relative inline-flex h-10 items-center rounded-[10px] px-3 text-sm font-medium transition-colors ${
                    isActive(href) ? 'bg-pot-soft text-pot-ink' : 'text-muted hover:bg-sunken hover:text-ink'
                  }`}
                >
                  {label}
                  {badge(href)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <RoleSwitcher members={members} current={acting} className="ml-auto hidden w-64 lg:flex" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="relative ml-auto inline-flex size-11 cursor-pointer items-center justify-center rounded-[10px] border border-line bg-card text-ink lg:hidden"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          {!open && pendingApprovals > 0 ? (
            <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-cream bg-marigold" aria-hidden />
          ) : null}
        </button>
      </div>
      {open ? (
        <div id="mobile-nav" className="border-t border-line bg-cream px-4 pb-5 pt-3 shadow-card lg:hidden">
          <RoleSwitcher members={members} current={acting} className="mb-3" />
          <nav aria-label="Main">
            <ul className="grid gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(href) ? 'page' : undefined}
                    className={`flex h-12 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium ${
                      isActive(href) ? 'bg-pot-soft text-pot-ink' : 'text-ink hover:bg-sunken'
                    }`}
                  >
                    <Icon className="size-5" aria-hidden />
                    {label}
                    {badge(href)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
