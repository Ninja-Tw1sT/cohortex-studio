export const BACKENDS = ['ollama', 'openai', 'anthropic', 'gemini', 'grok'] as const;
export const TOPOLOGIES = ['single', 'sequential', 'supervisor'] as const;
export type Topology = (typeof TOPOLOGIES)[number];

// The names cohortex's ReAct loop always resolves via its global registry (see
// cohortex/cohortex/tools/__init__.py) — a "builtin" kind Tool Shed entry must
// use one of these.
export const BUILTIN_TOOLS = ['calculator', 'word_count', 'contrast_ratio', 'shannon_entropy', 'defang_iocs'] as const;
export const TOOL_KINDS = ['builtin', 'http'] as const;
export const HTTP_METHODS = ['GET', 'POST'] as const;
// Suggested starting points for the Tool Shed's category field — not an enum;
// categories are free-text and user-creatable, this just seeds the datalist.
export const SUGGESTED_TOOL_CATEGORIES = [
  'Utility', 'Research & OSINT', 'Security Analysis', 'Design & Accessibility',
] as const;

// A visitor's own LLM config for live runs — kept in the browser only (see
// LlmConfigService), sent per-request, never persisted server-side.
export interface LlmConfig {
  backend: (typeof BACKENDS)[number];
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

// One named credential in the visitor's saved list, assignable per-agent on
// the Runs page.
export interface SavedLlmCredential extends LlmConfig {
  id: string;
  label: string;
}

export interface Agent {
  id?: string;
  name: string;
  role: string;
  goal: string;
  backend: string | null;
  model: string | null;
  temperature: number;
  maxTokens: number | null;
  systemPrompt: string;
  vaults: string[];
  tools: string[];
  // Assigned on creation (auto-picked server-side unless overridden) so this
  // agent's runs and tool assignments stay visually traceable to it.
  color: string | null;
}

// A Tool Shed catalog entry — either a cataloged instance of a builtin tool,
// or a user-defined tool that calls out to a URL ("http" kind). Assignable to
// agents by `name`.
export interface Tool {
  id?: string;
  name: string;
  kind: (typeof TOOL_KINDS)[number];
  description: string;
  category?: string;
  method?: (typeof HTTP_METHODS)[number] | null;
  urlTemplate?: string;
  headers?: Record<string, string>;
}

// An AI-proposed http tool from a plain-language description — never saved on
// its own; the Tool Shed form is pre-filled with this for the user to review.
export interface GeneratedTool {
  name: string;
  description: string;
  method: (typeof HTTP_METHODS)[number];
  urlTemplate: string;
  headers: Record<string, string>;
}

export interface Crew {
  id?: string;
  name: string;
  topology: Topology;
  agentNames: string[];
  supervisorName: string | null;
  maxRounds: number;
  maxHandoffChars: number | null;
}

// One proposed agent within a crew template — the wizard creates a real
// Agent from this (if the user doesn't already have one by that name) with
// `tools` toggleable before creation, not fixed by the template.
export interface CrewTemplateAgent {
  name: string;
  role: string;
  goal: string;
  tools: string[];
}

export interface CrewTemplate {
  id?: string;
  name: string;
  description: string;
  topology: Topology;
  agents: CrewTemplateAgent[];
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface RunStep {
  agent: string;
  output: string;
  meta?: Record<string, unknown>;
  seq?: number;
}

export interface CrewUsage {
  crewName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  steps: number;
}

export interface RunStats {
  runCount: number;
  totals: { promptTokens: number; completionTokens: number; totalTokens: number };
  byCrew: CrewUsage[];
}

export interface Run {
  id: string;
  crewName: string;
  task: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  mode: 'live' | 'replay';
  result?: { output: string; steps: RunStep[] } | null;
  error?: string | null;
  createdAt?: string;
}

export type RunEvent =
  | { type: 'delta'; agent: string; text: string }
  | { type: 'step'; agent: string; output: string; meta?: Record<string, unknown>; seq?: number }
  | { type: 'done'; output: string }
  | { type: 'cancelled' }
  | { type: 'failed'; message: string };
