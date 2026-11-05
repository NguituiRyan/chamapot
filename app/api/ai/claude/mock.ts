// A scripted, keyless stand-in for the Anthropic Messages API, for development only (the route
// honours it only outside production, behind the x-chamapot-ai-mock header). It answers with real
// Anthropic SSE, so the whole path - AI SDK parsing, the route's NDJSON, the browser adapter, Studio's
// agent loop, delegation and tool execution - runs for real; only Claude's judgement is scripted.
// It also records every request it receives, so tests can inspect exactly what Claude would be sent.

type Json = Record<string, unknown>;
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Message = { role: 'user' | 'assistant'; content: string | Block[] };
type Tool = { name: string; input_schema?: Json };

export interface MockCall {
  name: string;
  input: Json;
}
export interface MockReply {
  text?: string;
  calls?: MockCall[];
  stop?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
}

/** Requests the mock has received (most recent last). Tests read this. */
export const mockRequests: Json[] = [];

const blocks = (m: Message): Block[] => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content);
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as Block).text ?? '') : '')).join('')
      : '';

/** Minimal arguments that satisfy a JSON schema: required properties only, first enum value, etc. */
export function argsFromSchema(schema: unknown, root: Json = schema as Json, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 12) return undefined;
  const s = schema as Json;
  if (typeof s.$ref === 'string') {
    const name = s.$ref.split('/').pop() ?? '';
    const defs = (root.$defs ?? root.definitions ?? {}) as Json;
    return argsFromSchema(defs[name], root, depth + 1);
  }
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(s[key])) {
      const branch = (s[key] as Json[]).find((b) => !(b && typeof b === 'object' && 'not' in b)) ?? (s[key] as Json[])[0];
      return argsFromSchema(branch, root, depth + 1);
    }
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type) {
    case 'object': {
      const out: Json = {};
      const props = (s.properties ?? {}) as Json;
      for (const key of (s.required as string[] | undefined) ?? []) out[key] = argsFromSchema(props[key], root, depth + 1);
      return out;
    }
    case 'array': {
      const min = typeof s.minItems === 'number' ? s.minItems : 0;
      return Array.from({ length: min }, () => argsFromSchema(s.items, root, depth + 1));
    }
    case 'string':
      return 'Mock';
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 1;
    case 'boolean':
      return false;
    default:
      return s.properties ? argsFromSchema({ ...s, type: 'object' }, root, depth + 1) : undefined;
  }
}

interface Situation {
  tools: Map<string, Tool>;
  request: string;
  /** Tool results since the user's request, in order, with the name of the tool that produced each. */
  results: { name: string; text: string; isError: boolean }[];
  /** Assistant turns since the user's request. */
  step: number;
}

function situation(body: Json): Situation {
  const messages = (body.messages ?? []) as Message[];
  const tools = new Map(((body.tools ?? []) as Tool[]).map((t) => [t.name, t] as const));
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && blocks(m).some((b) => b.type === 'text' && b.text && b.text !== 'Continue.')) {
      start = i;
      break;
    }
  }
  const request = blocks(messages[start] ?? { role: 'user', content: '' })
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
  const names = new Map<string, string>();
  const results: Situation['results'] = [];
  let step = 0;
  for (const m of messages.slice(start + 1)) {
    if (m.role === 'assistant') step++;
    for (const b of blocks(m)) {
      if (b.type === 'tool_use' && b.id && b.name) names.set(b.id, b.name);
      if (b.type === 'tool_result') {
        results.push({ name: names.get(b.tool_use_id ?? '') ?? '?', text: textOf(b.content), isError: !!b.is_error });
      }
    }
  }
  return { tools, request, results, step };
}

/** The delegate_to branch for one target, from the live schema Studio advertised. */
function delegateBranch(tools: Map<string, Tool>, id: string): Json | undefined {
  const schema = tools.get('delegate_to')?.input_schema as Json | undefined;
  const typeProp = (schema?.properties as Json | undefined)?.type as Json | undefined;
  const branches = (typeProp?.anyOf ?? []) as Json[];
  return branches.find((b) => {
    const idProp = (b.properties as Json | undefined)?.id as Json | undefined;
    return Array.isArray(idProp?.enum) && idProp.enum[0] === id;
  });
}

const lastResult = (s: Situation, name: string) => [...s.results].reverse().find((r) => r.name === name);

function treasurer(s: Situation): MockReply {
  const ask = s.request.toLowerCase();
  if (/chart|widget|graph/.test(ask)) {
    if (s.step === 0) {
      return {
        text: "I'll place a bar chart on this page, then have it configured to show contributions by city.",
        calls: [{ name: 'delegate_to', input: { type: { id: 'page' }, instructions: 'Place one bar chart, about half the page wide, for contributions by member city.' } }],
      };
    }
    const placed = lastResult(s, 'delegate_to');
    if (s.step === 1 && placed && !placed.isError) {
      const branch = delegateBranch(s.tools, 'widget');
      const props = (branch?.properties ?? {}) as Json;
      const ids = ((props.widgetId as Json | undefined)?.enum ?? []) as string[];
      const types = ((props.widgetType as Json | undefined)?.enum ?? []) as string[];
      const widgetId = ids.find((id) => placed.text.includes(id)) ?? ids[ids.length - 1];
      const widgetType = types.find((t) => placed.text.includes(t)) ?? types.find((t) => /bar/i.test(t)) ?? types[0];
      if (widgetId && widgetType) {
        return {
          calls: [
            {
              name: 'delegate_to',
              input: { type: { id: 'widget', widgetType, widgetId }, instructions: 'Show the total contribution amount by member city, titled "Contributions by city".' },
            },
          ],
        };
      }
      return { text: `The Page agent finished, but I couldn't find the new widget to configure. It said: ${placed.text.slice(0, 300)}` };
    }
    return { text: 'Done - there is now a chart of contributions by city on this page.' };
  }
  if (/jane|cousin|instead/.test(ask)) {
    if (s.step === 0) {
      return {
        text: "I can't move money myself - I can only propose a payout, and the chama's rules decide who may receive it. Let me check with the server.",
        calls: [{ name: 'propose_payout', input: { recipientHandle: 'jane', reason: "Treasurer asked to pay this month's pot to her cousin Jane." } }],
      };
    }
    const r = lastResult(s, 'propose_payout');
    return { text: `The server refused it: ${r?.text.slice(0, 400) ?? 'no reply'}. This month's pot can only go to the scheduled member.` };
  }
  if (/remind/.test(ask)) {
    if (s.step === 0) return { calls: [{ name: 'list_outstanding_members', input: {} }] };
    if (s.step === 1) {
      const ids = [...new Set([...(lastResult(s, 'list_outstanding_members')?.text ?? '').matchAll(/"contributionId":"([^"]+)"/g)].map((m) => m[1]))];
      if (ids.length > 0) return { calls: ids.map((contributionId) => ({ name: 'send_payment_reminder', input: { contributionId } })) };
    }
    return { text: `Reminders handled: ${s.results.filter((r) => r.name === 'send_payment_reminder').length} sent or skipped.` };
  }
  if (/ready|propose|payout/.test(ask)) {
    if (s.step === 0) return { calls: [{ name: 'rotation_status', input: {} }] };
    return { text: `Here's where the pot stands: ${lastResult(s, 'rotation_status')?.text.slice(0, 400) ?? ''}` };
  }
  if (/behind|owe|who/.test(ask)) {
    if (s.step === 0) return { calls: [{ name: 'list_outstanding_members', input: {} }] };
    return { text: `Here's who is behind: ${lastResult(s, 'list_outstanding_members')?.text.slice(0, 500) ?? ''}` };
  }
  return { text: '(mock Claude) Ask me who is behind, to remind them, about the pot, or for a chart by city.' };
}

function page(s: Situation): MockReply {
  if (s.step === 0) {
    const schema = s.tools.get('add_widget')?.input_schema;
    const input = (argsFromSchema(schema) ?? {}) as Json;
    return { calls: [{ name: 'add_widget', input }] };
  }
  const added = lastResult(s, 'add_widget');
  return {
    calls: [
      {
        name: 'complete_task',
        input: { summary: added?.isError ? `add_widget failed: ${added.text.slice(0, 300)}` : `Placed the widget. add_widget said: ${added?.text.slice(0, 300) ?? ''}`, artifacts: [] },
      },
    ],
  };
}

function delegate(s: Situation): MockReply {
  if (s.tools.has('add_widget')) return page(s);
  return { calls: [{ name: 'complete_task', input: { summary: '(mock) Nothing to configure in mock mode; widget left as placed.', artifacts: [] } }] };
}

/** Decide the scripted reply for one Messages API request. */
export function mockReply(body: Json): MockReply {
  const s = situation(body);
  if (s.tools.has('list_outstanding_members')) return treasurer(s);
  if (s.tools.has('complete_task')) return delegate(s);
  return { text: '(mock Claude) Hello.' };
}

/** The reply as an Anthropic Messages SSE stream. */
export function toAnthropicSse(reply: MockReply, model: string): string {
  const events: [string, Json][] = [];
  const id = `msg_mock_${Math.random().toString(36).slice(2, 10)}`;
  events.push(['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }]);
  let index = 0;
  if (reply.text) {
    events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
    for (const chunk of reply.text.match(/[\s\S]{1,40}/g) ?? []) {
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: chunk } }]);
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
    index++;
  }
  for (const call of reply.calls ?? []) {
    const toolId = `toolu_mock${Math.random().toString(36).slice(2, 12)}`;
    events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: toolId, name: call.name, input: {} } }]);
    events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } }]);
    events.push(['content_block_stop', { type: 'content_block_stop', index }]);
    index++;
  }
  const stop = reply.stop ?? (reply.calls?.length ? 'tool_use' : 'end_turn');
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 42 } }]);
  events.push(['message_stop', { type: 'message_stop' }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/** A `fetch` that answers Anthropic Messages requests with the scripted reply (or a fixed one). */
export function mockAnthropicFetch(fixed?: MockReply | ((body: Json) => MockReply)): typeof globalThis.fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    mockRequests.push(body);
    if (mockRequests.length > 50) mockRequests.shift();
    const reply = typeof fixed === 'function' ? fixed(body) : (fixed ?? mockReply(body));
    // A little latency so the chat streams visibly.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return new Response(toAnthropicSse(reply, String(body.model ?? 'claude-sonnet-5-5')), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}
