"""
MCP (Model Context Protocol) surface for Cohortex Studio — mounted at /mcp in the main
FastAPI app via streamable-http transport. Any MCP-aware client (Claude Desktop, the MCP
Inspector, etc.) can list and run Cohortex crews without a bespoke integration.

Two tools:
  list_crews()                — crew names currently known to the sidecar.
  run_crew(crew, task)         — run a crew (same JSON shape as POST /run's `crew` field)
                                   to completion and return the final result.
One resource:
  crew://{name}                — a known crew's definition as JSON.

NOTE: `list_crews`/`crew://` currently read Cohortex's own bundled example configs
(research_team, assistant) since Cohortex Studio's own Mongo-backed crew store doesn't
exist yet (that lands in a later phase, wired to Express's /api/crews). Once it does,
repoint these two at Express's read endpoints instead — `run_crew` already takes a full
inline crew definition and doesn't depend on this.
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from .crew_builder import build_crew
from .schemas import CrewIn

# streamable_http_path="/" because this whole sub-app is already mounted at /mcp in
# main.py — without this it would double up to /mcp/mcp.
mcp = FastMCP("cohortex-studio", stateless_http=True, streamable_http_path="/")


def _bundled_crews() -> dict[str, dict]:
    from cohortex import config

    crews_dir = config.CONFIG_DIR / "crews"
    out: dict[str, dict] = {}
    if crews_dir.exists():
        for p in crews_dir.glob("*.yaml"):
            out[p.stem] = config.load_yaml(p)
    return out


@mcp.tool()
def list_crews() -> list[str]:
    """List the names of crews currently known to Cohortex Studio."""
    return sorted(_bundled_crews())


@mcp.resource("crew://{name}")
def get_crew(name: str) -> dict:
    """Return a crew's definition (topology, agents, supervisor) as JSON."""
    crews = _bundled_crews()
    if name not in crews:
        raise ValueError(f"unknown crew {name!r}. Available: {sorted(crews)}")
    return crews[name]


@mcp.tool()
def run_crew(crew: dict, task: str) -> dict:
    """Run a Cohortex crew to completion and return {crew, output, steps}.

    `crew` uses the same shape as POST /run's `crew` field: {name, topology, maxRounds,
    supervisor, agents: [{name, role, goal, backend, model, temperature, ...}, ...]}.
    """
    crew_in = CrewIn.model_validate(crew)
    result = build_crew(crew_in).run(task)
    return {
        "crew": result.crew,
        "output": result.output,
        "steps": [
            {"agent": s.agent, "output": s.output, "raw": s.raw, "meta": s.meta}
            for s in result.steps
        ],
    }
