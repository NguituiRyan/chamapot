'use client';

import type { ChamaMember, ChamaSnapshot } from '@/lib/chama/types';
import { methodLabel } from '../studio/data';
import { Avatar, usd0 } from '../studio/widgets/shared';

// The drill-through target for a member: her statement across every cycle, opened in an AG Studio
// popup from the dashboard's context menu. The full page lives at /members/[handle].

export type MemberStatementParams = {
  member: ChamaMember;
  snapshot: ChamaSnapshot;
  closePopup: () => void;
  onRemind?: (contributionId: string) => void;
  onRecordCash?: (contributionId: string) => void;
};

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  paid: { label: 'Paid', bg: 'var(--cp-pot-soft)', fg: 'var(--cp-success)' },
  invoiced: { label: 'Invoiced', bg: 'var(--cp-marigold-soft)', fg: '#8A5A12' },
  pending: { label: 'Due', bg: 'var(--cp-marigold-soft)', fg: '#8A5A12' },
  late: { label: 'Late', bg: 'var(--cp-clay-soft)', fg: 'var(--cp-clay)' },
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

export function MemberStatement({ member, snapshot, closePopup, onRemind, onRecordCash }: MemberStatementParams) {
  const cycles = new Map(snapshot.cycles.map((c) => [c.id, c]));
  const rows = snapshot.contributions
    .filter((c) => c.member_id === member.id)
    .map((c) => ({ c, cycle: cycles.get(c.cycle_id) }))
    .sort((a, b) => (b.cycle?.number ?? 0) - (a.cycle?.number ?? 0));
  const paid = rows.filter(({ c }) => c.status === 'paid').reduce((total, { c }) => total + c.amount, 0);
  const owed = rows.filter(({ c }) => c.status !== 'paid').reduce((total, { c }) => total + c.amount, 0);
  const late = rows.filter(({ c }) => c.days_late > 0).length;
  const fines = rows.reduce((total, { c }) => total + c.fine, 0);
  const turn = snapshot.cycles.find((c) => c.recipient_member_id === member.id);
  const rate = snapshot.group.kes_per_usd;

  return (
    <div className="flex h-full flex-col bg-white text-[var(--cp-ink)]" style={{ fontFamily: 'var(--cp-sans)' }}>
      <div className="flex items-center gap-3 border-b border-[var(--cp-line-soft)] px-4 py-3">
        <Avatar name={member.full_name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="cp-display truncate text-lg leading-tight">{member.full_name}</p>
          <p className="truncate text-xs text-[var(--cp-muted)]">
            {member.city}, {member.country} · {member.pays_via === 'paypal' ? 'pays by PayPal invoice' : 'pays cash at the meeting'}
            {turn ? ` · ${turn.status === 'paid_out' ? 'received' : 'receives'} the pot in ${turn.label}` : ''}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-[var(--cp-line-soft)] bg-[var(--cp-line-soft)] sm:grid-cols-4">
        {[
          ['Paid in', usd0.format(paid), `≈ KES ${Math.round(paid * rate).toLocaleString('en-KE')}`],
          ['Owes now', usd0.format(owed), owed ? 'on the current invoice' : 'nothing outstanding'],
          ['Paid late', String(late), late === 1 ? 'cycle' : 'cycles'],
          ['Fines', usd0.format(fines), fines ? 'charged per the constitution' : 'none charged'],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-white px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cp-muted)]">{label}</p>
            <p className="cp-display text-lg">{value}</p>
            <p className="text-[11px] text-[var(--cp-muted)]">{note}</p>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs text-[var(--cp-muted)]">
            <tr className="border-b border-[var(--cp-line)]">
              <th className="px-4 py-2 font-semibold">Cycle</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Paid via</th>
              <th className="px-2 py-2 font-semibold">Paid on</th>
              <th className="px-2 py-2 text-right font-semibold">Late</th>
              <th className="px-4 py-2 text-right font-semibold">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, cycle }) => {
              const style = STATUS_STYLE[c.status] ?? STATUS_STYLE.pending;
              const unpaid = c.status !== 'paid';
              return (
                <tr key={c.id} className="border-b border-[var(--cp-line-soft)]">
                  <td className="px-4 py-2">
                    <span className="font-semibold">{cycle?.label ?? '—'}</span>
                    <span className="block text-xs text-[var(--cp-muted)]">{usd0.format(c.amount)} due</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: style.bg, color: style.fg }}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[var(--cp-muted)]">{methodLabel(c.method) ?? '—'}</td>
                  <td className="px-2 py-2 text-[var(--cp-muted)]">{day(c.paid_at)}</td>
                  <td className="px-2 py-2 text-right text-[var(--cp-muted)]">
                    {c.days_late > 0 ? `${c.days_late} d${c.fine ? ` · ${usd0.format(c.fine)}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {unpaid && (onRemind || onRecordCash) ? (
                      <span className="inline-flex gap-1.5">
                        {onRemind && c.paypal_invoice_id && (
                          <button type="button" className="cp-btn cp-btn-sm" onClick={() => onRemind(c.id)}>
                            Remind
                          </button>
                        )}
                        {onRecordCash && (
                          <button type="button" className="cp-btn cp-btn-sm cp-btn-primary" onClick={() => onRecordCash(c.id)}>
                            Record cash
                          </button>
                        )}
                      </span>
                    ) : c.paypal_invoice_url ? (
                      <a href={c.paypal_invoice_url} target="_blank" rel="noopener" className="text-xs font-semibold text-[var(--cp-pot-deep)] hover:underline">
                        {c.paypal_invoice_number ?? 'PayPal invoice'} ↗
                      </a>
                    ) : (
                      <span className="text-xs text-[var(--cp-muted)]">{c.paypal_invoice_number ?? '—'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--cp-line-soft)] px-4 py-2.5">
        {/* A plain link: Studio may render popups outside the Next.js router's React tree. */}
        <a href={`/members/${member.handle}`} className="text-sm font-semibold text-[var(--cp-pot-deep)] hover:underline">
          Open full statement →
        </a>
        <button type="button" className="cp-btn cp-btn-sm" onClick={closePopup}>
          Close
        </button>
      </div>
    </div>
  );
}
