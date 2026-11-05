// The wire contract between the browser adapter (app/dashboard/studio/claude-adapter.ts) and the
// route (./route.ts). Types only, so the adapter can import it without pulling server code in.
//
// Request: one Studio turn, almost exactly as Studio hands it to the adapter (AgLlmRequest), minus
// the fields Claude has no use for. Response: NDJSON, one ClaudeWireEvent per line.

/** A conversation item as Studio sends it (AgAiConversationItem), reduced to what Claude needs. */
export type ClaudeTurnItem =
  | { type: 'message'; role: 'user' | 'system'; text: string }
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'function_call_output'; callId: string; output: string };

/** A tool definition as Studio advertises it (AgAiToolSchema): JSON Schema 2020-12 parameters. */
export interface ClaudeTurnTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ClaudeToolChoice = 'auto' | 'none' | 'required' | { name: string };

export interface ClaudeTurnRequest {
  /** One of the configured models; the route falls back to the default when omitted. */
  model?: string;
  instructions?: string;
  input: ClaudeTurnItem[];
  tools: ClaudeTurnTool[];
  toolChoice?: ClaudeToolChoice;
  /** Which Studio agent is speaking (treasurer, page, widget...), for the server log only. */
  agent?: string;
}

export type ClaudeFinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error' | 'other';

export interface ClaudeWireUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
}

/** One NDJSON line of the route's response. Short keys keep the stream compact. */
export type ClaudeWireEvent =
  | { t: 'start'; id: string; model: string }
  | { t: 'text-start'; id: string }
  | { t: 'text'; id: string; d: string }
  | { t: 'text-end'; id: string }
  | { t: 'reasoning-start'; id: string }
  | { t: 'reasoning'; id: string; d: string }
  | { t: 'reasoning-end'; id: string }
  /** A tool call has begun; its arguments follow on `tool-call`. */
  | { t: 'tool-start'; id: string; name: string }
  /** The complete call. `input` is the JSON-encoded arguments, exactly as Claude produced them. */
  | { t: 'tool-call'; id: string; name: string; input: string }
  | {
      t: 'finish';
      reason: ClaudeFinishReason;
      usage?: ClaudeWireUsage;
      /** Present when Claude's safety classifiers declined the turn. */
      refusal?: { category?: string; explanation?: string };
    }
  | { t: 'error'; message: string };

/** Header that turns on the scripted, keyless stand-in for Claude. Honoured outside production only. */
export const MOCK_HEADER = 'x-chamapot-ai-mock';
