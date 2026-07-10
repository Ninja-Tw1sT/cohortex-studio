"""
Builds a real cohortex.orchestrator.Crew directly from the JSON payload Express sends —
bypassing cohortex.runtime.load_crew's YAML read entirely (MongoDB is the source of truth
in Cohortex Studio, not YAML files). Every AgentProfile field maps 1:1 to the dataclass;
backend/vault/tool wiring reuses cohortex.runtime.build_agent unchanged.
"""
from __future__ import annotations

from cohortex.orchestrator import Crew
from cohortex.profiles import AgentProfile
from cohortex.runtime import build_agent

from .schemas import AgentProfileIn, CrewIn, LlmOverrideIn, MemoryIn


def _to_profile(p: AgentProfileIn, override: LlmOverrideIn | None = None,
                memory_context: str = "") -> AgentProfile:
    system_prompt = p.system_prompt
    if memory_context:
        system_prompt = f"{memory_context}\n\n{system_prompt}" if system_prompt else memory_context
    return AgentProfile(
        name=p.name,
        role=p.role,
        goal=p.goal,
        backend=override.backend if override else p.backend,
        model=(override.model if override and override.model else p.model),
        temperature=p.temperature,
        max_tokens=p.max_tokens,
        system_prompt=system_prompt,
        vaults=list(p.vaults),
        tools=list(p.tools),
        api_key=override.api_key if override else None,
        base_url=override.base_url if override else None,
    )


def _format_memories(memories: list[MemoryIn]) -> str:
    lines = ["## Recent run history for this crew"]
    for m in memories:
        lines.append(f"- Task: {m.task[:100]} | Result: {m.summary[:200]}")
    return "\n".join(lines)


def build_crew(crew_in: CrewIn, llm_overrides: dict[str, LlmOverrideIn] | None = None,
               memories: list[MemoryIn] | None = None) -> Crew:
    overrides = llm_overrides or {}
    memory_context = _format_memories(memories) if memories else ""
    agents = [build_agent(_to_profile(p, overrides.get(p.name), memory_context))
              for p in crew_in.agents]
    supervisor = (
        build_agent(_to_profile(crew_in.supervisor, overrides.get(crew_in.supervisor.name), memory_context))
        if crew_in.supervisor else None
    )
    return Crew(
        crew_in.name,
        agents,
        topology=crew_in.topology,
        supervisor=supervisor,
        max_rounds=crew_in.max_rounds,
        max_handoff_chars=crew_in.max_handoff_chars,
    )
