const express = require("express");
const Crew = require("../models/Crew");
const Run = require("../models/Run");
const asyncHandler = require("../util/asyncHandler");
const { buildSidecarPayload } = require("../services/crewPayload");
const sidecar = require("../services/sidecarClient");
const { runLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// Public read: demo namespace (ownerId: null) is visible to everyone so
// recruiters can browse without logging in; signed-in users also see their own.
const readableBy = (user) => (user ? { $or: [{ ownerId: null }, { ownerId: user.uid }] } : { ownerId: null });

// Some deployments (e.g. the public demo, which has no sidecar/LLM backend
// wired up) only serve pre-recorded replays. Set LIVE_RUNS_ENABLED=false to
// reject live runs cleanly instead of timing out against a missing sidecar.
const liveRunsEnabled = () => process.env.LIVE_RUNS_ENABLED !== "false";

const KNOWN_LLM_BACKENDS = ["openai", "anthropic", "gemini", "grok", "ollama"];

// A visitor's own LLM config, supplied per-request and forwarded straight to the
// sidecar — intentionally never added to the Run.create() call below, so it's
// never written to Mongo. Lets live runs work even when LIVE_RUNS_ENABLED=false,
// since the visitor is paying for their own LLM calls, not this deployment.
function validLlmOverride(o) {
  if (!o || typeof o !== "object") return null;
  if (!KNOWN_LLM_BACKENDS.includes(o.backend)) return null;
  if (o.backend === "ollama") {
    if (!o.baseUrl) return null;
  } else if (!o.apiKey || o.apiKey.length > 500) {
    return null;
  }
  return {
    backend: o.backend,
    model: o.model || undefined,
    apiKey: o.apiKey || undefined,
    baseUrl: o.baseUrl || undefined,
  };
}

// POST /api/runs { crewId, task, mode, llmOverride? } — start a crew (live) or fetch a replay.
// Replay is free (stream stored steps, no sidecar call) so it stays public;
// starting a live run costs a real LLM call and requires sign-in, unless the
// visitor supplied their own llmOverride (their key, their cost).
router.post("/", runLimiter, asyncHandler(async (req, res) => {
  const { crewId, task, mode = "live", llmOverride: rawOverride } = req.body;
  if (!task) return res.status(400).json({ error: "task is required" });

  let llmOverride = null;
  if (rawOverride) {
    llmOverride = validLlmOverride(rawOverride);
    if (!llmOverride) {
      return res.status(400).json({
        error: `invalid llmOverride — backend must be one of ${KNOWN_LLM_BACKENDS.join(", ")}, with an apiKey (or baseUrl for ollama)`,
      });
    }
  }

  if (mode !== "replay" && !liveRunsEnabled() && !llmOverride) {
    return res.status(403).json({ error: "live runs are disabled on this deployment — add your own LLM key in LLM Config, or try replay mode" });
  }
  if (mode !== "replay" && !req.user) return res.status(401).json({ error: "sign-in required for a live run" });

  const crew = await Crew.findOne({ _id: crewId, ...readableBy(req.user) });
  if (!crew) return res.status(404).json({ error: "crew not found" });

  if (mode === "replay") {
    const replay = await Run.findOne({ crewName: crew.name, mode: "replay", ...readableBy(req.user) }).sort({ createdAt: -1 });
    if (!replay) return res.status(404).json({ error: "no replay available for this crew" });
    return res.status(200).json({ runId: replay.id, status: replay.status });
  }

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
  });

  try {
    const { run_id } = await sidecar.startRun(payload, task, llmOverride);
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

// GET /api/runs/:id — poll fallback; syncs terminal state from the sidecar.
router.get("/:id", asyncHandler(async (req, res) => {
  const run = await Run.findOne({ _id: req.params.id, ...readableBy(req.user) });
  if (!run) return res.status(404).json({ error: "run not found" });

  if (run.status === "running" && run.sidecarRunId) {
    try {
      const s = await sidecar.getRun(run.sidecarRunId);
      if (s.status === "done" || s.status === "error") {
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
      if (e.type === "step") send("step", e);
      else if (e.type === "done") send("done", { output: e.output });
      else if (e.type === "error") send("failed", { message: e.message });
    }
    if (ev.status === "done" || ev.status === "error") {
      try {
        const s = await sidecar.getRun(run.sidecarRunId);
        run.status = ev.status;
        run.result = s.result ?? run.result;
        run.error = s.error ?? run.error;
        run.finishedAt = new Date();
        await run.save();
      } catch {
        /* best-effort persist */
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  res.end();
}));

module.exports = router;
