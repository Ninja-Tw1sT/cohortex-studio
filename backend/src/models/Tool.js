const mongoose = require("mongoose");

// The names cohortex.tools registers globally via @tool (see
// cohortex/cohortex/tools/__init__.py) — the only "builtin" kind names.
const BUILTIN_NAMES = ["calculator", "word_count", "contrast_ratio", "shannon_entropy", "defang_iocs"];
const KINDS = ["builtin", "http"];
const METHODS = ["GET", "POST"];
// User-defined (non-builtin) tool names: identifier-shaped, so they're safe to
// pass around as a ReAct tool name and can't collide with a builtin's name.
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

const toolSchema = new mongoose.Schema(
  {
    ownerId: { type: String, default: null }, // null = seeded / system demo catalog entry
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: KINDS, default: "builtin" },
    description: { type: String, default: "" },
    // "http" kind only — a user-defined tool that calls out to a URL. The host
    // in urlTemplate must be a fixed literal (enforced in routes/tools.js and,
    // authoritatively, by cohortex.tools.make_dynamic_tool at run time) — only
    // the path/query may reference the agent's own tool argument via {input}.
    method: { type: String, enum: [...METHODS, null], default: null },
    urlTemplate: { type: String, default: "" },
    headers: { type: Map, of: String, default: {} },
  },
  { timestamps: true }
);

// One catalog entry per name per owner (null owner = shared demo namespace).
toolSchema.index({ ownerId: 1, name: 1 }, { unique: true });

toolSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Tool", toolSchema);
module.exports.BUILTIN_NAMES = BUILTIN_NAMES;
module.exports.KINDS = KINDS;
module.exports.METHODS = METHODS;
module.exports.NAME_RE = NAME_RE;
