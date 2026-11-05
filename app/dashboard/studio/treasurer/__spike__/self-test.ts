// Keyless self-test of the Claude <-> AG Studio path. Run: npx tsx app/dashboard/studio/treasurer/__spike__/self-test.ts
//
// Drives the route's real turn logic (app/api/ai/claude/turn.ts: AI SDK streamText + @ai-sdk/anthropic)
// against recorded-format Anthropic SSE from ./mock.ts, then feeds the resulting NDJSON through the
// browser adapter (claude-adapter.ts) exactly as Studio would consume it. Checks what Claude would be
// sent (tools, tool_choice, thinking, caching, message shapes) and what Studio receives back.
import assert from 'node:assert/strict';
import type { AgAiConversationItem, AgAiEvent, AgLlmRequest } from 'ag-studio';
import { mockAnthropicFetch, mockRequests, type MockReply } from '../../../../api/ai/claude/mock';
import type { ClaudeTurnRequest } from '../../../../api/ai/claude/protocol';
import { toClaudeInputSchema } from '../../../../api/ai/claude/schema';
import { streamClaudeTurn, toModelMessages } from '../../../../api/ai/claude/turn';
import { claudeAdapter } from '../../claude-adapter';

type Json = Record<string, unknown>;
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n`, error);
    process.exitCode = 1;
  }
}

// A trimmed copy of Studio 3.1's live `add_widget` / `execute_query`-style shapes plus the edge cases
// its Shape library can emit.
const studioLikeSchema = {
  type: 'object',
  properties: {
    widgetType: { type: 'string', enum: ['column-chart-grouped', 'pie-chart'] },
    aggregation: { anyOf: [{ type: 'string', enum: ['sum', 'count'] }, { not: {} }] },
    field: { $ref: '#/$defs/field' },
  },
  required: ['widgetType'],
  additionalProperties: false,
  $defs: { field: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
};

/** Route + adapter wired in-process: the adapter's fetch is the route's turn function. */
function adapterOver(reply: MockReply | ((body: Json) => MockReply)) {
  const anthropicFetch = mockAnthropicFetch(reply);
  return claudeAdapter({
    model: 'claude-sonnet-5-5',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as ClaudeTurnRequest;
      const stream = streamClaudeTurn(body, {
        apiKey: 'test',
        model: body.model ?? 'claude-sonnet-5-5',
        effort: 'medium',
        maxOutputTokens: 16000,
        fetch: anthropicFetch,
        signal: init?.signal ?? undefined,
      });
      return new Response(stream, { status: 200 });
    },
  });
}

async function runTurn(adapter: ReturnType<typeof claudeAdapter>, request: AgLlmRequest) {
  const handler = adapter.executeTurn(request, {});
  const events: AgAiEvent[] = [];
  for await (const event of handler.stream) events.push(event);
  return { events, response: await handler.complete };
}

const userItem = (text: string): AgAiConversationItem => ({
  id: 'u1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }],
});

const tools = [
  { name: 'add_widget', description: 'Add a widget', parameters: studioLikeSchema as never },
  { name: 'list_outstanding_members', description: 'List', parameters: { type: 'object', properties: {}, additionalProperties: false } as never },
];

async function main() {
  await test('schema: undefined sentinels are stripped, $defs/$ref and enums kept', () => {
    const { schema } = toClaudeInputSchema(studioLikeSchema);
    assert.deepEqual((schema.properties as Json).aggregation, { type: 'string', enum: ['sum', 'count'] });
    assert.deepEqual((schema.properties as Json).field, { $ref: '#/$defs/field' });
    assert.ok(schema.$defs);
    assert.equal(schema.type, 'object');
  });

  await test('schema: a root anyOf of objects becomes one object; a void root becomes {}', () => {
    const merged = toClaudeInputSchema({
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    }).schema;
    assert.equal(merged.type, 'object');
    assert.deepEqual(Object.keys(merged.properties as Json), ['a', 'b']);
    assert.equal(merged.required, undefined);
    assert.deepEqual(toClaudeInputSchema({ not: {} }).schema, { type: 'object', properties: {} });
    assert.equal(toClaudeInputSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }).schema.$schema, undefined);
  });

  await test('messages: calls pair with results, missing results are synthesized, orphans dropped', () => {
    const { messages, system } = toModelMessages([
      { type: 'message', role: 'system', text: 'Extra context' },
      { type: 'function_call', callId: 'pre-1', name: 'view_page', arguments: '{}' },
      { type: 'function_call_output', callId: 'pre-1', output: '{"success":true}' },
      { type: 'message', role: 'user', text: 'Hi' },
      { type: 'message', role: 'assistant', text: 'Checking' },
      { type: 'function_call', callId: 'a', name: 'x', arguments: '{"k":1}' },
      { type: 'function_call', callId: 'b', name: 'y', arguments: 'not json' },
      { type: 'function_call_output', callId: 'a', output: '{"success":false,"issues":[]}' },
      { type: 'function_call_output', callId: 'zzz', output: 'orphan' },
      { type: 'message', role: 'assistant', text: 'Done' },
    ]);
    assert.deepEqual(system, ['Extra context']);
    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'tool', 'user', 'assistant', 'tool', 'assistant']);
    const results = messages[5].content as { toolCallId: string; output: { type: string } }[];
    assert.deepEqual(results.map((r) => [r.toolCallId, r.output.type]), [['a', 'error-text'], ['b', 'error-text']]);
    const calls = messages[4].content as { type: string; input?: unknown }[];
    assert.deepEqual(calls.filter((c) => c.type === 'tool-call').map((c) => c.input), [{ k: 1 }, {}]);
  });

  await test('turn: tools, tool choice, thinking, effort and caching as Claude would receive them', async () => {
    mockRequests.length = 0;
    const adapter = adapterOver({ text: 'Two calls coming.', calls: [{ name: 'add_widget', input: { widgetType: 'pie-chart' } }, { name: 'list_outstanding_members', input: {} }] });
    const { events, response } = await runTurn(adapter, {
      input: [userItem('Add a pie chart and list who owes')],
      instructions: 'You are the Treasurer.',
      tools,
      toolChoice: { name: 'add_widget' },
      responseFormat: { type: 'text' },
    });
    const sent = mockRequests.at(-1)!;
    assert.equal(sent.model, 'claude-sonnet-5-5');
    assert.deepEqual(sent.thinking, { type: 'between_tools' });
    assert.deepEqual((sent.output_config as Json).effort, 'medium');
    assert.deepEqual(sent.tool_choice, { type: 'auto' }, 'forced tool choice must not reach the 5.5 models');
    const system = sent.system as { text: string; cache_control?: unknown }[];
    assert.match(system.map((s) => s.text).join('\n'), /Call the `add_widget` tool now/);
    assert.ok(system.some((s) => s.cache_control), 'system prompt carries a cache breakpoint');
    const sentTools = sent.tools as { name: string; input_schema: Json }[];
    assert.deepEqual(sentTools.map((t) => t.name), ['add_widget', 'list_outstanding_members']);
    assert.ok(sentTools.every((t) => t.input_schema.type === 'object'));
    assert.ok(!JSON.stringify(sentTools).includes('"not":{}'));
    assert.ok(Array.isArray(sent.fallbacks) || sent.fallbacks === 'default');

    const types = events.map((e) => e.type);
    assert.deepEqual(types, [
      'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
      'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END',
      'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END',
    ]);
    assert.equal(response.status, 'completed');
    const calls = response.output.filter((o) => o.type === 'function_call');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].type === 'function_call' && JSON.parse(calls[0].arguments).widgetType, 'pie-chart');
    assert.ok(calls.every((c) => c.type === 'function_call' && /^toolu_/.test(c.callId)));
    assert.equal(response.usage?.inputTokens, 1200);
  });

  await test('turn: a follow-up turn replays calls and results Claude-side, ending with the results', async () => {
    mockRequests.length = 0;
    const adapter = adapterOver({ text: 'All done.' });
    const { response } = await runTurn(adapter, {
      input: [
        userItem('Who owes?'),
        { id: 'c1', kind: 'output', type: 'function_call', callId: 'toolu_1', name: 'list_outstanding_members', arguments: '{}', status: 'completed' },
        { type: 'function_call_output', callId: 'toolu_1', output: '{"success":true,"response":"3 owe"}', status: 'completed' },
        { id: 'r1', kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: 'thinking' }] },
      ],
      tools,
      responseFormat: { type: 'text' },
    });
    const messages = mockRequests.at(-1)!.messages as { role: string; content: { type: string; cache_control?: unknown }[] }[];
    assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.equal(messages[1].content[0].type, 'tool_use');
    assert.equal(messages[2].content[0].type, 'tool_result');
    assert.ok(messages[2].content.at(-1)?.cache_control, 'last message carries a cache breakpoint');
    assert.ok(!JSON.stringify(messages).includes('"thinking"'), 'reasoning is never replayed');
    assert.equal(response.output[0].type, 'message');
  });

  await test('turn: a classifier refusal reads as a message, not a crash', async () => {
    const { events, response } = await runTurn(adapterOver({ stop: 'refusal' }), {
      input: [userItem('something declined')], tools, responseFormat: { type: 'text' },
    });
    assert.equal(response.status, 'completed');
    const text = events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => (e.type === 'TEXT_MESSAGE_CONTENT' ? e.delta : '')).join('');
    assert.match(text, /can't help with that/);
  });

  await test('turn: a tool call cut off by max_tokens is closed and handed over empty', async () => {
    const { events, response } = await runTurn(
      adapterOver({ calls: [{ name: 'add_widget', input: {} }], stop: 'max_tokens' }),
      { input: [userItem('x')], tools, responseFormat: { type: 'text' } },
    );
    assert.equal(response.status, 'incomplete');
    assert.equal(response.incompleteDetails?.reason, 'max_output_tokens');
    assert.equal(events.filter((e) => e.type === 'TOOL_CALL_END').length, 1);
  });

  await test('turn: an API error rejects `complete` with the API message', async () => {
    const adapter = claudeAdapter({
      model: 'claude-sonnet-5-5',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as ClaudeTurnRequest;
        const stream = streamClaudeTurn(body, {
          apiKey: 'test', model: 'claude-sonnet-5-5', effort: 'medium', maxOutputTokens: 100,
          fetch: async () =>
            new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'tools.0.custom.input_schema: bad' } }), {
              status: 400, headers: { 'content-type': 'application/json' },
            }),
        });
        return new Response(stream);
      },
    });
    const handler = adapter.executeTurn({ input: [userItem('x')], tools, responseFormat: { type: 'text' } }, {});
    for await (const _ of handler.stream) void _;
    await assert.rejects(handler.complete, /input_schema: bad/);
  });

  await test('turn: an HTTP error from the route (e.g. 429) rejects with its message', async () => {
    const adapter = claudeAdapter({
      model: 'claude-sonnet-5-5',
      fetch: async () => Response.json({ error: 'Too many AI requests from your network.' }, { status: 429 }),
    });
    const handler = adapter.executeTurn({ input: [userItem('x')], tools: [], responseFormat: { type: 'text' } }, {});
    for await (const _ of handler.stream) void _;
    await assert.rejects(handler.complete, /Too many AI requests/);
  });

  await test('turn: aborting mid-turn ends the stream and rejects quietly', async () => {
    const controller = new AbortController();
    const adapter = adapterOver({ text: 'x'.repeat(4000) });
    const handler = adapter.executeTurn({ input: [userItem('x')], tools: [], responseFormat: { type: 'text' } }, { signal: controller.signal });
    let seen = 0;
    for await (const _ of handler.stream) {
      void _;
      if (++seen === 3) controller.abort();
    }
    await assert.rejects(handler.complete);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
}

void main();
