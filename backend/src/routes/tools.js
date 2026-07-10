const express = require("express");
const Tool = require("../models/Tool");
const { KINDS, METHODS, BUILTIN_NAMES, NAME_RE } = require("../models/Tool");
const { isObviouslyUnsafeUrl } = require("../util/urlSafety");
const asyncHandler = require("../util/asyncHandler");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const FIELDS = ["name", "kind", "description", "method", "urlTemplate", "headers"];
const pick = (body) =>
  Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

// Cross-field validation (name shape depends on kind) — Mongoose custom
// validators don't reliably see sibling fields on findOneAndUpdate, so this
// runs explicitly against the *effective* (existing + incoming) field set.
// Returns an error string, or null if valid.
function validate(effective) {
  const kind = effective.kind || "builtin";
  if (!KINDS.includes(kind)) return `kind must be one of: ${KINDS.join(", ")}`;

  if (kind === "builtin") {
    if (!BUILTIN_NAMES.includes(effective.name)) {
      return `name must be one of: ${BUILTIN_NAMES.join(", ")}`;
    }
    return null;
  }

  // kind === "http"
  if (!NAME_RE.test(effective.name || "")) {
    return "name must be a valid identifier (letters, numbers, underscore, not starting with a digit)";
  }
  if (BUILTIN_NAMES.includes(effective.name)) {
    return `"${effective.name}" is reserved for a builtin tool`;
  }
  const method = effective.method || "GET";
  if (!METHODS.includes(method)) return `method must be one of: ${METHODS.join(", ")}`;
  if (!effective.urlTemplate) return "urlTemplate is required for an http tool";

  let hostname;
  try {
    hostname = new URL(effective.urlTemplate).hostname;
  } catch {
    return "urlTemplate is not a valid URL";
  }
  // Letting the agent's own tool argument choose the host would make this an
  // open proxy — {input} is only allowed in the path/query. (Authoritatively
  // enforced again in cohortex.tools.make_dynamic_tool at run time.)
  if (hostname.includes("{input}")) {
    return "urlTemplate's host may not depend on {input} — only the path/query may use it";
  }
  if (isObviouslyUnsafeUrl(effective.urlTemplate)) {
    return "urlTemplate points to a blocked host/IP range";
  }
  return null;
}

router.get("/", asyncHandler(async (req, res) => {
  res.json(await Tool.find(readableBy(req.user)).sort({ name: 1 }));
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const tool = await Tool.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!tool) return res.status(404).json({ error: "tool not found" });
  res.json(tool);
}));

router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const fields = pick(req.body);
  if (fields.kind === "http" && !fields.method) fields.method = "GET";
  const err = validate(fields);
  if (err) return res.status(400).json({ error: err });
  const doc = await Tool.create({ ...fields, ownerId: req.user.uid });
  res.status(201).json(doc);
}));

router.put("/:id", requireAuth, asyncHandler(async (req, res) => {
  // Demo entries (ownerId: null) aren't owned by any user and can't be edited
  // via the API — only the seed script touches them.
  const existing = await Tool.findOne({ _id: req.params.id, ownerId: req.user.uid });
  if (!existing) return res.status(404).json({ error: "tool not found" });

  const fields = pick(req.body);
  const effective = { ...existing.toObject(), ...fields };
  if (effective.kind === "http" && !effective.method) effective.method = "GET";
  const err = validate(effective);
  if (err) return res.status(400).json({ error: err });

  Object.assign(existing, fields);
  await existing.save();
  res.json(existing);
}));

router.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const tool = await Tool.findOneAndDelete({ _id: req.params.id, ownerId: req.user.uid });
  if (!tool) return res.status(404).json({ error: "tool not found" });
  res.json({ ok: true });
}));

module.exports = router;
