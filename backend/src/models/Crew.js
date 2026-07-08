const mongoose = require("mongoose");

const TOPOLOGIES = ["single", "sequential", "supervisor"];

const crewSchema = new mongoose.Schema(
  {
    ownerId: { type: String, default: null },
    name: { type: String, required: true, trim: true },
    topology: { type: String, enum: TOPOLOGIES, default: "sequential" },
    agentNames: { type: [String], default: [] },
    supervisorName: { type: String, default: null },
    maxRounds: { type: Number, default: 4, min: 1, max: 20 },
  },
  { timestamps: true }
);

crewSchema.index({ ownerId: 1, name: 1 }, { unique: true });

crewSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("Crew", crewSchema);
module.exports.TOPOLOGIES = TOPOLOGIES;
