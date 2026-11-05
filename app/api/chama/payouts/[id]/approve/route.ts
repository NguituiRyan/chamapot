import { route } from '@/lib/chama/server/errors';
import { approveBody, uuid } from '@/lib/chama/server/validation';
import { approvePayout } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => approvePayout(uuid.parse((await context.params).id), approveBody.parse(await request.json())));
}
