"""
Cohortex Studio sidecar — thin FastAPI wrapper around the Cohortex agent framework.

    uvicorn app.main:app --reload --port 8000

Endpoints follow the JSON in/out, {"error": "..."} on failure, CORS-enabled style already
established in the sibling ai-workflow project's api/server.py.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .crew_builder import build_crew
from .schemas import CrewResultOut, AgentResultOut, RunRequest

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("sidecar")

app = FastAPI(title="Cohortex Studio Sidecar", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened to the real frontend origin at deploy time
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
def ping() -> dict:
    return {"ok": True}


@app.get("/health")
def health() -> dict:
    from cohortex import config
    import httpx

    try:
        httpx.get(f"{config.OLLAMA_BASE_URL}/api/tags", timeout=2).raise_for_status()
        ollama_reachable = True
    except Exception:  # noqa: BLE001
        ollama_reachable = False
    return {"ok": True, "ollama_reachable": ollama_reachable}


@app.get("/backends")
def backends() -> dict:
    from cohortex.providers import available_backends

    return {"backends": available_backends()}


@app.post("/run", response_model=CrewResultOut)
def run(req: RunRequest) -> CrewResultOut:
    """Synchronous v1: builds the crew, runs it to completion, returns the full result.

    Phase 2 adds POST /run returning {run_id} immediately + background execution +
    GET /runs/{id}/events for streaming — this endpoint's request/response shapes for
    the crew definition and the final result stay the same, only the timing changes.
    """
    try:
        crew = build_crew(req.crew)
    except Exception as e:  # noqa: BLE001
        log.warning("invalid crew definition: %s", e)
        raise HTTPException(status_code=400, detail=f"invalid crew definition: {e}") from e

    try:
        result = crew.run(req.task)
    except Exception as e:  # noqa: BLE001
        log.exception("crew run failed")
        raise HTTPException(status_code=500, detail=f"crew run failed: {e}") from e

    return CrewResultOut(
        crew=result.crew,
        output=result.output,
        steps=[
            AgentResultOut(agent=s.agent, output=s.output, raw=s.raw, meta=s.meta)
            for s in result.steps
        ],
    )
