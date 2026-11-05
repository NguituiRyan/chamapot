import { route } from '@/lib/chama/server/errors';
import { proposeBody } from '@/lib/chama/server/validation';
import { proposePayout } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return route(async () => proposePayout(proposeBody.parse(await request.json()))); }
