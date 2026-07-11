const mongoose = require("mongoose");

const TOPOLOGIES = ["single", "sequential", "supervisor"];

// One proposed agent within a template — creates a real Agent (see
// routes/crewTemplates.js's consumer, the wizard flow) if the user doesn't
// already have one by that name. `tools` are toggled on/off in the wizard
// before creation, not validated against the Tool Shed catalog here — a
// template is reusable across different catalogs/deployments.
const templateAgentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "" },
    goal: { type: String, default: "" },
    tools: { type: [String], default: [] },
  },
  { _id: false }
);

const crewTemplateSchema = new mongoose.Schema(
  {
    ownerId: { type: String, default: null }, // null = seeded / shared demo template
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    topology: { type: String, enum: TOPOLOGIES, default: "sequential" },
    agents: { type: [templateAgentSchema], default: [] },
  },
  { timestamps: true }
);

// One template name per owner (null owner = shared demo namespace).
crewTemplateSchema.index({ ownerId: 1, name: 1 }, { unique: true });

crewTemplateSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("CrewTemplate", crewTemplateSchema);
module.exports.TOPOLOGIES = TOPOLOGIES;
