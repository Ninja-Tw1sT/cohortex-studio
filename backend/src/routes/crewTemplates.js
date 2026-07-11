const express = require("express");
const CrewTemplate = require("../models/CrewTemplate");
const { TOPOLOGIES } = require("../models/CrewTemplate");
const asyncHandler = require("../util/asyncHandler");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const FIELDS = ["name", "description", "topology", "agents"];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

function validate(effective) {
  const topology = effective.topology || "sequential";
  if (!TOPOLOGIES.includes(topology)) return `topology must be one of: ${TOPOLOGIES.join(", ")}`;
  if (!Array.isArray(effective.agents) || !effective.agents.length) {
    return "template must include at least one agent";
  }
  for (const a of effective.agents) {
    if (!a || typeof a.name !== "string" || !a.name.trim()) return "every template agent needs a name";
  }
  const names = effective.agents.map((a) => a.name);
  if (new Set(names).size !== names.length) return "agent names within a template must be unique";
  return null;
}

router.get("/", asyncHandler(async (req, res) => {
  res.json(await CrewTemplate.find(readableBy(req.user)).sort({ name: 1 }).limit(200));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const t = await CrewTemplate.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!t) return res.status(404).json({ error: "template not found" });
  res.json(t);
}));

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const fields = pick(req.body);
  const err = validate(fields);
  if (err) return res.status(400).json({ error: err });
  const doc = await CrewTemplate.create({ ...fields, ownerId: req.user.uid });
  res.status(201).json(doc);
}));

router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  // Demo templates (ownerId: null) aren't owned by any user and can't be
  // edited via the API — only the seed script touches them.
  const existing = await CrewTemplate.findOne({ _id: req.params.id, ownerId: req.user.uid });
  if (!existing) return res.status(404).json({ error: "template not found" });

  const fields = pick(req.body);
  const effective = { ...existing.toObject(), ...fields };
  const err = validate(effective);
  if (err) return res.status(400).json({ error: err });

  Object.assign(existing, fields);
  await existing.save();
  res.json(existing);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const t = await CrewTemplate.findOneAndDelete({ _id: req.params.id, ownerId: req.user.uid });
  if (!t) return res.status(404).json({ error: "template not found" });
  res.json({ ok: true });
}));

module.exports = router;
