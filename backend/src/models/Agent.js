const mongoose = require("mongoose");

const BACKENDS = ["ollama", "openai", "anthropic", "gemini", "grok"];

// Field-for-field mirror of Cohortex's AgentProfile (camelCase at this boundary).
const agentSchema = new mongoose.Schema(
  {
    ownerId: { type: String, default: null }, // null = seeded / system demo agent
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "" },
    goal: { type: String, default: "" },
    backend: { type: String, enum: [...BACKENDS, null], default: null },
    model: { type: String, default: null },
    temperature: { type: Number, default: 0.3, min: 0, max: 2 },
    maxTokens: { type: Number, default: null, min: 1 },
    systemPrompt: { type: String, default: "" },
    vaults: { type: [String], default: [] },
    tools: { type: [String], default: [] },
    // Assigned once on creation (see routes/agents.js) so this agent's runs,
    // tool checkboxes, etc. stay visually traceable to it. Hex color.
    color: { type: String, default: null, match: /^#[0-9a-fA-F]{6}$/ },
  },
  { timestamps: true }
);

// One agent name per owner (null owner = shared demo namespace).
agentSchema.index({ ownerId: 1, name: 1 }, { unique: true });

agentSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Agent", agentSchema);
module.exports.BACKENDS = BACKENDS;
