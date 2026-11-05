import { route } from '@/lib/chama/server/errors';
import { uuid } from '@/lib/chama/server/validation';
import { payoutStatus } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => payoutStatus(uuid.parse((await context.params).id)));
}
