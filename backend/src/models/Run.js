const mongoose = require("mongoose");

// Mirrors the sidecar's CrewResult/AgentResult shape in `result`.
const runSchema = new mongoose.Schema(
  {
    ownerId: { type: String, default: null },
    crewName: { type: String, required: true },
    task: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "done", "error", "cancelled"],
      default: "queued",
    },
    mode: { type: String, enum: ["live", "replay"], default: "live" },
    sidecarRunId: { type: String, default: null },
    result: {
      type: {
        output: String,
        steps: [{ agent: String, output: String, raw: String, meta: Object }],
      },
      default: null,
    },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

runSchema.index({ ownerId: 1, createdAt: -1 });
runSchema.index({ sidecarRunId: 1 });

runSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Run", runSchema);
