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

function fakeSidecar() {
  const s = express();
  s.use(express.json());
  s.post("/run", (req, res) => {
    calls.run = req.body;
    res.json({ run_id: "sc-1" });
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

beforeEach(() => { calls = {}; });
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
