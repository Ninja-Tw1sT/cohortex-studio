const http = require("http");
const express = require("express");
const request = require("supertest");
const createApp = require("../src/app");
const Agent = require("../src/models/Agent");
const Crew = require("../src/models/Crew");
const Run = require("../src/models/Run");
const Tool = require("../src/models/Tool");
const { setup, teardown, clear } = require("./helpers");

const app = createApp();
const AUTH = "Bearer test:u1";

// A fake Cohortex sidecar (real HTTP on an ephemeral port) so we exercise the
// actual sidecarClient/fetch path, not a mock.
let sidecarServer;
let calls;

let cancelled;

function fakeSidecar() {
  const s = express();
  s.use(express.json());
  s.post("/run", (req, res) => {
    calls.run = req.body;
    let run_id = "sc-1";
    if (req.body.task === "stream test") run_id = "sc-delta";
    if (req.body.task === "cancel test") { run_id = "sc-cancel"; cancelled = false; }
    res.json({ run_id });
  });
  s.get("/runs/sc-cancel", (_req, res) =>
    res.json({ status: cancelled ? "cancelled" : "running", result: null, error: null })
  );
  s.get("/runs/sc-cancel/events", (_req, res) =>
    res.json({
      events: cancelled ? [{ seq: 1, type: "cancelled" }] : [],
      status: cancelled ? "cancelled" : "running",
    })
  );
  s.post("/runs/sc-cancel/cancel", (_req, res) => {
    cancelled = true;
    res.json({ ok: true });
  });
  s.get("/runs/sc-1", (_req, res) =>
    res.json({
      status: "done",
      result: { output: "FINAL", steps: [{ agent: "researcher", output: "r", raw: "", meta: {} }] },
      error: null,
    })
  );
  s.get("/runs/sc-1/events", (_req, res) =>
    res.json({
      events: [
        { seq: 1, type: "step", agent: "researcher", output: "r", meta: {} },
        { seq: 2, type: "done", output: "FINAL" },
      ],
      status: "done",
    })
  );
  s.get("/runs/sc-delta", (_req, res) =>
    res.json({
      status: "done",
      result: { output: "FINAL", steps: [{ agent: "researcher", output: "hello world", raw: "", meta: {} }] },
      error: null,
    })
  );
  s.get("/runs/sc-delta/events", (_req, res) =>
    res.json({
      events: [
        { seq: 1, type: "delta", agent: "researcher", text: "hello " },
        { seq: 2, type: "delta", agent: "researcher", text: "world" },
        { seq: 3, type: "step", agent: "researcher", output: "hello world", meta: {} },
        { seq: 4, type: "done", output: "FINAL" },
      ],
      status: "done",
    })
  );
  return s;
}

beforeAll(async () => {
  await setup();
  await new Promise((resolve) => {
    sidecarServer = http.createServer(fakeSidecar()).listen(0, () => {
      process.env.SIDECAR_URL = `http://127.0.0.1:${sidecarServer.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((r) => sidecarServer.close(r));
  await teardown();
});

beforeEach(() => { calls = {}; cancelled = false; });
afterEach(clear);

async function seedCrew() {
  await Agent.create({ name: "researcher", role: "Research Analyst", goal: "g", backend: "ollama" });
  return Crew.create({ name: "solo_team", topology: "single", agentNames: ["researcher"] });
}

async function seedCrewTwoAgents() {
  await Agent.create({ name: "researcher", role: "Research Analyst", goal: "g", backend: "ollama" });
  await Agent.create({ name: "writer", role: "Writer", goal: "g", backend: "ollama" });
  return Crew.create({ name: "duo_team", topology: "sequential", agentNames: ["researcher", "writer"] });
}

describe("runs (live)", () => {
  test("POST builds the sidecar payload from Mongo and starts a run", async () => {
    const crew = await seedCrew();
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "explain RAG" });
    expect(r.status).toBe(201);
    expect(r.body.runId).toBeDefined();
    // the fake sidecar received a fully-resolved crew payload
    expect(calls.run.task).toBe("explain RAG");
    expect(calls.run.crew.agents[0].name).toBe("researcher");
    expect(calls.run.crew.topology).toBe("single");
  });

  test("starting a live run without sign-in is rejected with 401", async () => {
    const crew = await seedCrew();
    const r = await request(app).post("/api/runs").send({ crewId: crew.id, task: "explain RAG" });
    expect(r.status).toBe(401);
  });

  test("GET /:id syncs the terminal result from the sidecar", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    const got = await request(app).get(`/api/runs/${started.body.runId}`).set("Authorization", AUTH);
    expect(got.body.status).toBe("done");
    expect(got.body.result.output).toBe("FINAL");
  });

  test("unknown crew -> 404", async () => {
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: "64b000000000000000000000", task: "t" });
    expect(r.status).toBe(404);
  });

  test("crew referencing a missing agent -> validation error", async () => {
    const crew = await Crew.create({ name: "bad", topology: "single", agentNames: ["ghost"] });
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unknown agents/);
  });

  test("payload's toolDefs includes the http tool an agent references, with headers as a plain object", async () => {
    await Agent.create({
      name: "forecaster", role: "Forecaster", goal: "g", backend: "ollama",
      tools: ["weather"], ownerId: null,
    });
    await Tool.create({
      name: "weather", kind: "http", description: "look up weather", method: "GET",
      urlTemplate: "https://api.example.com/weather?city={input}",
      headers: { "X-Api-Key": "demo-key" }, ownerId: null,
    });
    const crew = await Crew.create({ name: "weather_team", topology: "single", agentNames: ["forecaster"] });

    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    expect(r.status).toBe(201);
    expect(calls.run.crew.toolDefs).toEqual([
      {
        name: "weather", kind: "http", description: "look up weather", method: "GET",
        urlTemplate: "https://api.example.com/weather?city={input}",
        headers: { "X-Api-Key": "demo-key" },
      },
    ]);
  });

  test("an agent's own http tool takes precedence over a same-named demo catalog entry", async () => {
    await Agent.create({ name: "forecaster", role: "F", goal: "g", backend: "ollama", tools: ["weather"], ownerId: "u1" });
    await Tool.create({ name: "weather", kind: "http", method: "GET", urlTemplate: "https://demo.example.com/{input}", ownerId: null });
    await Tool.create({ name: "weather", kind: "http", method: "GET", urlTemplate: "https://mine.example.com/{input}", ownerId: "u1" });
    const crew = await Crew.create({ name: "weather_team", topology: "single", agentNames: ["forecaster"], ownerId: "u1" });

    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    expect(r.status).toBe(201);
    expect(calls.run.crew.toolDefs[0].urlTemplate).toBe("https://mine.example.com/{input}");
  });

  test("an uncataloged tool name is simply omitted from toolDefs (no crash)", async () => {
    const crew = await seedCrew(); // "researcher" has no tools by default
    await Agent.findOneAndUpdate({ name: "researcher" }, { tools: ["some_deleted_tool"] });
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    expect(r.status).toBe(201);
    expect(calls.run.crew.toolDefs).toEqual([]);
  });
});

describe("runs (streaming deltas)", () => {
  test("SSE relay forwards delta events, in order, before the step event", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "stream test" });
    expect(started.status).toBe(201);

    const stream = await request(app).get(`/api/runs/${started.body.runId}/stream`).set("Authorization", AUTH);
    const deltaIdx = stream.text.indexOf("event: delta");
    const stepIdx = stream.text.indexOf("event: step");
    expect(deltaIdx).toBeGreaterThan(-1);
    expect(stepIdx).toBeGreaterThan(-1);
    expect(deltaIdx).toBeLessThan(stepIdx);
    expect(stream.text).toContain('"agent":"researcher"');
    expect(stream.text).toContain('"text":"hello "');
    expect(stream.text).toContain('"text":"world"');
  });
});

describe("runs (cancellation)", () => {
  test("POST /:id/cancel forwards to the sidecar and returns ok:true for a running run", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "cancel test" });
    expect(started.status).toBe(201);

    const r = await request(app).post(`/api/runs/${started.body.runId}/cancel`).set("Authorization", AUTH);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  test("cancelling without sign-in is rejected with 401", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "cancel test" });
    const r = await request(app).post(`/api/runs/${started.body.runId}/cancel`);
    expect(r.status).toBe(401);
  });

  test("cancelling someone else's run 404s", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "cancel test" });
    const r = await request(app).post(`/api/runs/${started.body.runId}/cancel`).set("Authorization", "Bearer test:u2");
    expect(r.status).toBe(404);
  });

  test("cancelling an already-finished run returns ok:false without calling the sidecar", async () => {
    const run = await Run.create({
      ownerId: "u1", crewName: "solo_team", task: "t", status: "done", mode: "live", sidecarRunId: "sc-1",
    });
    const r = await request(app).post(`/api/runs/${run.id}/cancel`).set("Authorization", AUTH);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: false });
  });

  test("SSE relay forwards the cancelled event and syncs the terminal status", async () => {
    const crew = await seedCrew();
    const started = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "cancel test" });
    await request(app).post(`/api/runs/${started.body.runId}/cancel`).set("Authorization", AUTH);

    const stream = await request(app).get(`/api/runs/${started.body.runId}/stream`).set("Authorization", AUTH);
    expect(stream.text).toContain("event: cancelled");

    const run = await Run.findById(started.body.runId);
    expect(run.status).toBe("cancelled");
  });
});

describe("runs (replay, no sidecar call)", () => {
  test("SSE streams stored steps then done without touching the sidecar, no sign-in needed", async () => {
    const crew = await Crew.create({ name: "rep", topology: "single", agentNames: [] });
    await Run.create({
      crewName: "rep",
      task: "t",
      status: "done",
      mode: "replay",
      result: { output: "CACHED", steps: [{ agent: "a", output: "s1", raw: "", meta: {} }] },
    });

    const r = await request(app).post("/api/runs").send({ crewId: crew.id, task: "t", mode: "replay" });
    expect(r.status).toBe(200);

    const stream = await request(app).get(`/api/runs/${r.body.runId}/stream`);
    expect(stream.text).toContain('event: step');
    expect(stream.text).toContain('event: done');
    expect(stream.text).toContain("CACHED");
  });
});

describe("runs (usage stats)", () => {
  async function seedDoneRun(crewName, ownerId, usages) {
    await Run.create({
      ownerId, crewName, task: "t", status: "done", mode: "live",
      result: {
        output: "out",
        steps: usages.map((u, i) => ({ agent: `a${i}`, output: "o", raw: "", meta: { usage: u } })),
      },
    });
  }

  test("aggregates token usage per crew and overall, from done runs only", async () => {
    await seedDoneRun("alpha", "u1", [
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    ]);
    await seedDoneRun("beta", "u1", [
      { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    ]);
    // a running (not done) run must not count
    await Run.create({ ownerId: "u1", crewName: "alpha", task: "t", status: "running", mode: "live" });

    const r = await request(app).get("/api/runs/stats").set("Authorization", AUTH);
    expect(r.status).toBe(200);
    expect(r.body.runCount).toBe(2);
    expect(r.body.totals).toEqual({ promptTokens: 130, completionTokens: 65, totalTokens: 195 });

    const alpha = r.body.byCrew.find((c) => c.crewName === "alpha");
    const beta = r.body.byCrew.find((c) => c.crewName === "beta");
    expect(alpha).toEqual({ crewName: "alpha", promptTokens: 30, completionTokens: 15, totalTokens: 45, steps: 2 });
    expect(beta).toEqual({ crewName: "beta", promptTokens: 100, completionTokens: 50, totalTokens: 150, steps: 1 });
  });

  test("steps without usage data contribute zero, not an error", async () => {
    await Run.create({
      ownerId: "u1", crewName: "gamma", task: "t", status: "done", mode: "live",
      result: { output: "out", steps: [{ agent: "a", output: "o", raw: "", meta: {} }] },
    });
    const r = await request(app).get("/api/runs/stats").set("Authorization", AUTH);
    expect(r.status).toBe(200);
    expect(r.body.byCrew[0]).toEqual({ crewName: "gamma", promptTokens: 0, completionTokens: 0, totalTokens: 0, steps: 1 });
  });

  test("only counts the requesting user's own runs plus the public demo namespace", async () => {
    await seedDoneRun("mine", "u1", [{ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }]);
    await seedDoneRun("theirs", "u2", [{ prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }]);

    const r = await request(app).get("/api/runs/stats").set("Authorization", AUTH);
    expect(r.body.byCrew.map((c) => c.crewName)).toEqual(["mine"]);
  });

  test("anonymous request sees only the public demo namespace", async () => {
    await seedDoneRun("demo", null, [{ prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }]);
    await seedDoneRun("private", "u1", [{ prompt_tokens: 500, completion_tokens: 500, total_tokens: 1000 }]);

    const r = await request(app).get("/api/runs/stats");
    expect(r.status).toBe(200);
    expect(r.body.byCrew.map((c) => c.crewName)).toEqual(["demo"]);
  });
});

describe("runs (BYOK llmOverrides, per-agent map)", () => {
  const ORIGINAL_LIVE_RUNS_ENABLED = process.env.LIVE_RUNS_ENABLED;
  afterEach(() => {
    if (ORIGINAL_LIVE_RUNS_ENABLED === undefined) delete process.env.LIVE_RUNS_ENABLED;
    else process.env.LIVE_RUNS_ENABLED = ORIGINAL_LIVE_RUNS_ENABLED;
  });

  test("live run still 403s with LIVE_RUNS_ENABLED=false and no llmOverrides", async () => {
    process.env.LIVE_RUNS_ENABLED = "false";
    const crew = await seedCrew();
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t" });
    expect(r.status).toBe(403);
  });

  test("a fully-covered llmOverrides map bypasses LIVE_RUNS_ENABLED=false and is never persisted", async () => {
    process.env.LIVE_RUNS_ENABLED = "false";
    const crew = await seedCrew();
    const llmOverrides = { researcher: { backend: "openai", model: "gpt-4o-mini", apiKey: "sk-visitor-key" } };
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t", llmOverrides });
    expect(r.status).toBe(201);
    expect(calls.run.llmOverrides).toEqual(llmOverrides);

    const stored = await Run.findById(r.body.runId).lean();
    expect(stored.llmOverrides).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("sk-visitor-key");
  });

  test("partial llmOverrides coverage is rejected with 400 and the sidecar is never called", async () => {
    const crew = await seedCrewTwoAgents();
    const llmOverrides = { researcher: { backend: "openai", apiKey: "sk-r" } }; // missing "writer"
    const r = await request(app).post("/api/runs").set("Authorization", AUTH).send({ crewId: crew.id, task: "t", llmOverrides });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/missing a valid entry for agent "writer"/);
    expect(calls.run).toBeUndefined();
  });

  test("llmOverrides with an unknown backend value is rejected with 400", async () => {
    const crew = await seedCrew();
    const r = await request(app).post("/api/runs").set("Authorization", AUTH)
      .send({ crewId: crew.id, task: "t", llmOverrides: { researcher: { backend: "not-a-backend", apiKey: "x" } } });
    expect(r.status).toBe(400);
  });

  test("llmOverrides with an apiKey over the length cap is rejected with 400", async () => {
    const crew = await seedCrew();
    const r = await request(app).post("/api/runs").set("Authorization", AUTH)
      .send({ crewId: crew.id, task: "t", llmOverrides: { researcher: { backend: "openai", apiKey: "x".repeat(301) } } });
    expect(r.status).toBe(400);
  });
});
