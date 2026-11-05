// AG Studio <-> Claude. An AgLlmAdapter whose executeTurn posts one Studio turn to this app's
// /api/ai/claude route (which holds the Anthropic key) and turns the route's NDJSON reply into the
// events and final response Studio's agent loop expects. Studio still owns everything else: the
// loop, the conversation, and running every tool Claude calls - in the browser, against the
// dashboard - before sending the results back on the next turn.
//
// There is no official Claude adapter for AG Studio; this follows the shape of AG's OpenAI example
// (Direct LLM Runner docs) and the AgLlmAdapter contract in ag-studio 3.1's type definitions.
import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiOutputMessage,
  AgAiReasoningItem,
  AgAiToolCall,
  AgLlmAdapter,
  AgLlmExecuteTurnOptions,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from 'ag-studio';
import {
  MOCK_HEADER,
  type ClaudeTurnItem,
  type ClaudeTurnRequest,
  type ClaudeWireEvent,
  type ClaudeWireUsage,
} from '@/app/api/ai/claude/protocol';

export interface ClaudeAdapterOptions {
  /** The route to post turns to. */
  endpoint?: string;
  /** Model used when the chat offers no choice (Studio then sends no `request.model`). */
  model: string;
  /** Use the route's scripted stand-in for Claude (development only; ignored in production). */
  mock?: boolean;
  /** Replaces `fetch` (tests). */
  fetch?: typeof globalThis.fetch;
}

// --- Encoding: Studio -> route ------------------------------------------------------

/** Studio's conversation as the route's compact items. Reasoning is display-only and never replayed. */
export function encodeInput(items: AgAiConversationItem[]): ClaudeTurnItem[] {
  const out: ClaudeTurnItem[] = [];
  for (const item of items) {
    if (item.type === 'function_call_output') {
      out.push({ type: 'function_call_output', callId: item.callId, output: item.output });
    } else if (item.type === 'function_call') {
      out.push({ type: 'function_call', callId: item.callId, name: item.name, arguments: item.arguments });
    } else if (item.type === 'message' && item.kind === 'input') {
      // Images and files are not carried by Studio's own harness yet; text is all there is.
      const text = item.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      out.push({ type: 'message', role: item.role, text });
    } else if (item.type === 'message') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal)).join('');
      out.push({ type: 'message', role: 'assistant', text });
    }
  }
  return out;
}

function encodeRequest(request: AgLlmRequest, model: string, agent?: string): ClaudeTurnRequest {
  return {
    model,
    instructions: request.instructions,
    input: encodeInput(request.input),
    // Only `client` tools: Studio runs those. Server/provider tools have no runner on this path.
    tools: (request.tools ?? [])
      .filter((tool) => tool.kind === undefined || tool.kind === 'client')
      .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> })),
    toolChoice: request.toolChoice,
    agent,
  };
}

// --- Decoding: route -> Studio ------------------------------------------------------

interface TurnOutcome {
  response?: AgLlmResponse;
  error?: Error;
}

/**
 * Folds the route's events into Studio events plus the final response. Text and reasoning messages
 * are opened lazily, on their first non-empty delta, so an empty block (e.g. Claude's thinking with
 * its text omitted) never shows up as a blank bubble.
 */
export class ClaudeStreamTranslator {
  private id = '';
  private model = '';
  private readonly output: AgAiOutputItem[] = [];
  private readonly openText = new Map<string, AgAiOutputMessage | null>();
  private readonly openReasoning = new Map<string, AgAiReasoningItem | null>();
  private readonly startedCalls = new Map<string, string>();
  private readonly finishedCalls = new Set<string>();

  constructor(private readonly fallbackModel: string) {}

  translate(event: ClaudeWireEvent, outcome: TurnOutcome): AgAiEvent[] {
    switch (event.t) {
      case 'start':
        this.id = event.id;
        this.model = event.model;
        return [];
      case 'text-start':
        this.openText.set(event.id, null);
        return [];
      case 'text': {
        const events: AgAiEvent[] = [];
        let message = this.openText.get(event.id) ?? null;
        if (!message) {
          message = { id: event.id, kind: 'output', type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'text', text: '', annotations: [] }] };
          this.openText.set(event.id, message);
          this.output.push(message);
          events.push({ type: 'TEXT_MESSAGE_START', messageId: event.id, role: 'assistant' });
        }
        const part = message.content[0];
        if (part.type === 'text') part.text += event.d;
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: event.id, delta: event.d });
        return events;
      }
      case 'text-end': {
        const message = this.openText.get(event.id);
        this.openText.delete(event.id);
        if (!message) return [];
        message.status = 'completed';
        return [{ type: 'TEXT_MESSAGE_END', messageId: event.id }];
      }
      case 'reasoning-start':
        this.openReasoning.set(event.id, null);
        return [];
      case 'reasoning': {
        const events: AgAiEvent[] = [];
        let item = this.openReasoning.get(event.id) ?? null;
        if (!item) {
          item = { id: event.id, kind: 'output', type: 'reasoning', summary: [{ type: 'summary', text: '' }] };
          this.openReasoning.set(event.id, item);
          this.output.push(item);
          events.push({ type: 'REASONING_MESSAGE_START', messageId: event.id, role: 'reasoning' });
        }
        item.summary[0].text += event.d;
        events.push({ type: 'REASONING_MESSAGE_CONTENT', messageId: event.id, delta: event.d });
        return events;
      }
      case 'reasoning-end': {
        const item = this.openReasoning.get(event.id);
        this.openReasoning.delete(event.id);
        return item ? [{ type: 'REASONING_MESSAGE_END', messageId: event.id }] : [];
      }
      case 'tool-start':
        if (this.startedCalls.has(event.id)) return [];
        this.startedCalls.set(event.id, event.name);
        return [{ type: 'TOOL_CALL_START', toolCallId: event.id, toolCallName: event.name }];
      case 'tool-call': {
        if (this.finishedCalls.has(event.id)) return [];
        const events: AgAiEvent[] = [];
        if (!this.startedCalls.has(event.id)) {
          this.startedCalls.set(event.id, event.name);
          events.push({ type: 'TOOL_CALL_START', toolCallId: event.id, toolCallName: event.name });
        }
        this.finishCall(event.id, event.name, event.input || '{}', 'completed', events);
        return events;
      }
      case 'finish': {
        const events = this.closeDangling();
        const incomplete = event.reason === 'length';
        outcome.response = {
          id: this.id || `turn_${Date.now()}`,
          createdAt: Date.now(),
          model: this.model || this.fallbackModel,
          status: incomplete ? 'incomplete' : 'completed',
          ...(incomplete ? { incompleteDetails: { reason: 'max_output_tokens' as const } } : {}),
          output: this.output,
          usage: toUsage(event.usage),
        };
        return events;
      }
      case 'error':
        outcome.error ??= new Error(event.message);
        return this.closeDangling();
      default:
        return [];
    }
  }

  private finishCall(id: string, name: string, args: string, status: 'completed' | 'incomplete', events: AgAiEvent[]) {
    this.finishedCalls.add(id);
    events.push({ type: 'TOOL_CALL_ARGS', toolCallId: id, delta: args }, { type: 'TOOL_CALL_END', toolCallId: id });
    const call: AgAiToolCall = { id, kind: 'output', type: 'function_call', callId: id, name, arguments: args, status };
    this.output.push(call);
  }

  /**
   * Close anything still open when the turn ends. A tool call cut off by the output limit is handed
   * to Studio with empty arguments, so it fails validation visibly and Claude can retry it, rather
   * than leaving a step spinning in the chat.
   */
  private closeDangling(): AgAiEvent[] {
    const events: AgAiEvent[] = [];
    for (const [id, message] of this.openText) if (message) events.push({ type: 'TEXT_MESSAGE_END', messageId: id });
    for (const [id, item] of this.openReasoning) if (item) events.push({ type: 'REASONING_MESSAGE_END', messageId: id });
    this.openText.clear();
    this.openReasoning.clear();
    for (const [id, name] of this.startedCalls) {
      if (!this.finishedCalls.has(id)) this.finishCall(id, name, '{}', 'incomplete', events);
    }
    for (const item of this.output) if (item.type === 'message' && item.status === 'in_progress') item.status = 'incomplete';
    return events;
  }
}

function toUsage(usage: ClaudeWireUsage | undefined): AgLlmResponse['usage'] {
  if (!usage || usage.inputTokens === undefined || usage.outputTokens === undefined) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

/** Parse an NDJSON byte stream into wire events. */
export async function* readWireEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ClaudeWireEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ClaudeWireEvent;
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) yield JSON.parse(rest) as ClaudeWireEvent;
  } finally {
    reader.releaseLock();
  }
}

// --- Transport ---------------------------------------------------------------------

async function* streamTurn(
  config: Required<Pick<ClaudeAdapterOptions, 'endpoint' | 'model'>> & ClaudeAdapterOptions,
  body: ClaudeTurnRequest,
  outcome: TurnOutcome,
  signal?: AbortSignal,
): AsyncGenerator<AgAiEvent> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const response = await doFetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.mock ? { [MOCK_HEADER]: '1' } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
    const message = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(message);
  }

  const translator = new ClaudeStreamTranslator(body.model ?? config.model);
  for await (const event of readWireEvents(response.body)) {
    yield* translator.translate(event, outcome);
  }
  if (!outcome.response && !outcome.error) {
    outcome.error = new Error('The Claude stream ended before the turn finished.');
  }
}

function runTurn(
  config: Required<Pick<ClaudeAdapterOptions, 'endpoint' | 'model'>> & ClaudeAdapterOptions,
  request: AgLlmRequest,
  options?: AgLlmExecuteTurnOptions,
): AgLlmResponseHandler {
  // `request.model` carries the reader's pick, and is absent when the chat offers no choice - so
  // the adapter's own model is the fallback, not an override.
  const body = encodeRequest(request, request.model?.id ?? config.model, options?.trace?.agentId);
  const outcome: TurnOutcome = {};

  let resolveComplete!: (response: AgLlmResponse) => void;
  let rejectComplete!: (error: Error) => void;
  const complete = new Promise<AgLlmResponse>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  // A consumer that abandons the stream (cancel, HTTP error) never awaits `complete`; mark the
  // rejection observed so it isn't reported as unhandled. Anyone who awaits it still sees it.
  void complete.catch(() => {});

  async function* events(): AsyncGenerator<AgAiEvent> {
    try {
      yield* streamTurn(config, body, outcome, options?.signal);
    } catch (error) {
      outcome.error ??= error instanceof Error ? error : new Error(String(error));
    }
    // A failed turn is reported once, through `complete`: Studio ends the run on its rejection.
    if (outcome.error) rejectComplete(outcome.error);
    else if (outcome.response) resolveComplete(outcome.response);
    else rejectComplete(new Error('The Claude stream ended without a response.'));
  }

  const iterator = events();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

/** Build the adapter every Treasurer-harness agent runs on. */
export function claudeAdapter(options: ClaudeAdapterOptions): AgLlmAdapter {
  const config = { ...options, endpoint: options.endpoint ?? '/api/ai/claude', model: options.model };
  return {
    executeTurn: (request, turnOptions) => runTurn(config, request, turnOptions),
  };
}
