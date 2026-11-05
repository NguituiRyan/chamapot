import { route } from '@/lib/chama/server/errors';
import { fineBody, orderIdSchema } from '@/lib/chama/server/validation';
import { captureFineOrder } from '@/lib/chama/server/fines';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  return route(async () => captureFineOrder(orderIdSchema.parse((await context.params).orderId), fineBody.parse(await request.json()).contributionId));
}
