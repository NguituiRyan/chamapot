// ChamaPot's AI in AG Studio: the Claude Treasurer as the primary agent, with Studio's built-in
// Data, Planning, Page and Widget agents as its delegates. Every agent runs Studio's own loop
// (directLlmRunner) against Claude through claude-adapter.ts -> /api/ai/claude, which holds the key.
//
// The dashboard must also pass `aiToolDisplay={treasurerToolDisplay}` (./treasurer/display.ts) to
// <AgStudio> so the chama tools read as "Reminded Nyokabi Githinji via PayPal" in the chat.
import {
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessSetup,
  type AgAiModel,
  type AgAiPromptStarter,
  type AgStudioApi,
} from 'ag-studio';
import { claudeAdapter } from './claude-adapter';
import { TREASURER_AGENT_ID, treasurerAgent } from './treasurer/agent';
import { buildTreasurerTools } from './treasurer/tools';

export { treasurerToolDisplay } from './treasurer/display';

// Suggestions shown in a new conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Who's behind this cycle?", prompt: "Who's behind on this cycle's contribution, and by how much?" },
  { label: "Remind everyone who hasn't paid", prompt: "Send a PayPal reminder to everyone who hasn't paid this cycle." },
  { label: 'Is the pot ready? Propose the payout', prompt: 'Is the pot ready? If it is, propose the payout.' },
  { label: 'Add a chart of contributions by city', prompt: 'Add a chart of contributions by city to this page.' },
  { label: "Pay this month's pot to my cousin Jane instead", prompt: "Pay this month's pot to my cousin Jane instead." },
];

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export interface BuildAiOptions {
  /** Model ids allowed by CHAMAPOT_MODEL on the server (lib/ai.ts); the first is the default. */
  models: string[];
  /** The chama the Treasurer works for, e.g. 'umoja-sisters'. */
  slug: string;
  /** Development only: use the route's scripted stand-in for Claude (no key needed). */
  mock?: boolean;
}

export function buildAi(options: BuildAiOptions): AgAiHarnessSetup {
  const adapter = claudeAdapter({ endpoint: '/api/ai/claude', model: options.models[0], mock: options.mock });
  const models: AgAiModel[] | undefined =
    options.models.length > 1 ? options.models.map((id) => ({ id, label: MODEL_LABELS[id] ?? id })) : undefined;

  return ({ api }) => {
    // ag-studio 3.1 types the setup params with the UI-less AgCoreStudioApi, but in the browser the
    // api handed here is the full AgStudioApi (see AgCoreStudioCommon), which createAiHarness and
    // defineAiTool need.
    const studio = api as AgStudioApi;
    const chamaTools = buildTreasurerTools(studio, options.slug);

    return createAiHarness(studio, ({ builtIn }) => ({
      agents: [
        directLlmRunner({ ...treasurerAgent(chamaTools), adapter }),
        directLlmRunner({ ...builtIn.data, adapter }),
        directLlmRunner({ ...builtIn.planning, adapter }),
        directLlmRunner({ ...builtIn.page, adapter }),
        directLlmRunner({ ...builtIn.widget, adapter }),
      ],
      primary: TREASURER_AGENT_ID,
      models,
      promptStarters: PROMPT_STARTERS,
    }));
  };
}
