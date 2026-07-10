const Agent = require("../models/Agent");
const Tool = require("../models/Tool");

// Convert a stored Agent doc to the sidecar's AgentProfileIn (camelCase) shape.
const toProfile = (a) => ({
  name: a.name,
  role: a.role,
  goal: a.goal,
  backend: a.backend,
  model: a.model,
  temperature: a.temperature,
  maxTokens: a.maxTokens,
  systemPrompt: a.systemPrompt,
  vaults: a.vaults,
  tools: a.tools,
});

// Convert a stored Tool doc to the sidecar's ToolDefIn shape. "builtin" kind
// entries are included too (harmless — cohortex.tools treats them as a no-op,
// since those names already resolve via the global registry regardless).
const toToolDef = (t) => ({
  name: t.name,
  kind: t.kind,
  description: t.description || "",
  method: t.method || undefined,
  urlTemplate: t.urlTemplate || undefined,
  headers: t.headers && t.headers.size ? Object.fromEntries(t.headers) : undefined,
});

// Resolve a Crew doc's agent names into full sidecar profiles, preferring the
// owner's own agents over seeded ones when a name exists in both.
async function buildSidecarPayload(crew) {
  const names = [...crew.agentNames];
  if (crew.supervisorName) names.push(crew.supervisorName);

  const docs = await Agent.find({
    name: { $in: names },
    ownerId: { $in: [crew.ownerId, null] },
  });

  const byName = {};
  for (const d of docs) {
    if (!byName[d.name] || d.ownerId === crew.ownerId) byName[d.name] = d;
  }

  const missing = names.filter((n) => !byName[n]);
  if (missing.length) {
    throw new Error(`crew references unknown agents: ${missing.join(", ")}`);
  }

  // Every tool name any resolved agent references, cataloged (Tool Shed) or
  // not — a name with no catalog entry just sends no toolDef for it, which is
  // fine for builtins (they work regardless) and degrades to "unknown tool"
  // at call time for a deleted/renamed http tool.
  const toolNames = [...new Set(Object.values(byName).flatMap((a) => a.tools || []))];
  const toolDocs = toolNames.length
    ? await Tool.find({ name: { $in: toolNames }, ownerId: { $in: [crew.ownerId, null] } })
    : [];
  const toolByName = {};
  for (const t of toolDocs) {
    if (!toolByName[t.name] || t.ownerId === crew.ownerId) toolByName[t.name] = t;
  }

  return {
    name: crew.name,
    topology: crew.topology,
    maxRounds: crew.maxRounds,
    maxHandoffChars: crew.maxHandoffChars || undefined,
    supervisor: crew.supervisorName ? toProfile(byName[crew.supervisorName]) : null,
    agents: crew.agentNames.map((n) => toProfile(byName[n])),
    toolDefs: Object.values(toolByName).map(toToolDef),
  };
}

module.exports = { buildSidecarPayload, toProfile, toToolDef };
