// One Studio turn against Claude: Studio's conversation -> AI SDK messages -> streamText (tools
// declared WITHOUT execute, so Claude's tool calls come back to the browser, where Studio runs them)
// -> a compact NDJSON stream of ClaudeWireEvents. No env or request access here, so the node
// self-test can drive it with a recorded Anthropic stream (see ./mock.ts).
import { createAnthropic, type AnthropicLanguageModelOptions } from '@ai-sdk/anthropic';
import { jsonSchema, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import type { ClaudeFinishReason, ClaudeTurnItem, ClaudeTurnRequest, ClaudeWireEvent, ClaudeWireUsage } from './protocol';
import { toClaudeInputSchema } from './schema';

export interface ClaudeTurnOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Replaces the HTTP transport to Anthropic (tests and the keyless mock). */
  fetch?: typeof globalThis.fetch;
  /** Called with each schema rewrite, so a rejected Studio schema is easy to trace. */
  onSchemaChange?: (tool: string, changes: string[]) => void;
}

const CACHE = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5']);

/** Anthropic accepts tool_use ids matching ^[a-zA-Z0-9_-]+$; Studio's own ids already do, mostly. */
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';

function parseArguments(args: string): unknown {
  if (!args.trim()) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed !== null && typeof parsed === 'object' ? parsed : { value: parsed };
  } catch {
    return {};
  }
}

/** Studio reports a failed tool call as a JSON `{ success: false, issues }` string. */
function isFailedToolOutput(output: string) {
  try {
    const parsed = JSON.parse(output);
    return parsed !== null && typeof parsed === 'object' && (parsed as { success?: unknown }).success === false;
  } catch {
    return false;
  }
}

type AssistantPart = { type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown };
type ToolResult = {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: { type: 'text' | 'error-text'; value: string };
};

const INTERRUPTED = 'No result was recorded for this call: it was interrupted before it finished.';

/**
 * Studio's conversation items as AI SDK messages. Thinking is never replayed: Studio re-resolves the
 * system prompt and tool schemas every turn (they read live dashboard state), and a replayed
 * thinking block whose prefix changed is a 400 on new accounts - so every turn starts clean.
 * Returns the messages plus any system-role items, which belong in the system prompt.
 */
export function toModelMessages(input: ClaudeTurnItem[]): { messages: ModelMessage[]; system: string[] } {
  const system: string[] = [];
  const toolNameById = new Map<string, string>();
  for (const item of input) if (item.type === 'function_call') toolNameById.set(safeId(item.callId), item.name);

  // 1. Group items into role runs, in order.
  type Run = { role: 'user'; text: string[] } | { role: 'assistant'; parts: AssistantPart[] } | { role: 'tool'; results: ToolResult[] };
  const runs: Run[] = [];
  const last = () => runs[runs.length - 1];
  for (const item of input) {
    if (item.type === 'message' && item.role === 'system') {
      if (item.text.trim()) system.push(item.text.trim());
    } else if (item.type === 'message' && item.role === 'user') {
      if (!item.text.trim()) continue;
      const run = last();
      if (run?.role === 'user') run.text.push(item.text);
      else runs.push({ role: 'user', text: [item.text] });
    } else if (item.type === 'message') {
      if (!item.text.trim()) continue;
      // Text may sit between tool calls of one turn; Claude accepts them interleaved in one message.
      const run = last();
      const part: AssistantPart = { type: 'text', text: item.text };
      if (run?.role === 'assistant') run.parts.push(part);
      else runs.push({ role: 'assistant', parts: [part] });
    } else if (item.type === 'function_call') {
      const run = last();
      const part: AssistantPart = {
        type: 'tool-call',
        toolCallId: safeId(item.callId),
        toolName: item.name,
        input: parseArguments(item.arguments),
      };
      if (run?.role === 'assistant') run.parts.push(part);
      else runs.push({ role: 'assistant', parts: [part] });
    } else {
      const toolCallId = safeId(item.callId);
      const output = item.output.trim() ? item.output : '(no output)';
      const result: ToolResult = {
        type: 'tool-result',
        toolCallId,
        toolName: toolNameById.get(toolCallId) ?? 'unknown',
        output: { type: isFailedToolOutput(output) ? 'error-text' : 'text', value: output },
      };
      const run = last();
      if (run?.role === 'tool') run.results.push(result);
      else runs.push({ role: 'tool', results: [result] });
    }
  }

  // 2. Claude needs every tool_use answered by a tool_result in the very next message, and no
  //    tool_result without its tool_use. Pair them up: synthesize missing results, drop orphans.
  const messages: ModelMessage[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.role === 'user') {
      messages.push({ role: 'user', content: run.text.join('\n\n') });
    } else if (run.role === 'assistant') {
      messages.push({ role: 'assistant', content: run.parts });
      const calls = run.parts.filter((p): p is Extract<AssistantPart, { type: 'tool-call' }> => p.type === 'tool-call');
      if (calls.length === 0) continue;
      const next = runs[i + 1];
      const answered = next?.role === 'tool' ? next.results : [];
      const results = calls.map(
        (call): ToolResult =>
          answered.find((r) => r.toolCallId === call.toolCallId) ?? {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: 'error-text', value: INTERRUPTED },
          },
      );
      messages.push({ role: 'tool', content: results });
      if (next?.role === 'tool') i++; // consumed
    }
    // A tool run not directly after its calls is an orphan: dropped.
  }

  // 3. The conversation must open with the user.
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: 'Continue.' });
  return { messages, system };
}

function toToolSet(tools: ClaudeTurnRequest['tools'], onSchemaChange?: ClaudeTurnOptions['onSchemaChange']): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    const { schema, changes } = toClaudeInputSchema(t.parameters);
    if (changes.length > 0) onSchemaChange?.(t.name, changes);
    // No `execute`: the call is streamed back to the browser and Studio runs it.
    set[t.name] = tool({ description: t.description, inputSchema: jsonSchema(schema) });
  }
  return set;
}

/**
 * Forced tool choice (`any`/`tool`) is a 400 on the 5.5 models, and Studio forces `complete_task`
 * when a delegate stops without reporting back. So: ask in words, keep tool_choice `auto`.
 */
function toolChoiceNote(choice: ClaudeTurnRequest['toolChoice'], tools: ClaudeTurnRequest['tools']): string | undefined {
  if (choice === 'required') return 'Respond by calling one of your tools.';
  if (choice && typeof choice === 'object' && tools.some((t) => t.name === choice.name)) {
    return `Call the \`${choice.name}\` tool now to finish this task.`;
  }
  return undefined;
}

function thinkingFor(model: string): AnthropicLanguageModelOptions['thinking'] {
  // Sonnet 5.5's lowest setting: no upfront thinking (snappy multi-turn Studio runs), but its short
  // notes between tool calls still come back. Opus 5.5 and Haiku 5.5 stay adaptive (the default).
  return model === 'claude-sonnet-5-5' ? { type: 'between_tools' } : undefined;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; statusCode?: unknown; responseBody?: unknown };
    if (typeof e.responseBody === 'string') {
      try {
        const body = JSON.parse(e.responseBody) as { error?: { message?: string; type?: string } };
        if (body.error?.message) {
          return `Claude API ${typeof e.statusCode === 'number' ? e.statusCode : 'error'}: ${body.error.message}`;
        }
      } catch {
        // fall through to the message
      }
    }
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(error);
}

function toWireUsage(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  inputTokenDetails?: { cacheReadTokens: number | undefined; cacheWriteTokens: number | undefined };
  outputTokenDetails?: { reasoningTokens: number | undefined };
}): ClaudeWireUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
  };
}

const REFUSAL_TEXT =
  "I can't help with that request. If you think this is a mistake, try rephrasing what you need for the chama.";

/** Run one turn and return it as an NDJSON byte stream of ClaudeWireEvents. */
export function streamClaudeTurn(request: ClaudeTurnRequest, options: ClaudeTurnOptions): ReadableStream<Uint8Array> {
  const turnId = `turn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const { messages, system } = toModelMessages(request.input);
  const tools = toToolSet(request.tools, options.onSchemaChange);
  const note = toolChoiceNote(request.toolChoice, request.tools);

  if (note && messages[messages.length - 1]?.role === 'assistant') {
    messages.push({ role: 'user', content: note });
  } else if (messages[messages.length - 1]?.role === 'assistant') {
    // No prefill on the 5.5 models: a conversation must end with the user (or tool results).
    messages.push({ role: 'user', content: 'Continue.' });
  } else if (note) {
    system.push(`## This turn\n${note}`);
  }
  // Cache the conversation so far; the system prompt below is the other breakpoint.
  const lastMessage = messages[messages.length - 1];
  messages[messages.length - 1] = { ...lastMessage, providerOptions: CACHE } as ModelMessage;

  const instructions = [request.instructions?.trim(), ...system].filter(Boolean).join('\n\n');
  const anthropic = createAnthropic({ apiKey: options.apiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const thinking = thinkingFor(options.model);

  const result = streamText({
    model: anthropic(options.model),
    instructions: instructions ? { role: 'system', content: instructions, providerOptions: CACHE } : undefined,
    messages,
    tools,
    toolChoice: request.toolChoice === 'none' ? 'none' : 'auto',
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: options.signal,
    // The error is relayed to the browser below; log one line instead of the SDK's full dump.
    onError: ({ error }) => console.error(`[AI] ${request.agent ?? 'agent'}: ${describeError(error)}`),
    providerOptions: {
      anthropic: {
        effort: options.effort,
        ...(thinking ? { thinking } : {}),
        // Tool inputs are relayed whole, so let the API buffer and validate them.
        toolStreaming: false,
        // A classifier decline is retried server-side on Anthropic's recommended fallback model
        // (Claude API; Sonnet 5.5 and Opus 5.5 only - Haiku 5.5 has no server-side fallback).
        ...(FALLBACK_MODELS.has(options.model) ? { fallbacks: 'default' as const } : {}),
      } satisfies AnthropicLanguageModelOptions,
    },
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ClaudeWireEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const id = (part: string) => `${turnId}_${part}`;
      let usage: ClaudeWireUsage | undefined;
      let refusal: { category?: string; explanation?: string } | undefined;
      let finished = false;

      send({ t: 'start', id: turnId, model: options.model });
      try {
        for await (const part of result.stream) {
          switch (part.type) {
            case 'start-step':
              for (const warning of part.warnings) console.warn('[AI] Claude warning:', JSON.stringify(warning));
              break;
            case 'text-start':
              send({ t: 'text-start', id: id(part.id) });
              break;
            case 'text-delta':
              if (part.text) send({ t: 'text', id: id(part.id), d: part.text });
              break;
            case 'text-end':
              send({ t: 'text-end', id: id(part.id) });
              break;
            case 'reasoning-start':
              send({ t: 'reasoning-start', id: id(`r${part.id}`) });
              break;
            case 'reasoning-delta':
              if (part.text) send({ t: 'reasoning', id: id(`r${part.id}`), d: part.text });
              break;
            case 'reasoning-end':
              send({ t: 'reasoning-end', id: id(`r${part.id}`) });
              break;
            case 'tool-input-start':
              if (!part.providerExecuted) send({ t: 'tool-start', id: part.id, name: part.toolName });
              break;
            case 'tool-call': {
              if (part.providerExecuted) break;
              const input = typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {});
              send({ t: 'tool-call', id: part.toolCallId, name: part.toolName, input });
              break;
            }
            case 'finish-step': {
              usage = toWireUsage(part.usage);
              const details = (part.providerMetadata?.anthropic as { stopDetails?: { category?: string; explanation?: string } } | undefined)
                ?.stopDetails;
              if (details) refusal = { category: details.category ?? undefined, explanation: details.explanation ?? undefined };
              break;
            }
            case 'finish': {
              const reason = normalizeFinish(part.finishReason);
              if (reason === 'content-filter') {
                // Say so in the chat rather than ending the turn silently.
                send({ t: 'text-start', id: id('refusal') });
                send({ t: 'text', id: id('refusal'), d: REFUSAL_TEXT });
                send({ t: 'text-end', id: id('refusal') });
              }
              send({ t: 'finish', reason, usage: usage ?? toWireUsage(part.totalUsage), ...(refusal ? { refusal } : {}) });
              finished = true;
              console.log(
                `[AI] ${request.agent ?? 'agent'} on ${options.model}: ${reason} in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'} cached=${usage?.cachedInputTokens ?? 0}`,
              );
              break;
            }
            case 'error':
              send({ t: 'error', message: describeError(part.error) });
              finished = true;
              break;
            case 'abort':
              finished = true;
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if (!options.signal?.aborted) send({ t: 'error', message: describeError(error) });
        finished = true;
      }
      if (!finished && !options.signal?.aborted) send({ t: 'error', message: 'The Claude stream ended without finishing.' });
      try {
        controller.close();
      } catch {
        // already closed by a cancelled client
      }
    },
    cancel() {
      // The browser went away (Studio's stop button). streamText is already bound to the request's
      // abort signal, which fires on disconnect; nothing else to release.
    },
  });
}

function normalizeFinish(reason: string): ClaudeFinishReason {
  switch (reason) {
    case 'stop':
    case 'tool-calls':
    case 'length':
    case 'content-filter':
    case 'error':
      return reason;
    default:
      return 'other';
  }
}
