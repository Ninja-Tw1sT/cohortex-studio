"""
Pydantic request/response models — field-for-field mirrors of Cohortex's dataclasses
(cohortex.profiles.AgentProfile, cohortex.orchestrator.CrewResult, cohortex.agent.AgentResult),
with camelCase aliases so the JSON boundary matches what Express/MongoDB use (Mongoose/JS
convention) while the Python side stays snake_case.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AgentProfileIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    role: str = ""
    goal: str = ""
    backend: str | None = None
    model: str | None = None
    temperature: float = 0.3
    max_tokens: int | None = Field(default=None, alias="maxTokens")
    system_prompt: str = Field(default="", alias="systemPrompt")
    vaults: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)


class CrewIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    topology: str = "sequential"  # "single" | "sequential" | "supervisor"
    max_rounds: int = Field(default=4, alias="maxRounds")
    supervisor: AgentProfileIn | None = None
    agents: list[AgentProfileIn] = Field(default_factory=list)


class LlmOverrideIn(BaseModel):
    """A visitor's own LLM config for one agent in the crew — never persisted,
    just relayed from Express into whichever backend build_crew constructs."""
    model_config = ConfigDict(populate_by_name=True)

    backend: str
    model: str | None = None
    api_key: str | None = Field(default=None, alias="apiKey")
    base_url: str | None = Field(default=None, alias="baseUrl")


class RunRequest(BaseModel):
    task: str
    crew: CrewIn
    # Keyed by agent name (including the supervisor's name, if any). Absent key
    # or absent RunRequest.llm_overrides entirely => that agent uses its stored
    # backend/model with no api_key/base_url override (env-var backends only).
    llm_overrides: dict[str, LlmOverrideIn] | None = Field(default=None, alias="llmOverrides")


class RunAcceptedResponse(BaseModel):
    run_id: str


class AgentResultOut(BaseModel):
    agent: str
    output: str
    raw: str = ""
    meta: dict = Field(default_factory=dict)


class CrewResultOut(BaseModel):
    crew: str
    output: str
    steps: list[AgentResultOut] = Field(default_factory=list)


class RunEventOut(BaseModel):
    seq: int
    type: str  # "step" | "done" | "error"
    agent: str | None = None
    output: str | None = None
    meta: dict | None = None
    message: str | None = None


class RunEventsResponse(BaseModel):
    events: list[RunEventOut]
    status: str  # "running" | "done" | "error"


class RunStatusResponse(BaseModel):
    status: str
    result: CrewResultOut | None = None
    error: str | None = None
