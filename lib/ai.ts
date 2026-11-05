// Server-side configuration for the Claude Treasurer inside AG Studio. The Anthropic key is read only
// here and in app/api/ai/claude: it has no NEXT_PUBLIC_ prefix and this module is server-only, so it
// can never be inlined into the browser bundle. The browser only ever sees model ids.
import 'server-only';

/** The model the Treasurer answers with when CHAMAPOT_MODEL is unset. */
const DEFAULT_MODELS = ['claude-sonnet-5-5'];

// Models the route will call. CHAMAPOT_MODEL may list several (comma-separated, first = default);
// anything outside this list is ignored so a typo can't send traffic to an unexpected model. The
// team runs Sonnet 5.5 everywhere, so it is the only one allowed (add ids here to offer a picker).
const KNOWN_MODELS = new Set(['claude-sonnet-5-5']);

// CHAMAPOT_ANTHROPIC_API_KEY is specific to this app, so a key set for it in .env.local always wins.
// ANTHROPIC_API_KEY is the contract name and the usual fallback. (Next.js prefers the process
// environment over .env.local for the same name, which is why the generic name alone can't be
// overridden per project.)
const KEY_VARIABLES = ['CHAMAPOT_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] as const;

let loggedKeySource = false;

/** The Anthropic key, or undefined when none is configured. Never log or return this to a client. */
export function anthropicKey(): string | undefined {
  const variable = KEY_VARIABLES.find((name) => process.env[name]?.trim());
  if (!loggedKeySource) {
    loggedKeySource = true;
    console.log(
      variable
        ? `[AI] Claude Treasurer enabled, using the Anthropic key from ${variable}`
        : '[AI] Claude Treasurer disabled: set ANTHROPIC_API_KEY in .env.local to enable it',
    );
  }
  return variable ? process.env[variable]?.trim() : undefined;
}

/** The Treasurer is shown only when a key is configured. */
export function aiEnabled(): boolean {
  return Boolean(anthropicKey());
}

/**
 * The Claude models the Treasurer may use, from CHAMAPOT_MODEL (comma-separated). The first is the
 * default; with two or more, Studio shows a model picker. e.g. `claude-sonnet-5-5,claude-opus-5-5`.
 */
export function aiModels(): string[] {
  const models = (process.env.CHAMAPOT_MODEL ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => KNOWN_MODELS.has(id));
  return models.length > 0 ? [...new Set(models)] : DEFAULT_MODELS;
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Abuse limits for the public demo. One Studio "turn" is one request, and a single chat message can
 * take several turns (the Treasurer delegating to the Page and Widget agents is ~6-12 turns).
 */
export function aiLimits() {
  return {
    /** Requests per IP per rolling hour. */
    perIpPerHour: positiveInt(process.env.CHAMAPOT_AI_RATE_LIMIT, 40),
    /** Requests across all callers per UTC day. */
    dailyCap: positiveInt(process.env.CHAMAPOT_AI_DAILY_CAP, 2000),
    /** Output tokens per turn, thinking included. */
    maxOutputTokens: positiveInt(process.env.CHAMAPOT_AI_MAX_OUTPUT_TOKENS, 16_000),
  };
}

export type AiEffort = 'low' | 'medium' | 'high';

/** Effort for every turn (CHAMAPOT_AI_EFFORT). Medium suits multi-step tool use on the 5.5 models. */
export function aiEffort(): AiEffort {
  const effort = process.env.CHAMAPOT_AI_EFFORT?.trim();
  return effort === 'low' || effort === 'high' ? effort : 'medium';
}
