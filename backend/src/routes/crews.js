const express = require("express");
const Crew = require("../models/Crew");
const asyncHandler = require("../util/asyncHandler");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const FIELDS = ["name", "topology", "agentNames", "supervisorName", "maxRounds", "maxHandoffChars"];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

router.get("/", asyncHandler(async (req, res) => {
  res.json(await Crew.find(readableBy(req.user)).sort({ name: 1 }).limit(200));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const crew = await Crew.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json(crew);
}));

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const doc = await Crew.create({ ...pick(req.body), ownerId: req.user.uid });
  res.status(201).json(doc);
}));

router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  // Demo crews (ownerId: null) aren't owned by any user and can't be edited
  // via the API — only the seed script touches them.
  const crew = await Crew.findOneAndUpdate(
    { _id: req.params.id, ownerId: req.user.uid },
    pick(req.body),
    { new: true, runValidators: true }
  );
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json(crew);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const crew = await Crew.findOneAndDelete({ _id: req.params.id, ownerId: req.user.uid });
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json({ ok: true });
}));

module.exports = router;
