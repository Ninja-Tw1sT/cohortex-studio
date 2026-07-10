const express = require("express");
const { BACKENDS: KNOWN_LLM_BACKENDS } = require("../models/Agent");
const Crew = require("../models/Crew");
const Run = require("../models/Run");
const RunMemory = require("../models/RunMemory");
const asyncHandler = require("../util/asyncHandler");
const { buildSidecarPayload } = require("../services/crewPayload");
const sidecar = require("../services/sidecarClient");
const { runLimiter } = require("../middleware/rateLimit");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

// Some deployments (e.g. the public demo, which has no sidecar/LLM backend
// wired up) only serve pre-recorded replays. Set LIVE_RUNS_ENABLED=false to
// reject live runs cleanly instead of timing out against a missing sidecar.
const liveRunsEnabled = () => process.env.LIVE_RUNS_ENABLED !== "false";

const MAX_KEY_LEN = 300; // generous cap for real provider keys; blocks abuse/huge payloads

// One visitor-supplied override for a single agent. Never persisted - forwarded
// straight to the sidecar and discarded after the run starts.
function validOverride(o) {
  if (!o || typeof o !== "object") return null;
  if (!KNOWN_LLM_BACKENDS.includes(o.backend)) return null;
  if (o.backend === "ollama") {
    if (!o.baseUrl || typeof o.baseUrl !== "string" || o.baseUrl.length > MAX_KEY_LEN) return null;
  } else {
    if (!o.apiKey || typeof o.apiKey !== "string" || o.apiKey.length > MAX_KEY_LEN) return null;
  }
  if (o.model !== undefined && o.model !== null && typeof o.model !== "string") return null;
  return {
    backend: o.backend,
    model: o.model || undefined,
    apiKey: o.apiKey || undefined,
    baseUrl: o.baseUrl || undefined,
  };
}

// Validate a { [agentName]: override } map and confirm it fully covers `names`
// (every agent + supervisor in the resolved crew). Returns { overrides, error }.
function validateLlmOverrides(raw, names) {
  if (raw === undefined || raw === null) return { overrides: null, error: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { overrides: null, error: "llmOverrides must be an object keyed by agent name" };
  }
  const overrides = {};
  for (const name of names) {
    const v = validOverride(raw[name]);
    if (!v) {
      return { overrides: null, error: `llmOverrides is missing a valid entry for agent "${name}"` };
    }
    overrides[name] = v;
  }
  return { overrides, error: null };
}

// POST /api/runs { crewId, task, mode, llmOverrides? } — start a crew (live) or fetch a replay.
// Replay is free (stream stored steps, no sidecar call) so it stays public;
// starting a live run costs a real LLM call and requires sign-in. A visitor can
// bypass LIVE_RUNS_ENABLED by supplying llmOverrides that fully cover every
// agent in the crew (their keys, their cost) — partial coverage is rejected
// up front rather than left to fail deep inside the sidecar per-agent.
router.post("/", runLimiter, asyncHandler(async (req, res) => {
  const { crewId, task, mode = "live", llmOverrides: rawOverrides } = req.body;
  if (!task) return res.status(400).json({ error: "task is required" });

  const crew = await Crew.findOne({ _id: crewId, ...readableBy(req.user) });
  if (!crew) return res.status(404).json({ error: "crew not found" });

  if (mode === "replay") {
    const replay = await Run.findOne({ crewName: crew.name, mode: "replay", ...readableBy(req.user) }).sort({ createdAt: -1 });
    if (!replay) return res.status(404).json({ error: "no replay available for this crew" });
    return res.status(200).json({ runId: replay.id, status: replay.status });
  }

  // Live mode: validate coverage against this crew's actual agent names.
  const names = [...crew.agentNames, ...(crew.supervisorName ? [crew.supervisorName] : [])];
  const hasOverrides = rawOverrides !== undefined && rawOverrides !== null;
  let llmOverrides = null;
  if (hasOverrides) {
    const { overrides, error } = validateLlmOverrides(rawOverrides, names);
    if (error) return res.status(400).json({ error });
    llmOverrides = overrides;
  }

  if (!hasOverrides && !liveRunsEnabled()) {
    return res.status(403).json({ error: "live runs are disabled on this deployment — add your own LLM key(s) in LLM Config, or try replay mode" });
  }
  if (!req.user) return res.status(401).json({ error: "sign-in required for a live run" });

  let payload;
  try {
    payload = await buildSidecarPayload(crew);
  } catch (e) {
    // e.g. the crew references an agent name that doesn't exist — a client/config error.
    return res.status(400).json({ error: e.message });
  }

  const run = await Run.create({
    ownerId: req.user?.uid ?? null,
    crewName: crew.name,
    task,
    status: "running",
    mode: "live",
    startedAt: new Date(),
  }); // no llmOverrides field here or in the schema - never persisted to Mongo

  const memories = await RunMemory.find({ crewName: crew.name })
    .sort({ createdAt: -1 }).limit(3).lean();
  const memoryPayload = memories.length
    ? memories.map(m => ({ summary: m.summary, task: m.task, createdAt: m.createdAt }))
    : undefined;

  try {
    const { run_id } = await sidecar.startRun(payload, task, llmOverrides, memoryPayload);
    run.sidecarRunId = run_id;
    await run.save();
  } catch (e) {
    run.status = "error";
    run.error = String(e.message || e);
    run.finishedAt = new Date();
    await run.save();
    return res.status(502).json({ error: `sidecar unavailable: ${e.message}` });
  }

  res.status(201).json({ runId: run.id, status: run.status });
}));

// GET /api/runs — recent history.
router.get("/", asyncHandler(async (req, res) => {
  res.json(await Run.find(readableBy(req.user)).sort({ createdAt: -1 }).limit(50));
}));

// GET /api/runs/stats — token usage aggregated from completed runs' step meta,
// data already captured by every run and otherwise only ever shown per-run then
// discarded. Registered before /:id so "stats" isn't swallowed as a run id.
router.get("/stats", asyncHandler(async (req, res) => {
  const match = { ...readableBy(req.user), status: "done" };
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const byCrew = await Run.aggregate([
    { $match: match },
    { $unwind: "$result.steps" },
    {
      $group: {
        _id: "$crewName",
        promptTokens: { $sum: { $ifNull: ["$result.steps.meta.usage.prompt_tokens", 0] } },
        completionTokens: { $sum: { $ifNull: ["$result.steps.meta.usage.completion_tokens", 0] } },
        totalTokens: { $sum: { $ifNull: ["$result.steps.meta.usage.total_tokens", 0] } },
        steps: { $sum: 1 },
      },
    },
    { $sort: { totalTokens: -1 } },
    {
      $project: {
        _id: 0, crewName: "$_id", promptTokens: 1, completionTokens: 1, totalTokens: 1, steps: 1,
      },
    },
  ]);

  const totals = byCrew.reduce((acc, c) => ({
    promptTokens: acc.promptTokens + c.promptTokens,
    completionTokens: acc.completionTokens + c.completionTokens,
    totalTokens: acc.totalTokens + c.totalTokens,
  }), { ...zero });

  const runCount = await Run.countDocuments(match);

  res.json({ runCount, totals, byCrew });
}));

// GET /api/runs/:id — poll fallback; syncs terminal state from the sidecar.
router.get("/:id", asyncHandler(async (req, res) => {
  const run = await Run.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!run) return res.status(404).json({ error: "run not found" });

  if (run.status === "running" && run.sidecarRunId) {
    try {
      const s = await sidecar.getRun(run.sidecarRunId);
      if (s.status === "done" || s.status === "error" || s.status === "cancelled") {
        run.status = s.status;
        run.result = s.result ?? run.result;
        run.error = s.error ?? run.error;
        run.finishedAt = new Date();
        await run.save();
      }
    } catch {
      /* leave as running; next poll retries */
    }
  }
  res.json(run);
}));

// POST /api/runs/:id/cancel — best-effort stop for a live run in progress.
// { ok: true } if a cancel was actually requested, { ok: false } if the run
// had already finished (or was never live) — neither is an error.
router.post("/:id/cancel", requireAuth, asyncHandler(async (req, res) => {
  const run = await Run.findOne({ _id: req.params.id, ownerId: req.user.uid });
  if (!run) return res.status(404).json({ error: "run not found" });
  if (run.status !== "running" || !run.sidecarRunId) {
    return res.json({ ok: false });
  }
  try {
    const result = await sidecar.cancelRun(run.sidecarRunId);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: `sidecar unavailable: ${e.message}` });
  }
}));

// GET /api/runs/:id/stream — SSE relay of the sidecar's step/done/error events.
router.get("/:id/stream", asyncHandler(async (req, res) => {
  const run = await Run.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!run) return res.status(404).json({ error: "run not found" });

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (res.flushHeaders) res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Replay: stream stored steps, zero sidecar calls.
  if (run.mode === "replay" && run.result) {
    (run.result.steps || []).forEach((s, i) =>
      send("step", { seq: i + 1, agent: s.agent, output: s.output, meta: s.meta })
    );
    send("done", { output: run.result.output });
    return res.end();
  }

  if (!run.sidecarRunId) {
    send("failed", { message: "run has no sidecar id" });
    return res.end();
  }

  let since = 0;
  let closed = false;
  req.on("close", () => { closed = true; });

  while (!closed) {
    let ev;
    try {
      ev = await sidecar.getEvents(run.sidecarRunId, since);
    } catch (e) {
      send("failed", { message: String(e.message || e) });
      break;
    }
    for (const e of ev.events) {
      since = Math.max(since, e.seq);
      if (e.type === "delta") send("delta", { agent: e.agent, text: e.text });
      else if (e.type === "step") send("step", e);
      else if (e.type === "done") send("done", { output: e.output });
      else if (e.type === "error") send("failed", { message: e.message });
      else if (e.type === "cancelled") send("cancelled", {});
    }
    if (ev.status === "done" || ev.status === "error" || ev.status === "cancelled") {
      try {
        const s = await sidecar.getRun(run.sidecarRunId);
        run.status = ev.status;
        run.result = s.result ?? run.result;
        run.error = s.error ?? run.error;
        run.finishedAt = new Date();
        await run.save();
        if (ev.status === "done" && s.result?.output) {
          RunMemory.create({
            crewName: run.crewName,
            summary: s.result.output.slice(0, 500),
            task: run.task,
          }).catch(() => {});
        }
      } catch {
        /* best-effort persist */
      }
      break;
    }
    // Tighter than before deltas existed (was 700ms) — streamed chunks read as
    // "live" only if the relay polls often enough to forward them promptly.
    // Cheap to do: this is in-memory event-log polling on localhost, not an
    // LLM call, so there's no cost impact to polling more often.
    await new Promise((r) => setTimeout(r, 250));
  }
  res.end();
}));

module.exports = router;
