const request = require("supertest");
const createApp = require("../src/app");
const { setup, teardown, clear } = require("./helpers");
const { PALETTE } = require("../src/util/palette");

const app = createApp();
const AUTH = "Bearer test:u1";
const OTHER_AUTH = "Bearer test:u2";

beforeAll(setup);
afterAll(teardown);
afterEach(clear);

describe("tools CRUD (Tool Shed)", () => {
  test("create returns 201 with id, then lists for its owner", async () => {
    const r = await request(app)
      .post("/api/tools")
      .set("Authorization", AUTH)
      .send({ name: "calculator", description: "does arithmetic" });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe("calculator");
    expect(r.body.id).toBeDefined();
    expect(r.body._id).toBeUndefined();

    const list = await request(app).get("/api/tools").set("Authorization", AUTH);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    // Public/anonymous browsing sees the demo namespace only, not this private catalog entry.
    const anon = await request(app).get("/api/tools");
    expect(anon.body).toHaveLength(0);
  });

  test("create without sign-in is rejected with 401", async () => {
    const r = await request(app).post("/api/tools").send({ name: "calculator" });
    expect(r.status).toBe(401);
  });

  test("rejects a name outside the builtin catalog with 400", async () => {
    const r = await request(app)
      .post("/api/tools")
      .set("Authorization", AUTH)
      .send({ name: "arbitrary_shell_exec" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeDefined();
  });

  test("duplicate (owner,name) returns 409", async () => {
    await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "word_count" });
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "word_count" });
    expect(r.status).toBe(409);
  });

  test("update then delete round-trips", async () => {
    const created = await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "calculator" });
    const { id } = created.body;

    const updated = await request(app).put(`/api/tools/${id}`).set("Authorization", AUTH).send({ description: "updated" });
    expect(updated.body.description).toBe("updated");

    const deleted = await request(app).delete(`/api/tools/${id}`).set("Authorization", AUTH);
    expect(deleted.body.ok).toBe(true);

    const gone = await request(app).get(`/api/tools/${id}`).set("Authorization", AUTH);
    expect(gone.status).toBe(404);
  });

  test("another signed-in user can't edit or delete someone else's catalog entry", async () => {
    const created = await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "calculator" });
    const { id } = created.body;

    const updated = await request(app).put(`/api/tools/${id}`).set("Authorization", OTHER_AUTH).send({ description: "hijacked" });
    expect(updated.status).toBe(404);

    const deleted = await request(app).delete(`/api/tools/${id}`).set("Authorization", OTHER_AUTH);
    expect(deleted.status).toBe(404);
  });

  test("both owners can catalog the same builtin independently", async () => {
    const mine = await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "calculator" });
    const theirs = await request(app).post("/api/tools").set("Authorization", OTHER_AUTH).send({ name: "calculator" });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
  });
});

describe("http-kind tools (Tool Shed dynamic tools)", () => {
  test("create an http tool, method defaults to GET", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "weather", kind: "http", urlTemplate: "https://api.example.com/weather?city={input}",
    });
    expect(r.status).toBe(201);
    expect(r.body.method).toBe("GET");
    expect(r.body.urlTemplate).toBe("https://api.example.com/weather?city={input}");
  });

  test("create an http tool with a POST method and headers", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "notify", kind: "http", method: "POST",
      urlTemplate: "https://api.example.com/notify",
      headers: { "X-Api-Key": "secret" },
    });
    expect(r.status).toBe(201);
    expect(r.body.method).toBe("POST");
    expect(r.body.headers).toEqual({ "X-Api-Key": "secret" });
  });

  test("rejects an http tool name that isn't a valid identifier", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "not a valid name!", kind: "http", urlTemplate: "https://api.example.com/x",
    });
    expect(r.status).toBe(400);
  });

  test("rejects an http tool name reserved for a builtin", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "calculator", kind: "http", urlTemplate: "https://api.example.com/x",
    });
    expect(r.status).toBe(400);
  });

  test("rejects a missing urlTemplate", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({ name: "lookup", kind: "http" });
    expect(r.status).toBe(400);
  });

  test("rejects a non-http(s) scheme", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "lookup", kind: "http", urlTemplate: "ftp://api.example.com/x",
    });
    expect(r.status).toBe(400);
  });

  test("rejects a url pointing at a private IP", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "lookup", kind: "http", urlTemplate: "http://192.168.1.5/x",
    });
    expect(r.status).toBe(400);
  });

  test("rejects a url pointing at the cloud metadata IP", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "lookup", kind: "http", urlTemplate: "http://169.254.169.254/latest/meta-data/",
    });
    expect(r.status).toBe(400);
  });

  test("rejects an input-controlled host", async () => {
    const r = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "lookup", kind: "http", urlTemplate: "https://{input}/",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/may not depend on \{input\}/);
  });

  test("editing description keeps the existing kind's validation in effect", async () => {
    const created = await request(app).post("/api/tools").set("Authorization", AUTH).send({
      name: "weather", kind: "http", urlTemplate: "https://api.example.com/weather?city={input}",
    });
    const updated = await request(app).put(`/api/tools/${created.body.id}`).set("Authorization", AUTH)
      .send({ description: "updated desc" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("updated desc");
    expect(updated.body.urlTemplate).toBe("https://api.example.com/weather?city={input}");
  });
});

describe("agent color assignment", () => {
  test("first agent gets the first palette color when none is supplied", async () => {
    const r = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "a1" });
    expect(r.body.color).toBe(PALETTE[0]);
  });

  test("colors cycle through the palette per owner as agents are created", async () => {
    const r1 = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "a1" });
    const r2 = await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "a2" });
    expect(r1.body.color).toBe(PALETTE[0]);
    expect(r2.body.color).toBe(PALETTE[1]);
  });

  test("an explicit color is honored instead of auto-assignment", async () => {
    const r = await request(app)
      .post("/api/agents")
      .set("Authorization", AUTH)
      .send({ name: "a1", color: "#123abc" });
    expect(r.body.color).toBe("#123abc");
  });

  test("color assignment is scoped per owner, not global", async () => {
    await request(app).post("/api/agents").set("Authorization", AUTH).send({ name: "a1" });
    const other = await request(app).post("/api/agents").set("Authorization", OTHER_AUTH).send({ name: "b1" });
    expect(other.body.color).toBe(PALETTE[0]);
  });

  test("rejects a malformed color with 400", async () => {
    const r = await request(app)
      .post("/api/agents")
      .set("Authorization", AUTH)
      .send({ name: "a1", color: "not-a-hex-color" });
    expect(r.status).toBe(400);
  });
});
