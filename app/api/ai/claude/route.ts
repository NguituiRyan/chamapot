// POST /api/ai/claude - one AG Studio turn against Claude, for the browser adapter in
// app/dashboard/studio/claude-adapter.ts. The Anthropic key never leaves the server (lib/ai.ts).
// The body is a ClaudeTurnRequest (./protocol.ts); the reply is NDJSON ClaudeWireEvents. Claude's
// tool calls are streamed back unexecuted: Studio runs them in the browser and sends the results on
// the next turn. Errors before streaming starts are JSON `{ error }` with a 4xx/5xx status.
import { aiEffort, aiLimits, aiModels, anthropicKey } from '@/lib/ai';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { mockAnthropicFetch } from './mock';
import { MOCK_HEADER, type ClaudeToolChoice, type ClaudeTurnItem, type ClaudeTurnRequest, type ClaudeTurnTool } from './protocol';
import { streamClaudeTurn } from './turn';

// A Treasurer turn is usually seconds; a long widget configuration can take a minute.
export const maxDuration = 120;

const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS = 500;
const MAX_TOOLS = 64;

const error = (status: number, message: string, headers?: HeadersInit) =>
  Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const str = (value: unknown) => (typeof value === 'string' ? value : undefined);

function parseItem(raw: unknown): ClaudeTurnItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  if (item.type === 'message') {
    const role = item.role;
    const text = str(item.text) ?? '';
    if (role === 'user' || role === 'system') return { type: 'message', role, text };
    if (role === 'assistant') return { type: 'message', role, text };
    return undefined;
  }
  if (item.type === 'function_call') {
    const callId = str(item.callId);
    const name = str(item.name);
    if (!callId || !name) return undefined;
    return { type: 'function_call', callId, name, arguments: str(item.arguments) ?? '{}' };
  }
  if (item.type === 'function_call_output') {
    const callId = str(item.callId);
    if (!callId) return undefined;
    return { type: 'function_call_output', callId, output: str(item.output) ?? '' };
  }
  return undefined;
}

function parseTool(raw: unknown): ClaudeTurnTool | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const name = str(t.name);
  if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return undefined;
  const parameters = t.parameters && typeof t.parameters === 'object' ? (t.parameters as Record<string, unknown>) : {};
  return { name, description: str(t.description) ?? name, parameters };
}

function parseToolChoice(raw: unknown): ClaudeToolChoice | undefined {
  if (raw === 'auto' || raw === 'none' || raw === 'required') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string') {
    return { name: (raw as { name: string }).name };
  }
  return undefined;
}

function parseRequest(body: unknown): ClaudeTurnRequest | string {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.input) || b.input.length > MAX_ITEMS) return `"input" must be an array of at most ${MAX_ITEMS} items.`;
  if (b.tools !== undefined && (!Array.isArray(b.tools) || b.tools.length > MAX_TOOLS)) {
    return `"tools" must be an array of at most ${MAX_TOOLS} tools.`;
  }
  return {
    model: str(b.model),
    instructions: str(b.instructions),
    input: b.input.map(parseItem).filter((i): i is ClaudeTurnItem => i !== undefined),
    tools: ((b.tools as unknown[] | undefined) ?? []).map(parseTool).filter((t): t is ClaudeTurnTool => t !== undefined),
    toolChoice: parseToolChoice(b.toolChoice),
    agent: str(b.agent)?.slice(0, 40),
  };
}

export async function POST(request: Request) {
  // The scripted stand-in for Claude (./mock.ts) lets the Studio wiring be tested with no key. It is
  // never reachable in production.
  const mock = process.env.NODE_ENV !== 'production' && request.headers.get(MOCK_HEADER) === '1';
  const apiKey = mock ? 'mock-key' : anthropicKey();
  if (!apiKey) return error(503, 'The AI treasurer is not configured: set ANTHROPIC_API_KEY in .env.local.');

  // Same-origin only. Browsers always send Origin on a cross-site POST, so another site can't spend
  // this app's Claude budget through a visitor's browser.
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origin && host) {
    let originHost: string | undefined;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (originHost !== host) return error(403, 'Cross-origin requests are not allowed.');
  }

  const limits = aiLimits();
  if (!mock) {
    const verdict = rateLimit(`ai:${clientIp(request)}`, { limit: limits.perIpPerHour, dailyCap: limits.dailyCap });
    if (!verdict.ok) {
      const message =
        verdict.reason === 'daily_cap'
          ? 'The AI treasurer has reached its daily limit on this demo. Please try again tomorrow.'
          : 'Too many AI requests from your network. Please wait a few minutes and try again.';
      return Response.json(
        { error: message, retryAfterSeconds: verdict.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds), 'Cache-Control': 'no-store' } },
      );
    }
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return error(413, 'Request body is too large.');
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return error(400, 'Could not read the request body.');
  }
  if (raw.length > MAX_BODY_BYTES) return error(413, 'Request body is too large.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, 'Request body must be JSON.');
  }
  const turn = parseRequest(body);
  if (typeof turn === 'string') return error(400, turn);

  // Only the models offered in the picker (CHAMAPOT_MODEL) may be called.
  const models = aiModels();
  const model = turn.model ?? models[0];
  if (!models.includes(model)) return error(400, `Model "${model}" is not enabled.`);

  const stream = streamClaudeTurn(turn, {
    apiKey,
    model,
    effort: aiEffort(),
    maxOutputTokens: limits.maxOutputTokens,
    // Studio's stop button aborts the browser fetch, which aborts this request and the Claude call.
    signal: request.signal,
    fetch: mock ? mockAnthropicFetch() : undefined,
    onSchemaChange: (tool, changes) => console.info(`[AI] tool schema "${tool}" adjusted for Claude: ${changes.join('; ')}`),
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
