import { z } from 'zod';

export const handle = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/);
export const slugBody = z.object({ slug: handle });
export const uuid = z.uuid();
export const note = z.string().trim().max(1000).optional();
export const cashBody = z.object({ recordedBy: handle, note });
export const remindBody = z.object({ actor: handle });
export const proposeBody = z.object({ slug: handle, cycleId: uuid.optional(), recipientHandle: handle.optional(), reason: note });
export const approveBody = z.object({ memberHandle: handle, decision: z.enum(['approve', 'reject']), note });
export const fineBody = z.object({ contributionId: uuid });
export const orderIdSchema = z.string().min(1).max(64).regex(/^[A-Z0-9-]+$/);
