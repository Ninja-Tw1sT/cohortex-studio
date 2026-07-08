const Agent = require("../models/Agent");

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

  return {
    name: crew.name,
    topology: crew.topology,
    maxRounds: crew.maxRounds,
    supervisor: crew.supervisorName ? toProfile(byName[crew.supervisorName]) : null,
    agents: crew.agentNames.map((n) => toProfile(byName[n])),
  };
}

module.exports = { buildSidecarPayload, toProfile };
