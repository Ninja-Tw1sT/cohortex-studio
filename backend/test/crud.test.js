const request = require("supertest");
const createApp = require("../src/app");
const { setup, teardown, clear } = require("./helpers");

const app = createApp();
const AUTH = "Bearer test:u1";
const OTHER_AUTH = "Bearer test:u2";

beforeAll(setup);
afterAll(teardown);
afterEach(clear);

describe("agents CRUD", () => {
  test("create returns 201 with id, then lists for its owner", async () => {
    const r = await request(app)
      .post("/api/agents")
      .set("Authorization", AUTH)
      .send({ name: "researcher", role: "Research Analyst", goal: "list facts", backend: "ollama" });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe("researcher");
    expect(r.body.id).toBeDefined();
    expect(r.body._id).toBeUndefined();

    const list = await request(app).get("/api/agents").set("Authorization", AUTH);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // Public/anonymous browsing sees the demo namespace only, not this private agent.
    const anon = await request(app).get("/api/agents");
    expect(anon.body).toHaveLength(0);
  });

  test("create without sign-in is rejected with 401", async () => {
    const r = await request(app).post("/api/agents").send({ name: "researcher" });
    expect(r.status).toBe(401);
  });

  test("rejects an invalid backend enum with 400", async () => {
    const r = await request(app)
      .post("/api/agents")
      .set("Authorization", AUTH)
      .send({ name: "x", backend: "not-a-backend" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeDefined();
  });

  test("rejects a missing name with 400", async () => {
    const r = await request(app).post("/api/agents").set("Authorization", AUTH).send({ role: "x" });
    expect(r.status).toBe(400);
  });

  test("duplicate (owner,name) returns 409", async () => {
    await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "dup" });
    const r = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "dup" });
    expect(r.status).toBe(409);
  });

  test("update then delete round-trips", async () => {
    const created = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "a", temperature: 0.1 });
    const { id } = created.body;

    const updated = await request(app).put(`/api/agents/${id}`).set("Authorization", AUTH).send({ temperature: 0.9 });
    expect(updated.body.temperature).toBe(0.9);

    const deleted = await request(app).delete(`/api/agents/${id}`).set("Authorization", AUTH);
    expect(deleted.body.ok).toBe(true);

    const gone = await request(app).get(`/api/agents/${id}`).set("Authorization", AUTH);
    expect(gone.status).toBe(404);
  });

  test("another signed-in user can't edit or delete someone else's agent", async () => {
    const created = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "mine" });
    const { id } = created.body;

    const updated = await request(app).put(`/api/agents/${id}`).set("Authorization", OTHER_AUTH).send({ temperature: 0.9 });
    expect(updated.status).toBe(404);

    const deleted = await request(app).delete(`/api/agents/${id}`).set("Authorization", OTHER_AUTH);
    expect(deleted.status).toBe(404);
  });
});

describe("crews CRUD", () => {
  test("create with topology + agent list", async () => {
    const r = await request(app)
      .post("/api/crews")
      .set("Authorization", AUTH)
      .send({ name: "research_team", topology: "sequential", agentNames: ["researcher", "writer", "editor"] });
    expect(r.status).toBe(201);
    expect(r.body.topology).toBe("sequential");
    expect(r.body.agentNames).toEqual(["researcher", "writer", "editor"]);
  });

  test("rejects an invalid topology with 400", async () => {
    const r = await request(app).post("/api/crews").set("Authorization", AUTH).send({ name: "x", topology: "mesh" });
    expect(r.status).toBe(400);
  });

  test("create without sign-in is rejected with 401", async () => {
    const r = await request(app).post("/api/crews").send({ name: "x" });
    expect(r.status).toBe(401);
  });
});

describe("health", () => {
  test("ping and health respond", async () => {
    expect((await request(app).get("/api/ping")).body.ok).toBe(true);
    expect((await request(app).get("/api/health")).body.mongo).toBe(true);
  });
});
