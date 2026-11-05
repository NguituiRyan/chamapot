// Shared ChamaPot domain types. Mirrors supabase/migrations/0001_chamapot.sql (snake_case, as stored).
// Every agent/route/page imports from here; change the schema and this file together.

export type Role = 'member' | 'chair' | 'treasurer' | 'secretary';
export type PaysVia = 'paypal' | 'cash';
export type CycleStatus = 'upcoming' | 'collecting' | 'ready' | 'paid_out';
export type ContributionStatus = 'pending' | 'invoiced' | 'paid' | 'late';
export type ContributionMethod = 'paypal' | 'cash_recorded';
export type PayoutStatus = 'proposed' | 'approved' | 'sent' | 'succeeded' | 'failed' | 'rejected';

export interface ChamaGroup {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  currency: string;
  contribution_amount: number;
  cycle_frequency: string;
  meeting_place: string | null;
  meeting_day: string | null;
  grace_days: number;
  late_fine: number;
  approvals_required: number;
  kes_per_usd: number;
  created_at: string;
}

export interface ChamaMember {
  id: string;
  group_id: string;
  handle: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string;
  country: string;
  role: Role;
  pays_via: PaysVia;
  rotation_position: number;
  avatar_color: string | null;
  joined_on: string;
}

export interface ChamaCycle {
  id: string;
  group_id: string;
  number: number;
  label: string;
  starts_on: string;
  due_on: string;
  payout_on: string;
  recipient_member_id: string;
  target_amount: number;
  status: CycleStatus;
}

export interface ChamaContribution {
  id: string;
  group_id: string;
  cycle_id: string;
  member_id: string;
  amount: number;
  currency: string;
  status: ContributionStatus;
  method: ContributionMethod | null;
  paypal_invoice_id: string | null;
  paypal_invoice_number: string | null;
  paypal_invoice_url: string | null;
  paypal_payment_id: string | null;
  paid_at: string | null;
  days_late: number;
  fine: number;
  fine_paid: boolean;
  last_reminded_at: string | null;
  is_seed: boolean;
  updated_at: string;
}

export interface ChamaPayout {
  id: string;
  group_id: string;
  cycle_id: string;
  recipient_member_id: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  proposed_by: string;
  reason: string | null;
  sender_batch_id: string | null;
  paypal_batch_id: string | null;
  paypal_item_id: string | null;
  paypal_status: string | null;
  is_seed: boolean;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
}

export interface ChamaApproval {
  id: string;
  payout_id: string;
  member_id: string;
  decision: 'approve' | 'reject';
  note: string | null;
  created_at: string;
}

export interface ChamaRule {
  id: string;
  group_id: string;
  key: string;
  label: string;
  value: string;
  source_quote: string | null;
  confidence: number | null;
  extracted_by: string;
  created_at: string;
}

export interface ChamaEvent {
  id: number;
  group_id: string | null;
  kind: string; // 'contribution' | 'payout' | 'approval' | 'reminder' | 'cycle' | 'webhook' | 'agent' | 'rules'
  actor: string; // 'treasurer-agent' | 'paypal-webhook' | member handle | 'treasurer' | 'system'
  summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/** Everything about one chama, loaded in one go. Produced by getChamaSnapshot() in lib/chama/snapshot.ts. */
export interface ChamaSnapshot {
  group: ChamaGroup;
  members: ChamaMember[];
  cycles: ChamaCycle[];
  contributions: ChamaContribution[];
  payouts: ChamaPayout[];
  approvals: ChamaApproval[];
  rules: ChamaRule[];
  events: ChamaEvent[];
  /** The cycle currently collecting (or the earliest 'ready' one), if any. */
  currentCycleId: string | null;
}

export const DEMO_GROUP_SLUG = 'umoja-sisters';
