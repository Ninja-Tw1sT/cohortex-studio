"""
In-memory run registry: builds a crew, wraps each agent's `.run` to emit a "step" event
as it completes, executes the crew in a background thread pool, and exposes polling
access to accumulated events/status.

Scoped to a single process — does not survive multi-instance/horizontal scaling. That's
an explicit, documented scope limit: fine for a single-instance portfolio deployment,
not intended to be a durable job queue.
"""
from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .crew_builder import build_crew
from .schemas import AgentResultOut, CrewIn, CrewResultOut, LlmOverrideIn

_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cohortex-run")


@dataclass(eq=False)
class RunState:
    status: str = "running"  # running | done | error
    events: list[dict] = field(default_factory=list)
    result: CrewResultOut | None = None
    error: str | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add_event(self, event: dict) -> None:
        with self._lock:
            event = {"seq": len(self.events), **event}
            self.events.append(event)


_REGISTRY: dict[str, RunState] = {}
_REGISTRY_LOCK = threading.Lock()


def _wrap_agent_for_events(agent, state: RunState) -> None:
    """Monkeypatch this one Agent instance's bound `.run` to also emit a step event.
    Does not touch the vendored cohortex package — the wrap is local to this instance."""
    original_run = agent.run

    def wrapped(*args, **kwargs):
        result = original_run(*args, **kwargs)
        state.add_event({
            "type": "step", "agent": result.agent,
            "output": result.output, "meta": result.meta,
        })
        return result

    agent.run = wrapped


def _to_result_out(result) -> CrewResultOut:
    return CrewResultOut(
        crew=result.crew,
        output=result.output,
        steps=[
            AgentResultOut(agent=s.agent, output=s.output, raw=s.raw, meta=s.meta)
            for s in result.steps
        ],
    )


def _execute(run_id: str, crew_in: CrewIn, task: str,
              llm_overrides: dict[str, LlmOverrideIn] | None = None) -> None:
    state = _REGISTRY[run_id]
    try:
        crew = build_crew(crew_in, llm_overrides)
        for a in crew.agents:
            _wrap_agent_for_events(a, state)
        if crew.supervisor:
            _wrap_agent_for_events(crew.supervisor, state)

        result = crew.run(task)
        out = _to_result_out(result)
        state.result = out
        state.status = "done"
        state.add_event({"type": "done", "output": out.output})
    except Exception as e:  # noqa: BLE001
        state.error = str(e)
        state.status = "error"
        state.add_event({"type": "error", "message": str(e)})


def start_run(crew_in: CrewIn, task: str,
               llm_overrides: dict[str, LlmOverrideIn] | None = None) -> str:
    run_id = uuid.uuid4().hex
    with _REGISTRY_LOCK:
        _REGISTRY[run_id] = RunState()
    _EXECUTOR.submit(_execute, run_id, crew_in, task, llm_overrides)
    return run_id


def get_run(run_id: str) -> RunState | None:
    return _REGISTRY.get(run_id)


def get_events(run_id: str, since: int = 0) -> tuple[list[dict], str] | None:
    state = _REGISTRY.get(run_id)
    if state is None:
        return None
    return [e for e in state.events if e["seq"] >= since], state.status
