// Rule keys the code enforces, in display order. Shared by the extraction route, the rules route and the
// rules page. Anything else Claude finds is kept as an extra rule (snake_case key).

/** Rules scored below this are flagged for an official to review. */
export const REVIEW_THRESHOLD = 0.75;

export const KNOWN_RULES = [
  { key: 'contribution_amount', label: 'Monthly contribution', hint: 'How much each member pays per cycle, and in which currency.' },
  { key: 'due_day', label: 'Due date', hint: 'The day of the month contributions are due.' },
  { key: 'late_fine', label: 'Late fine', hint: 'The fine for paying late, and the grace period before it applies.' },
  { key: 'rotation', label: 'Rotation order', hint: 'How the order of receiving the pot is decided.' },
  { key: 'turn_swap', label: 'Swapping turns', hint: 'Whether and how two members may exchange turns.' },
  { key: 'payout_approval', label: 'Payout approval', hint: 'Who must approve money leaving the pot, and any conflict-of-interest rule.' },
  { key: 'payout_day', label: 'Payout day', hint: 'When and where the pot is handed over.' },
  { key: 'default', label: 'Missed contributions', hint: 'What happens when a member misses contributions.' },
] as const;

export type KnownRuleKey = (typeof KNOWN_RULES)[number]['key'];

const ORDER = new Map<string, number>(KNOWN_RULES.map((r, i) => [r.key, i]));

export function ruleOrder(key: string): number {
  return ORDER.get(key) ?? KNOWN_RULES.length;
}

/** "Meeting Quorum" / "meeting-quorum" → "meeting_quorum" */
export function normalizeRuleKey(key: string): string {
  return (
    key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'r_$1')
      .slice(0, 48) || 'rule'
  );
}

export interface ExtractedRule {
  key: string;
  label: string;
  value: string;
  source_quote: string;
  confidence: number;
  /** true/false when the quote could be checked against pasted text; null for PDFs and images. */
  quote_verified: boolean | null;
  needs_review: boolean;
  /** Why an official should look at this rule (low confidence or unverified quote). */
  review_note: string | null;
}

export interface ExtractedSettings {
  contribution_amount: number | null;
  grace_days: number | null;
  late_fine: number | null;
  approvals_required: number | null;
}

export interface ExtractionResponse {
  rules: ExtractedRule[];
  settings: ExtractedSettings;
  model: string;
  source: { kind: 'pdf' | 'image' | 'text'; name: string | null };
  needs_review: number;
}
