import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Logo, PotMark } from '@/components/logo';
import { buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <PotMark className="size-16 opacity-90" />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-pot-ink">Error 404</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">This page isn&apos;t in the pot.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          The link may be old, or the page may have moved. The chama&apos;s books are untouched.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href="/dashboard" className={buttonClass('primary')}>
            Open the dashboard
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/" className={buttonClass('secondary')}>
            Back to home
          </Link>
        </div>
        <nav aria-label="Popular pages" className="mt-10 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
          {[
            ['/approvals', 'Approvals'],
            ['/activity', 'Activity'],
            ['/members', 'Members'],
            ['/rules', 'Rules'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
              {label}
            </Link>
          ))}
        </nav>
      </main>
    </>
  );
}
