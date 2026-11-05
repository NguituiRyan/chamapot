import { getChamaSnapshot } from '@/lib/chama/snapshot';
import { route } from '@/lib/chama/server/errors';
import { handle } from '@/lib/chama/server/validation';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return route(() => getChamaSnapshot(handle.parse(new URL(request.url).searchParams.get('slug') ?? 'umoja-sisters')));
}
