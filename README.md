<p align="center">
  <img src="assets/banner.svg" alt="Cohortex Studio" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/angular-19-00f5ff?style=for-the-badge&logo=angular&logoColor=0b0714" alt="Angular 19">
  <img src="https://img.shields.io/badge/express-mongodb-ff00cc?style=for-the-badge&logo=express&logoColor=0b0714" alt="Express + MongoDB">
  <img src="https://img.shields.io/badge/sidecar-fastapi-39ff14?style=for-the-badge&logo=fastapi&logoColor=0b0714" alt="FastAPI sidecar">
  <img src="https://img.shields.io/github/actions/workflow/status/Ninja-Tw1sT/cohortex-studio/ci.yml?style=for-the-badge&label=CI&color=39ff14" alt="CI">
  <img src="https://img.shields.io/badge/license-MIT-8a5cff?style=for-the-badge" alt="MIT">
  <img src="https://img.shields.io/badge/local--first-Ollama-00f5ff?style=for-the-badge" alt="local-first">
</p>

> `// build, run, and watch multi-agent crews from a browser`

A full-stack control panel for [Cohortex](https://github.com/Ninja-Tw1sT/cohortex), the
modular multi-agent framework. Build agent profiles and crews in the UI, launch a run, and
watch each agent's step stream in live over SSE — or replay a pre-recorded run with zero
LLM cost. Three services, one product: **Angular** UI, **Express/MongoDB** API, and a
**FastAPI sidecar** that actually drives the agents.

## Why
Cohortex itself is YAML-and-CLI — great for scripting, opaque for demoing. Cohortex Studio
puts a real UI in front of it: CRUD screens for agents and crews backed by MongoDB, a run
launcher that streams live agent output token-by-token, and a replay mode that lets anyone
click through a recorded multi-agent run without an LLM key or a running Ollama instance.

## Architecture

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#12071f','primaryTextColor':'#00f5ff','primaryBorderColor':'#ff00cc','lineColor':'#8a5cff','fontFamily':'monospace','clusterBkg':'#0b0714','clusterBorder':'#00f5ff','edgeLabelBackground':'#0b0714','secondaryColor':'#1a0a2e'}}}%%
flowchart LR
    subgraph FE["frontend (Angular 19)"]
        UI["crew builder · agent profiles<br/>live run view"]
        SSE["RunStreamService<br/>EventSource"]
    end
    subgraph BE["backend (Express)"]
        API["REST API<br/>agents · crews · runs"]
        RELAY["SSE relay"]
        DB[("MongoDB<br/>agents · crews · runs")]
    end
    subgraph SC["sidecar (FastAPI)"]
        RUN["run registry<br/>background threads"]
        MCP["MCP server"]
    end
    COHORTEX["Cohortex<br/>agent · crew · backend"]

    UI -->|REST| API
    SSE -.->|SSE| RELAY
    API --> DB
    API -->|X-Sidecar-Key| RUN
    RELAY -.->|poll /events| RUN
    RUN --> COHORTEX
    MCP --> COHORTEX
```

- **Frontend** — standalone Angular 19 components, no NgModules. `RunStreamService` wraps
  `EventSource` in an RxJS `Observable`, replaying `delta`/`step`/`done`/`failed` SSE events
  into `NgZone` for change detection. `delta` events render token-by-token as the current
  agent's turn streams in; a `step` event finalizes it with usage/meta once the turn completes.
- **Backend** — Express CRUD for `Agent`/`Crew`/`Run` documents in MongoDB, plus a run
  orchestration layer that either replays a stored run's steps from Mongo (**replay mode**,
  no sidecar call) or starts a real run on the sidecar and relays its polled events as SSE
  (**live mode**).
- **Sidecar** — a thin FastAPI wrapper around Cohortex. Builds a `Crew` from the JSON the
  backend sends, runs it in a background thread, and exposes `/runs/{id}` and
  `/runs/{id}/events` for polling. Also mounts an MCP server so the same crews are reachable
  from any MCP client.

## API surface
```
GET/POST/PUT/DELETE  /api/agents[/:id]
GET/POST/PUT/DELETE  /api/crews[/:id]
GET/POST/PUT/DELETE  /api/tools[/:id]     # Tool Shed catalog
POST                 /api/tools/generate  { description, llm }  # AI-proposed http tool, not saved
POST                 /api/runs            { crewId, task, mode: "live" | "replay" }
GET                  /api/runs
GET                  /api/runs/stats       # token usage aggregated across completed runs
GET                  /api/runs/:id
GET                  /api/runs/:id/stream # SSE: delta | step | done | cancelled | failed
POST                 /api/runs/:id/cancel # best-effort stop for a running live run
GET                  /api/health, /api/ping
```

## Quick start
Three services, three terminals. MongoDB and (for live mode) Ollama must already be running.

```bash
# 1. sidecar — wraps Cohortex, runs crews
cd sidecar
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. backend — REST API + SSE relay
cd backend
npm install
cp .env.example .env       # defaults work for local Mongo + local sidecar
npm run seed                # optional: demo agents/crews + a replay-mode run
npm run dev

# 3. frontend — Angular UI
cd frontend
npm install
npm start                   # ng serve, http://localhost:4200
```

Open `http://localhost:4200`, pick the seeded `research_pipeline` crew, mode **replay**, and
run it to see the full step stream with no LLM calls. Switch to **live** (with Ollama running
and a model pulled) to watch a real crew execute.

## Bring your own key (BYOK)
The public demo at cohortex-studio.web.app runs with `LIVE_RUNS_ENABLED=false` — no LLM
keys on the server, zero ongoing cost. Visitors who want a live run add their own API
credentials in the **LLM Config** page (stored in browser localStorage only), assign one to
each agent in the crew, and the keys are sent per-request to the sidecar, used once, and
never stored in MongoDB or logged anywhere server-side.

## Tool Shed
Agents can call tools beyond Cohortex's two Python builtins (`calculator`, `word_count`) via
**http-kind** catalog entries — a fixed-host URL template (`{input}` allowed only in the
path/query, never the hostname), validated server-side and re-validated at run time
(`cohortex.tools.make_dynamic_tool`) against a private-IP/cloud-metadata blocklist. Three ways
to add one, no code changes required for any of them:
- **Templates** — one click loads a ready-made tool against a well-known, no-key public API
  (Wikipedia summaries, dictionary lookups, public holidays, jokes, cat facts) into the form.
- **Generate with AI** — describe the tool in plain language; your own saved LLM credential
  (BYOK — same per-request, never-persisted key handling as a live run) proposes a name,
  method, URL template, and headers, which you review and edit before saving.
- **Manual entry** — fill in the form yourself.
All three just pre-fill the same form — Save always goes through the same validation, so a
generated or templated proposal gets no more trust than one typed by hand.

## Live streaming
Agent output appears token-by-token, not all at once. The sidecar's per-run event log carries
`delta` events (one per streamed chunk) alongside the existing `step`/`done` events; the
backend's SSE relay forwards them unchanged, and the frontend appends each chunk to the
in-progress step until the agent's turn completes. This is purely additive at the Cohortex layer
— `Agent.run_stream()` is a new method, `Agent.run()` (and everything that calls it, including
`Crew`'s sequential/supervisor orchestration) is untouched — so the sidecar gets streaming by
wrapping `.run` to consume `.run_stream()` internally while still returning a complete result
synchronously, with zero changes to Cohortex's orchestration logic.

A running live run can be stopped early with **Stop ■** — a best-effort cancellation: the
sidecar sets a flag its worker thread checks before each agent's turn and again after every
streamed chunk, so it takes effect mid-generation rather than waiting for the whole crew (or
even the current agent's full turn) to finish. A call already in flight to the LLM provider
still has to return before the check fires, so cancellation isn't instant, but it's close.

## Token efficiency
Every LLM backend captures per-call token usage, which flows through the step events into the
live run view as per-step and total token counts. Sequential crews support `maxHandoffChars` to
truncate inter-agent context and bound token growth. The Anthropic backend uses prompt caching
(`cache_control: ephemeral`) so supervisor loops avoid re-tokenizing the same system prompt.
Completed runs are summarized and stored as "run memories" — the last 3 are injected as context
for future runs on the same crew, enabling cross-run learning without replaying full transcripts.

The **Usage** page turns that same per-run token data into a small dashboard — total tokens,
completed-run count, and a per-crew breakdown (`GET /api/runs/stats`, a MongoDB aggregation over
`Run.result.steps[].meta.usage`) — no new instrumentation, just adding up data every run already
captures instead of discarding it after display.

## Security
No secrets in code or config. Backend and sidecar each read their own gitignored `.env`
(`backend/.env.example`, `sidecar/.env.example`). The sidecar accepts an optional
`SIDECAR_SHARED_KEY` — when set, every sidecar request must carry a matching `X-Sidecar-Key`
header (the backend already sends this header unconditionally); leave it unset for local dev
where the sidecar isn't reachable from outside your machine. Cloud LLM provider keys
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`) are optional — Ollama
needs none.

## Convenience
Every catalog entry (agent, crew) supports **Export** (downloads a sanitized JSON file — no
`id`/`ownerId`/timestamps, safe to hand to someone else), **Import** (loads a JSON file into the
form for review before saving — never auto-saves), and **Clone** (pre-fills the form from an
existing entry with `_copy` appended to the name). All three just populate the same form Save
already validates, so nothing skips normal validation. Destructive actions (delete) require a
confirmation dialog.

## Testing
```bash
cd frontend && npm test     # Karma/Jasmine
cd backend  && npm test     # Jest + mongodb-memory-server
cd sidecar  && pytest       # FastAPI TestClient, fake Cohortex backend
```

## Roadmap
- [x] **Auth** — Firebase Auth + backend middleware, scoping data to signed-in users
- [x] **Deploy** — Firebase Hosting + Cloud Run + Atlas ($0/month free tier)
- [x] **BYOK** — per-agent visitor-supplied LLM credentials (never persisted)
- [x] **Token accounting** — per-step and total usage in the live run view
- [x] **Context truncation** — `maxHandoffChars` bounds inter-agent context in sequential crews
- [x] **Prompt caching** — Anthropic `cache_control` for supervisor loop efficiency
- [x] **Run memory** — cross-run learning via MongoDB-backed summaries
- [x] **CI** — GitHub Actions running all three test suites on push

## License
MIT © Ryan Seibert.
