import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FileText,
  Hourglass,
  LoaderCircle,

  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ContributionStatus, PayoutStatus } from '@/lib/chama/types';

type Tone = 'success' | 'pot' | 'marigold' | 'clay' | 'danger' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'bg-success-soft text-success ring-success/20',
  pot: 'bg-pot-soft text-pot-ink ring-pot/20',
  marigold: 'bg-marigold-soft text-marigold-ink ring-marigold/30',
  clay: 'bg-clay-soft text-clay ring-clay/25',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  neutral: 'bg-sunken text-muted ring-line',
};

export function Pill({
  tone,
  icon: Icon,
  children,
  spin = false,
  className = '',
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {Icon ? <Icon className={`size-3.5 ${spin ? 'animate-spin' : ''}`} aria-hidden /> : null}
      {children}
    </span>
  );
}

const CONTRIBUTION: Record<ContributionStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  paid: { tone: 'success', icon: CircleCheck, label: 'Paid' },
  invoiced: { tone: 'marigold', icon: FileText, label: 'Invoiced' },
  pending: { tone: 'neutral', icon: CircleDashed, label: 'Pending' },
  late: { tone: 'clay', icon: TriangleAlert, label: 'Late' },
};

/** paid / invoiced / pending / late, with an icon so colour is never the only signal. */
export function StatusPill({ status, className }: { status: ContributionStatus; className?: string }) {
  const s = CONTRIBUTION[status] ?? CONTRIBUTION.pending;
  return (
    <Pill tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Pill>
  );
}

const PAYOUT: Record<PayoutStatus, { tone: Tone; icon: LucideIcon; label: string; spin?: boolean }> = {
  proposed: { tone: 'marigold', icon: Hourglass, label: 'Awaiting approval' },
  approved: { tone: 'pot', icon: Clock, label: 'Approved' },
  sent: { tone: 'pot', icon: LoaderCircle, label: 'Sending via PayPal', spin: true },
  succeeded: { tone: 'success', icon: CircleCheck, label: 'Paid out' },
  failed: { tone: 'danger', icon: CircleX, label: 'Failed' },
  rejected: { tone: 'neutral', icon: Ban, label: 'Rejected' },
};

export function PayoutStatusPill({ status, className }: { status: PayoutStatus; className?: string }) {
  const s = PAYOUT[status] ?? PAYOUT.proposed;
  return (
    <Pill tone={s.tone} icon={s.icon} spin={s.spin} className={className}>
      {s.label}
    </Pill>
  );
}

