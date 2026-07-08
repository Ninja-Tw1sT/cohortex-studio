const mongoose = require("mongoose");

// Cached mirror of a Firebase Auth user, used for ownership joins + rate limiting.
const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true },
    email: { type: String, default: "" },
    runsToday: { type: Number, default: 0 },
    runsResetAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
