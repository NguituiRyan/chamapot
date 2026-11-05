// How the Treasurer's tool calls read in Studio's AI panel. Studio keys presentation by tool name
// (so a replayed thread renders the same), on the <AgStudio aiToolDisplay> property - which the
// dashboard (app/dashboard/dashboard.tsx) must pass: `aiToolDisplay={treasurerToolDisplay}`.
import type { AgAiToolLabel, AgAiToolLabelParams } from 'ag-studio';
import type { AgAiToolDisplay } from 'ag-studio-react';
import { TREASURER_TOOLS, type OutstandingData, type ProposalData, type ReminderData, type RotationData } from './tools';

type Params<TArgs extends object, TData> = AgAiToolLabelParams<TArgs, TData>;

function firstIssue(result: Params<object, unknown>['result']): string | undefined {
  return result && !result.success ? result.issues[0]?.message : undefined;
}

/** Label helper: one wording while running, one on success, one on failure. */
function phase<TArgs extends object, TData>(
  params: Params<TArgs, TData>,
  wording: { running: string; failed: string; done: (data: TData | undefined) => AgAiToolLabel },
): AgAiToolLabel {
  const { status, result } = params;
  if (status !== 'done') return { text: status === 'cancelled' ? `${wording.running} (stopped)` : wording.running };
  if (result && !result.success) return { text: wording.failed };
  return wording.done(result?.success ? result.data : undefined);
}

const display = <TArgs extends object, TData>(
  label: (params: Params<TArgs, TData>) => AgAiToolLabel,
): AgAiToolDisplay => ({ label: label as unknown as AgAiToolDisplay['label'] });

export const treasurerToolDisplay: Record<string, AgAiToolDisplay> = {
  [TREASURER_TOOLS.listOutstanding]: display<object, OutstandingData>((p) =>
    phase(p, {
      running: "Checking who's behind",
      failed: "Couldn't load this cycle's contributions",
      done: (data) => ({
        text: data?.cycle ? `Checked cycle ${data.cycle.number} contributions` : 'Checked contributions',
        pill: data ? (data.outstanding.length === 0 ? 'All paid' : `${data.outstanding.length} outstanding`) : undefined,
      }),
    }),
  ),

  [TREASURER_TOOLS.rotation]: display<object, RotationData>((p) =>
    phase(p, {
      running: 'Checking the rotation',
      failed: "Couldn't load the rotation",
      done: (data) => ({
        text: data?.recipient ? `Pot goes to ${data.recipient.name}` : 'Checked the rotation',
        pill: data ? (data.potReady ? 'Pot ready' : `${data.paidCount}/${data.memberCount} paid`) : undefined,
      }),
    }),
  ),

  [TREASURER_TOOLS.remind]: display<{ contributionId: string }, ReminderData>((p) => {
    if (p.status === 'done' && p.result && !p.result.success) {
      return { text: 'Reminder not sent', pill: firstIssue(p.result as Params<object, unknown>['result'])?.slice(0, 40) };
    }
    return phase(p, {
      running: 'Sending a PayPal reminder',
      failed: 'Reminder not sent',
      done: (data) =>
        data?.sent
          ? { text: `Reminded ${data.memberName} via PayPal`, pill: data.invoiceNumber ?? undefined }
          : { text: `Skipped ${data?.memberName ?? 'reminder'}`, pill: 'Reminded recently' },
    });
  }),

  [TREASURER_TOOLS.propose]: display<{ recipientHandle?: string; reason: string }, ProposalData>((p) => {
    if (p.status === 'done' && p.result && !p.result.success) {
      const issue = firstIssue(p.result as Params<object, unknown>['result']) ?? '';
      // A 409 is the rotation rule itself; anything else (unknown member, pot incomplete) is plainer.
      return /chama's rules/.test(issue)
        ? { text: 'Payout refused by the chama rules', pill: 'Blocked' }
        : { text: 'Payout not proposed', pill: issue.replace(/^The payout was not proposed: /, '').replace(/\. No money moved\.$/, '').slice(0, 32) || undefined };
    }
    return phase(p, {
      running: 'Proposing the payout',
      failed: 'Payout not proposed',
      done: (data) => ({
        text: `Payout proposed · awaiting ${data?.approvalsRequired ?? 2} approvals`,
        pill: data ? [data.amount, data.recipientName].filter(Boolean).join(' → ') : undefined,
      }),
    });
  }),
};
