// Pure helpers over a ChamaSnapshot (server + client safe). Pages derive everything they show from here
// so the landing preview, approvals and statements always agree.
import type {
  ChamaContribution,
  ChamaCycle,
  ChamaMember,
  ChamaPayout,
  ChamaSnapshot,
  Role,
} from '@/lib/chama/types';

export const ROLE_LABEL: Record<Role, string> = {
  chair: 'Chair',
  treasurer: 'Treasurer',
  secretary: 'Secretary',
  member: 'Member',
};

export const OFFICIAL_ROLES: Role[] = ['chair', 'treasurer', 'secretary'];

export const isOfficial = (m: Pick<ChamaMember, 'role'> | null | undefined) =>
  !!m && OFFICIAL_ROLES.includes(m.role);

export function memberMap(s: Pick<ChamaSnapshot, 'members'>): Map<string, ChamaMember> {
  return new Map(s.members.map((m) => [m.id, m]));
}

export function officials(s: Pick<ChamaSnapshot, 'members'>): ChamaMember[] {
  return OFFICIAL_ROLES.map((r) => s.members.find((m) => m.role === r)).filter(
    (m): m is ChamaMember => !!m,
  );
}

export function currentCycle(s: ChamaSnapshot): ChamaCycle | null {
  return s.cycles.find((c) => c.id === s.currentCycleId) ?? null;
}

export interface CycleProgress {
  cycle: ChamaCycle;
  recipient: ChamaMember | null;
  contributions: ChamaContribution[];
  paid: ChamaContribution[];
  outstanding: ChamaContribution[];
  collected: number;
  target: number;
  memberCount: number;
  pct: number;
}

export function cycleProgress(s: ChamaSnapshot, cycle: ChamaCycle | null): CycleProgress | null {
  if (!cycle) return null;
  const members = memberMap(s);
  const contributions = s.contributions
    .filter((c) => c.cycle_id === cycle.id)
    .sort(
      (a, b) =>
        (members.get(a.member_id)?.rotation_position ?? 0) - (members.get(b.member_id)?.rotation_position ?? 0),
    );
  const paid = contributions.filter((c) => c.status === 'paid');
  const outstanding = contributions.filter((c) => c.status !== 'paid');
  const collected = paid.reduce((sum, c) => sum + c.amount, 0);
  const target = cycle.target_amount || s.group.contribution_amount * s.members.length;
  return {
    cycle,
    recipient: members.get(cycle.recipient_member_id) ?? null,
    contributions,
    paid,
    outstanding,
    collected,
    target,
    memberCount: contributions.length || s.members.length,
    pct: target > 0 ? Math.min(1, collected / target) : 0,
  };
}

/** The payout officials are working on right now (proposed → approved → sent), newest first. */
export function activePayout(s: ChamaSnapshot): ChamaPayout | null {
  const live = s.payouts.filter((p) => p.status === 'proposed' || p.status === 'approved' || p.status === 'sent');
  return live.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export function cycleOf(s: ChamaSnapshot, cycleId: string): ChamaCycle | null {
  return s.cycles.find((c) => c.id === cycleId) ?? null;
}

/** The cycle in which a member receives the pot (her rotation turn). */
export function turnCycle(s: ChamaSnapshot, memberId: string): ChamaCycle | null {
  return s.cycles.find((c) => c.recipient_member_id === memberId) ?? null;
}

export function totalPaidOut(s: ChamaSnapshot): number {
  return s.payouts.filter((p) => p.status === 'succeeded').reduce((sum, p) => sum + p.amount, 0);
}

export function contributionFor(s: ChamaSnapshot, cycleId: string, memberId: string): ChamaContribution | null {
  return s.contributions.find((c) => c.cycle_id === cycleId && c.member_id === memberId) ?? null;
}

export const METHOD_LABEL: Record<string, string> = {
  paypal: 'PayPal',
  cash_recorded: 'Cash, recorded on PayPal',
};
