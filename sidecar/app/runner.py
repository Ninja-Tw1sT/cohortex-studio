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
from .schemas import AgentResultOut, CrewIn, CrewResultOut, LlmOverrideIn, MemoryIn

_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cohortex-run")


class RunCancelled(Exception):
    """Raised inside the run's worker thread to unwind out of Crew.run() when a
    user requests cancellation. Caught only in _execute — never meant to
    escape it."""


@dataclass(eq=False)
class RunState:
    status: str = "running"  # running | done | error | cancelled
    events: list[dict] = field(default_factory=list)
    result: CrewResultOut | None = None
    error: str | None = None
    cancel_requested: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add_event(self, event: dict) -> None:
        with self._lock:
            event = {"seq": len(self.events), **event}
            self.events.append(event)


_REGISTRY: dict[str, RunState] = {}
_REGISTRY_LOCK = threading.Lock()


def _wrap_agent_for_events(agent, state: RunState) -> None:
    """Monkeypatch this one Agent instance's bound `.run` to stream under the
    hood — Agent.run_stream() emits "delta" events as each chunk arrives, and
    once it's done this still returns a complete AgentResult synchronously, so
    Crew's orchestration (which calls .run(), and needs the full text to make
    sequential-handoff/supervisor-JSON-parsing decisions) needs zero changes to
    know anything changed. A final "step" event still carries the complete
    output/meta, same as before streaming existed. Does not touch the vendored
    cohortex package — the wrap is local to this instance.

    Also checks state.cancel_requested before starting a turn and again after
    every streamed chunk, so a cancel takes effect mid-generation rather than
    waiting for the current agent's full turn (or the rest of the crew) to
    finish first."""
    def wrapped(*args, **kwargs):
        if state.cancel_requested:
            raise RunCancelled()
        result = None
        for event in agent.run_stream(*args, **kwargs):
            if state.cancel_requested:
                raise RunCancelled()
            if event["type"] == "delta":
                if event["text"]:
                    state.add_event({"type": "delta", "agent": agent.profile.name, "text": event["text"]})
            elif event["type"] == "done":
                result = event["result"]
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
              llm_overrides: dict[str, LlmOverrideIn] | None = None,
              memories: list[MemoryIn] | None = None) -> None:
    state = _REGISTRY[run_id]
    try:
        crew = build_crew(crew_in, llm_overrides, memories)
        for a in crew.agents:
            _wrap_agent_for_events(a, state)
        if crew.supervisor:
            _wrap_agent_for_events(crew.supervisor, state)

        result = crew.run(task)
        out = _to_result_out(result)
        state.result = out
        state.status = "done"
        state.add_event({"type": "done", "output": out.output})
    except RunCancelled:
        state.status = "cancelled"
        state.add_event({"type": "cancelled"})
    except Exception as e:  # noqa: BLE001
        state.error = str(e)
        state.status = "error"
        state.add_event({"type": "error", "message": str(e)})


def start_run(crew_in: CrewIn, task: str,
               llm_overrides: dict[str, LlmOverrideIn] | None = None,
               memories: list[MemoryIn] | None = None) -> str:
    run_id = uuid.uuid4().hex
    with _REGISTRY_LOCK:
        _REGISTRY[run_id] = RunState()
    _EXECUTOR.submit(_execute, run_id, crew_in, task, llm_overrides, memories)
    return run_id


def get_run(run_id: str) -> RunState | None:
    return _REGISTRY.get(run_id)


def cancel_run(run_id: str) -> bool:
    """Returns False for an unknown run_id or one that's already finished —
    the caller should treat either as "nothing to cancel", not an error."""
    state = _REGISTRY.get(run_id)
    if state is None or state.status != "running":
        return False
    state.cancel_requested = True
    return True


def get_events(run_id: str, since: int = 0) -> tuple[list[dict], str] | None:
    state = _REGISTRY.get(run_id)
    if state is None:
        return None
    return [e for e in state.events if e["seq"] >= since], state.status
