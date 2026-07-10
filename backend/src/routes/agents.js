const express = require("express");
const Agent = require("../models/Agent");
const asyncHandler = require("../util/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { nextColor } = require("../util/palette");

const router = express.Router();

const FIELDS = [
  "name", "role", "goal", "backend", "model",
  "temperature", "maxTokens", "systemPrompt", "vaults", "tools", "color",
];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

router.get("/", asyncHandler(async (req, res) => {
  res.json(await Agent.find(readableBy(req.user)).sort({ name: 1 }));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const agent = await Agent.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json(agent);
}));

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const fields = pick(req.body);
  if (!fields.color) {
    const existingCount = await Agent.countDocuments({ ownerId: req.user.uid });
    fields.color = nextColor(existingCount);
  }
  const doc = await Agent.create({ ...fields, ownerId: req.user.uid });
  res.status(201).json(doc);
}));

router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  // Demo agents (ownerId: null) aren't owned by any user and can't be edited
  // via the API — only the seed script touches them.
  const agent = await Agent.findOneAndUpdate(
    { _id: req.params.id, ownerId: req.user.uid },
    pick(req.body),
    { new: true, runValidators: true }
  );
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json(agent);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const agent = await Agent.findOneAndDelete({ _id: req.params.id, ownerId: req.user.uid });
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json({ ok: true });
}));

module.exports = router;
