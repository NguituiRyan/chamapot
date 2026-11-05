import { route } from '@/lib/chama/server/errors';
import { fineBody } from '@/lib/chama/server/validation';
import { createFineOrder } from '@/lib/chama/server/fines';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return route(async () => createFineOrder(fineBody.parse(await request.json()).contributionId)); }
