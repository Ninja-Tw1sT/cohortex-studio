const express = require("express");
const Agent = require("../models/Agent");
const asyncHandler = require("../util/asyncHandler");

const router = express.Router();

const FIELDS = [
  "name", "role", "goal", "backend", "model",
  "temperature", "maxTokens", "systemPrompt", "vaults", "tools",
];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

// Public read (recruiters can browse without logging in).
router.get("/", asyncHandler(async (_req, res) => {
  res.json(await Agent.find().sort({ name: 1 }));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const agent = await Agent.findById(req.params.id);
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json(agent);
}));

// Mutations get an ownerId from req.user once Firebase auth lands (Phase 5); null for now.
router.post("/", asyncHandler(async (req, res) => {
  const doc = await Agent.create({ ...pick(req.body), ownerId: req.user?.uid ?? null });
  res.status(201).json(doc);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const agent = await Agent.findByIdAndUpdate(req.params.id, pick(req.body), {
    new: true, runValidators: true,
  });
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json(agent);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const agent = await Agent.findByIdAndDelete(req.params.id);
  if (!agent) return res.status(404).json({ error: "agent not found" });
  res.json({ ok: true });
}));

module.exports = router;
