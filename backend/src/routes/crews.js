const express = require("express");
const Crew = require("../models/Crew");
const asyncHandler = require("../util/asyncHandler");

const router = express.Router();

const FIELDS = ["name", "topology", "agentNames", "supervisorName", "maxRounds"];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

router.get("/", asyncHandler(async (_req, res) => {
  res.json(await Crew.find().sort({ name: 1 }));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const crew = await Crew.findById(req.params.id);
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json(crew);
}));

router.post("/", asyncHandler(async (req, res) => {
  const doc = await Crew.create({ ...pick(req.body), ownerId: req.user?.uid ?? null });
  res.status(201).json(doc);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const crew = await Crew.findByIdAndUpdate(req.params.id, pick(req.body), {
    new: true, runValidators: true,
  });
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json(crew);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const crew = await Crew.findByIdAndDelete(req.params.id);
  if (!crew) return res.status(404).json({ error: "crew not found" });
  res.json({ ok: true });
}));

module.exports = router;
