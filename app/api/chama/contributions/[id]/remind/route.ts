import { route } from '@/lib/chama/server/errors';
import { remindBody, uuid } from '@/lib/chama/server/validation';
import { remindContribution } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => remindContribution(uuid.parse((await context.params).id), remindBody.parse(await request.json()).actor));
}
