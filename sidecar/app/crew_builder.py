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

from .schemas import AgentProfileIn, CrewIn


def _to_profile(p: AgentProfileIn) -> AgentProfile:
    return AgentProfile(
        name=p.name,
        role=p.role,
        goal=p.goal,
        backend=p.backend,
        model=p.model,
        temperature=p.temperature,
        max_tokens=p.max_tokens,
        system_prompt=p.system_prompt,
        vaults=list(p.vaults),
        tools=list(p.tools),
    )


def build_crew(crew_in: CrewIn) -> Crew:
    agents = [build_agent(_to_profile(p)) for p in crew_in.agents]
    supervisor = build_agent(_to_profile(crew_in.supervisor)) if crew_in.supervisor else None
    return Crew(
        crew_in.name,
        agents,
        topology=crew_in.topology,
        supervisor=supervisor,
        max_rounds=crew_in.max_rounds,
    )
