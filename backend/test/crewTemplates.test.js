const request = require("supertest");
const createApp = require("../src/app");
const { setup, teardown, clear } = require("./helpers");

const app = createApp();
const AUTH = "Bearer test:u1";
const OTHER_AUTH = "Bearer test:u2";

beforeAll(setup);
afterAll(teardown);
afterEach(clear);

const validBody = (overrides = {}) => ({
  name: "software_dev_crew",
  description: "Architect, engineer, reviewer.",
  topology: "sequential",
  agents: [
    { name: "architect", role: "Software Architect", goal: "plan the feature", tools: [] },
    { name: "engineer", role: "Software Engineer", goal: "implement it", tools: ["calculator"] },
  ],
  ...overrides,
});

describe("crew templates CRUD", () => {
  test("create returns 201 with id, then lists for its owner", async () => {
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    expect(r.status).toBe(201);
    expect(r.body.name).toBe("software_dev_crew");
    expect(r.body.agents).toHaveLength(2);
    expect(r.body.id).toBeDefined();
    expect(r.body._id).toBeUndefined();

    const list = await request(app).get("/api/crew-templates").set("Authorization", AUTH);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // Public/anonymous browsing sees the demo namespace only, not this private template.
    const anon = await request(app).get("/api/crew-templates");
    expect(anon.body).toHaveLength(0);
  });

  test("create without sign-in is rejected with 401", async () => {
    const r = await request(app).post("/api/crew-templates").send(validBody());
    expect(r.status).toBe(401);
  });

  test("rejects a template with no agents", async () => {
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody({ agents: [] }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one agent/);
  });

  test("rejects duplicate agent names within one template", async () => {
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(
      validBody({ agents: [{ name: "a", role: "", goal: "", tools: [] }, { name: "a", role: "", goal: "", tools: [] }] })
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unique/);
  });

  test("rejects an agent with no name", async () => {
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(
      validBody({ agents: [{ name: "", role: "x", goal: "y", tools: [] }] })
    );
    expect(r.status).toBe(400);
  });

  test("rejects an invalid topology", async () => {
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody({ topology: "mesh" }));
    expect(r.status).toBe(400);
  });

  test("duplicate (owner,name) returns 409", async () => {
    await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    const r = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    expect(r.status).toBe(409);
  });

  test("both owners can create a template with the same name independently", async () => {
    const mine = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    const theirs = await request(app).post("/api/crew-templates").set("Authorization", OTHER_AUTH).send(validBody());
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
  });

  test("update then delete round-trips", async () => {
    const created = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    const { id } = created.body;

    const updated = await request(app).put(`/api/crew-templates/${id}`).set("Authorization", AUTH)
      .send({ description: "updated description" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("updated description");
    expect(updated.body.agents).toHaveLength(2); // untouched fields survive a partial update

    const deleted = await request(app).delete(`/api/crew-templates/${id}`).set("Authorization", AUTH);
    expect(deleted.body.ok).toBe(true);

    const gone = await request(app).get(`/api/crew-templates/${id}`).set("Authorization", AUTH);
    expect(gone.status).toBe(404);
  });

  test("another signed-in user can't edit or delete someone else's template", async () => {
    const created = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    const { id } = created.body;

    const updated = await request(app).put(`/api/crew-templates/${id}`).set("Authorization", OTHER_AUTH)
      .send({ description: "hijacked" });
    expect(updated.status).toBe(404);

    const deleted = await request(app).delete(`/api/crew-templates/${id}`).set("Authorization", OTHER_AUTH);
    expect(deleted.status).toBe(404);
  });

  test("an update that would leave the template invalid is rejected, original unchanged", async () => {
    const created = await request(app).post("/api/crew-templates").set("Authorization", AUTH).send(validBody());
    const { id } = created.body;

    const r = await request(app).put(`/api/crew-templates/${id}`).set("Authorization", AUTH).send({ agents: [] });
    expect(r.status).toBe(400);

    const stillThere = await request(app).get(`/api/crew-templates/${id}`).set("Authorization", AUTH);
    expect(stillThere.body.agents).toHaveLength(2);
  });
});
