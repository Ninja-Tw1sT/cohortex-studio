import { Tool } from './models';

// Cohortex agents never call these — its ReAct loop is prompt-based, not
// provider-native tool-calling, which is exactly what makes it work
// identically across backends (including ones with no native tool-calling
// support at all, like most small local Ollama models). This is a one-way,
// purely deterministic reference export: "what would this tool look like as
// a native OpenAI/Anthropic/Gemini function-calling schema" — no LLM call, no
// cost, just a data reshape of what's already in the catalog entry. Every
// Cohortex tool (builtin or http) takes exactly one string argument, so the
// parameter shape is the same regardless of kind.
export type SchemaProvider = 'openai' | 'anthropic' | 'gemini';

export const SCHEMA_PROVIDERS: { id: SchemaProvider; label: string }[] = [
  { id: 'openai', label: 'OpenAI (also Grok)' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini' },
];

function inputDescription(t: Tool): string {
  return t.kind === 'http'
    ? 'Value substituted into the URL template.'
    : "The tool's single string argument.";
}

function toOpenAiSchema(t: Tool): object {
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description || t.name,
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: inputDescription(t) } },
        required: ['input'],
      },
    },
  };
}

function toAnthropicSchema(t: Tool): object {
  return {
    name: t.name,
    description: t.description || t.name,
    input_schema: {
      type: 'object',
      properties: { input: { type: 'string', description: inputDescription(t) } },
      required: ['input'],
    },
  };
}

function toGeminiSchema(t: Tool): object {
  return {
    name: t.name,
    description: t.description || t.name,
    parameters: {
      type: 'OBJECT',
      properties: { input: { type: 'STRING', description: inputDescription(t) } },
      required: ['input'],
    },
  };
}

export function schemaFor(t: Tool, provider: SchemaProvider): object {
  if (provider === 'openai') return toOpenAiSchema(t);
  if (provider === 'anthropic') return toAnthropicSchema(t);
  return toGeminiSchema(t);
}
