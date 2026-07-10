import { Tool } from './models';

// A small curated library of ready-made http tools against well-known, free,
// no-signup-required public APIs. "Use this" in the Tool Shed pre-fills the
// New Tool form with one of these — still goes through the normal Save/
// validate() path, nothing is created just by picking a template.
export type ToolTemplate = Pick<Tool, 'name' | 'description' | 'method' | 'urlTemplate'>;

export const TOOL_TEMPLATES: ToolTemplate[] = [
  {
    name: 'wikipedia_summary',
    description: "Get a short summary of a Wikipedia article by title, e.g. 'Ada Lovelace'.",
    method: 'GET',
    urlTemplate: 'https://en.wikipedia.org/api/rest_v1/page/summary/{input}',
  },
  {
    name: 'dictionary_lookup',
    description: 'Look up the definition of an English word.',
    method: 'GET',
    urlTemplate: 'https://api.dictionaryapi.dev/api/v2/entries/en/{input}',
  },
  {
    name: 'public_holidays',
    description: "Get the next public holidays for a country code, e.g. 'US'.",
    method: 'GET',
    urlTemplate: 'https://date.nager.at/api/v3/NextPublicHolidays/{input}',
  },
  {
    name: 'programming_joke',
    description: "Get a random joke from a category, e.g. 'Programming'.",
    method: 'GET',
    urlTemplate: 'https://v2.jokeapi.dev/joke/{input}',
  },
  {
    name: 'cat_fact',
    description: 'Get a random cat fact — no input needed.',
    method: 'GET',
    urlTemplate: 'https://catfact.ninja/fact',
  },
];
