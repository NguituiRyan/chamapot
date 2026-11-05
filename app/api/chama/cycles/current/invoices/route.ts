import { route } from '@/lib/chama/server/errors';
import { slugBody } from '@/lib/chama/server/validation';
import { createCycleInvoices } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return route(async () => createCycleInvoices(slugBody.parse(await request.json()).slug));
}
