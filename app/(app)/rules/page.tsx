import type { Metadata } from 'next';
import { Bot, Database } from 'lucide-react';
import { getActingMember } from '@/components/acting-as';
import { ROLE_LABEL, isOfficial } from '@/components/chama';
import { ConfidenceMeter, SourceQuote } from '@/components/confidence-meter';
import { loadDemoSnapshot } from '@/components/data';
import { formatDate, formatUsd } from '@/components/format';
import { ruleOrder } from '@/components/rule-keys';
import { EmptyState, ErrorState } from '@/components/states';
import { Pill } from '@/components/status-pill';
import { Card, PageHeader, SectionTitle } from '@/components/ui';
import { ConstitutionPanel } from './constitution-panel';

export const metadata: Metadata = { title: 'Rules' };

export default async function RulesPage() {
  const result = await loadDemoSnapshot();
  if (!result.ok) return <ErrorState message={result.error} />;
  const s = result.snapshot;
  const acting = await getActingMember(s.members);
  const rules = [...s.rules].sort((a, b) => ruleOrder(a.key) - ruleOrder(b.key));
  const lastClaude = s.rules
    .filter((r) => r.extracted_by === 'claude')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow={s.group.name}
        title="The rules, as the code enforces them"
        description="Every rule comes from a sentence in the chama's constitution. Contributions, fines and payouts are checked against these on the server, not by the AI."
      />

      <ConstitutionPanel
        slug={s.group.slug}
        aiReady={Boolean(process.env.ANTHROPIC_API_KEY)}
        currentRules={rules.map(({ key, label, value, source_quote, confidence }) => ({
          key,
          label,
          value,
          source_quote,
          confidence,
        }))}
        currentSettings={{
          contribution_amount: s.group.contribution_amount,
          grace_days: s.group.grace_days,
          late_fine: s.group.late_fine,
          approvals_required: s.group.approvals_required,
        }}
        acting={
          acting
            ? {
                handle: acting.handle,
                name: acting.full_name,
                roleLabel: ROLE_LABEL[acting.role],
                official: isOfficial(acting),
              }
            : null
        }
      />

      <section aria-labelledby="current-rules">
        <SectionTitle
          id="current-rules"
          aside={
            lastClaude
              ? `Last read by Claude ${formatDate(lastClaude.created_at)}`
              : `${rules.length} rules`
          }
        >
          Current rules
        </SectionTitle>

        <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { k: 'Contribution', v: formatUsd(s.group.contribution_amount) },
            { k: 'Grace period', v: `${s.group.grace_days} days` },
            { k: 'Late fine', v: formatUsd(s.group.late_fine) },
            { k: 'Approvals per payout', v: `${s.group.approvals_required} officials` },
          ].map((x) => (
            <div key={x.k} className="rounded-[12px] border border-line bg-card px-4 py-3">
              <dt className="text-xs font-medium text-muted">{x.k}</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold text-ink">{x.v}</dd>
            </div>
          ))}
        </dl>

        {rules.length === 0 ? (
          <EmptyState title="No rules yet">
            Upload the constitution above and Claude will extract the rules for the officials to review.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {rules.map((r) => (
              <Card as="li" key={r.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{r.label}</h3>
                  {r.extracted_by === 'claude' ? (
                    <Pill tone="pot" icon={Bot}>
                      Extracted by Claude
                    </Pill>
                  ) : (
                    <Pill tone="neutral" icon={Database}>
                      Seed
                    </Pill>
                  )}
                </div>
                <p className="mt-1.5 text-lg font-semibold leading-snug text-ink">{r.value}</p>
                {r.source_quote ? <SourceQuote className="mt-3">{r.source_quote}</SourceQuote> : null}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                  <ConfidenceMeter value={r.confidence} />
                  <code className="text-xs text-muted">{r.key}</code>
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
