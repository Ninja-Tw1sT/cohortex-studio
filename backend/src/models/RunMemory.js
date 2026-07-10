const mongoose = require("mongoose");

const runMemorySchema = new mongoose.Schema(
  {
    crewName: { type: String, required: true, index: true },
    summary: { type: String, required: true, maxlength: 500 },
    task: { type: String, required: true },
  },
  { timestamps: true }
);

runMemorySchema.index({ crewName: 1, createdAt: -1 });

runMemorySchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("RunMemory", runMemorySchema);
