import { route } from '@/lib/chama/server/errors';
import { slugBody } from '@/lib/chama/server/validation';
import { reconcile } from '@/lib/chama/server/reconcile';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return route(async () => reconcile(slugBody.parse(await request.json()).slug)); }
