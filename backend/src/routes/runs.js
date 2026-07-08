const express = require("express");
const Crew = require("../models/Crew");
const Run = require("../models/Run");
const asyncHandler = require("../util/asyncHandler");
const { buildSidecarPayload } = require("../services/crewPayload");
const sidecar = require("../services/sidecarClient");

const router = express.Router();

// POST /api/runs { crewId, task, mode } — start a crew (live) or fetch a replay.
router.post("/", asyncHandler(async (req, res) => {
  const { crewId, task, mode = "live" } = req.body;
  if (!task) return res.status(400).json({ error: "task is required" });

  const crew = await Crew.findById(crewId);
  if (!crew) return res.status(404).json({ error: "crew not found" });

  if (mode === "replay") {
    const replay = await Run.findOne({ crewName: crew.name, mode: "replay" }).sort({ createdAt: -1 });
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
    const { run_id } = await sidecar.startRun(payload, task);
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
router.get("/", asyncHandler(async (_req, res) => {
  res.json(await Run.find().sort({ createdAt: -1 }).limit(50));
}));

// GET /api/runs/:id — poll fallback; syncs terminal state from the sidecar.
router.get("/:id", asyncHandler(async (req, res) => {
  const run = await Run.findById(req.params.id);
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
  const run = await Run.findById(req.params.id);
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
    send("error", { message: "run has no sidecar id" });
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
      send("error", { message: String(e.message || e) });
      break;
    }
    for (const e of ev.events) {
      since = Math.max(since, e.seq);
      if (e.type === "step") send("step", e);
      else if (e.type === "done") send("done", { output: e.output });
      else if (e.type === "error") send("error", { message: e.message });
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
