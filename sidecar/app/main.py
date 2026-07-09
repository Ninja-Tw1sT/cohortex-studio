"""
Cohortex Studio sidecar — thin FastAPI wrapper around the Cohortex agent framework.

    uvicorn app.main:app --reload --port 8000

Endpoints follow the JSON in/out, {"error": "..."} on failure, CORS-enabled style already
established in the sibling ai-workflow project's api/server.py.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import runner
from .crew_builder import build_crew
from .mcp_server import mcp
from .schemas import RunAcceptedResponse, RunEventsResponse, RunRequest, RunStatusResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("sidecar")

# Optional shared-secret check. The Express backend always sends X-Sidecar-Key
# (services/sidecarClient.js); this only enforces it if SIDECAR_SHARED_KEY is
# set, so local dev with no key configured keeps working unauthenticated.
_SHARED_KEY = os.getenv("SIDECAR_SHARED_KEY")


def require_shared_key(x_sidecar_key: str | None = Header(default=None)) -> None:
    if _SHARED_KEY and x_sidecar_key != _SHARED_KEY:
        raise HTTPException(status_code=401, detail="missing or invalid X-Sidecar-Key")

# The MCP sub-app must be created before its session_manager exists, so build it first.
_mcp_app = mcp.streamable_http_app()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # mcp.session_manager.run() takes no args; FastAPI's lifespan protocol always
    # passes the app in, so this thin wrapper adapts between the two conventions.
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="Cohortex Studio Sidecar", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tightened to the real frontend origin at deploy time
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/mcp", _mcp_app)


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
def backends(_auth: None = Depends(require_shared_key)) -> dict:
    from cohortex.providers import available_backends

    return {"backends": available_backends()}


@app.post("/run", response_model=RunAcceptedResponse)
def run(req: RunRequest, _auth: None = Depends(require_shared_key)) -> RunAcceptedResponse:
    """Validate the crew definition, then start it running in a background thread and
    return a run_id immediately. Poll /runs/{run_id} or /runs/{run_id}/events for progress."""
    try:
        build_crew(req.crew, req.llm_override)  # fail fast on a bad definition before starting a thread
    except Exception as e:  # noqa: BLE001
        log.warning("invalid crew definition: %s", e)
        raise HTTPException(status_code=400, detail=f"invalid crew definition: {e}") from e

    run_id = runner.start_run(req.crew, req.task, req.llm_override)
    return RunAcceptedResponse(run_id=run_id)


@app.get("/runs/{run_id}", response_model=RunStatusResponse)
def get_run_status(run_id: str, _auth: None = Depends(require_shared_key)) -> RunStatusResponse:
    state = runner.get_run(run_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"unknown run_id {run_id!r}")
    return RunStatusResponse(status=state.status, result=state.result, error=state.error)


@app.get("/runs/{run_id}/events", response_model=RunEventsResponse)
def get_run_events(run_id: str, since: int = 0, _auth: None = Depends(require_shared_key)) -> RunEventsResponse:
    found = runner.get_events(run_id, since=since)
    if found is None:
        raise HTTPException(status_code=404, detail=f"unknown run_id {run_id!r}")
    events, status = found
    return RunEventsResponse(events=events, status=status)
