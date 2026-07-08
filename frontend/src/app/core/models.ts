export const BACKENDS = ['ollama', 'openai', 'anthropic', 'gemini', 'grok'] as const;
export const TOPOLOGIES = ['single', 'sequential', 'supervisor'] as const;
export type Topology = (typeof TOPOLOGIES)[number];

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
}

export interface Crew {
  id?: string;
  name: string;
  topology: Topology;
  agentNames: string[];
  supervisorName: string | null;
  maxRounds: number;
}

export interface RunStep {
  agent: string;
  output: string;
  meta?: Record<string, unknown>;
  seq?: number;
}

export interface Run {
  id: string;
  crewName: string;
  task: string;
  status: 'queued' | 'running' | 'done' | 'error';
  mode: 'live' | 'replay';
  result?: { output: string; steps: RunStep[] } | null;
  error?: string | null;
  createdAt?: string;
}

export type RunEvent =
  | { type: 'step'; agent: string; output: string; meta?: Record<string, unknown>; seq?: number }
  | { type: 'done'; output: string }
  | { type: 'failed'; message: string };
