import { route } from '@/lib/chama/server/errors';
import { cashBody, uuid } from '@/lib/chama/server/validation';
import { recordCash } from '@/lib/chama/server/money';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const { recordedBy, note } = cashBody.parse(await request.json());
    return recordCash(uuid.parse((await context.params).id), recordedBy, note);
  });
}
