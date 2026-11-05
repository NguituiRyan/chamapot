import type { Metadata } from 'next';
import { Bot, ScrollText, ShieldCheck, UsersRound, Webhook } from 'lucide-react';
import { loadDemoSnapshot } from '@/components/data';
import { ErrorState } from '@/components/states';
import { Card, PageHeader } from '@/components/ui';
import { ActivityFeed } from './activity-feed';

export const metadata: Metadata = { title: 'Activity' };

const SOURCES = [
  {
    icon: Webhook,
    title: 'PayPal webhooks',
    body: 'Invoice paid, payout sent. Each event is signature-verified with PayPal and recorded once, even when PayPal retries.',
  },
  {
    icon: Bot,
    title: 'Treasurer agent',
    body: 'Claude’s reminders and payout proposals. It can propose; it cannot send money.',
  },
  {
    icon: UsersRound,
    title: 'Officials',
    body: 'Cash recorded at the meeting, approvals and rejections, with who did it and when.',
  },
  {
    icon: ScrollText,
    title: 'Rules',
    body: 'Every time the constitution is re-read and rules are applied.',
  },
];

export default async function ActivityPage() {
  const result = await loadDemoSnapshot();
  if (!result.ok) return <ErrorState message={result.error} />;
  const s = result.snapshot;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={s.group.name}
        title="Activity"
        description="The chama's audit trail, live. PayPal webhooks, the treasurer agent and the officials all write here, and every member can read it."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ActivityFeed
          groupId={s.group.id}
          initialEvents={s.events}
          members={s.members.map(({ handle, full_name, role, avatar_color }) => ({ handle, full_name, role, avatar_color }))}
        />
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="About this feed">
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold text-ink">What lands here</h2>
            <ul className="mt-3 space-y-3">
              {SOURCES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-pot-soft text-pot-ink">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="text-xs leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="flex items-start gap-2 px-1 text-xs text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pot-ink" aria-hidden />
            Entries are append-only. Nobody, including the AI, can edit or delete them from the app.
          </p>
        </aside>
      </div>
    </div>
  );
}
