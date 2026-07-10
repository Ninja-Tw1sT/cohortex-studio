"""
Sidecar tests using fake LLM backends — no network, no Ollama, no cloud keys.

Registers test-only backends into cohortex's real provider registry (the same mechanism
cohortex.providers.register uses for ollama/openai/anthropic/gemini/grok), so the sidecar's
crew_builder/runner/main code path is exercised exactly as in production, just with a
scripted "model" standing in for the LLM.
"""
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from cohortex.providers import register
from app.main import app
from app import mcp_server

client = TestClient(app)


@register("test-const")
class ConstBackend:
    """Always returns the same string — mirrors cohortex/tests/test_framework.py's fake."""

    def __init__(self, model=None, **_):
        self.model = model or "const"

    def chat(self, messages, *, temperature=0.3, max_tokens=None, **opts):
        self.last_usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        return "hello from const backend"


@register("test-scripted")
class ScriptedBackend:
    """Returns canned responses in sequence (last repeats) — for the supervisor path."""

    _responses_by_role: dict[str, list[str]] = {}

    def __init__(self, model=None, **_):
        self.model = model or "scripted"
        self._i = 0

    def chat(self, messages, *, temperature=0.3, max_tokens=None, **opts):
        # crude role dispatch: use the system prompt to figure out which "agent" this is
        system = messages[0]["content"] if messages else ""
        key = "supervisor" if "Supervisor" in system else "default"
        responses = ScriptedBackend._responses_by_role.get(key, ["ok"])
        r = responses[min(self._i, len(responses) - 1)]
        self._i += 1
        return r


@register("test-multi")
class MultiCaptureBackend:
    """Captures the api_key/base_url it was constructed with and echoes the api_key
    in its response — lets a test tell which override actually reached which agent."""

    def __init__(self, model=None, api_key=None, base_url=None, **_):
        self.model = model
        self.api_key = api_key
        self.base_url = base_url

    def chat(self, messages, *, temperature=0.3, max_tokens=None, **opts):
        return f"response-from-{self.api_key or 'no-key'}"


def _agent(name, role="Agent", backend="test-const", **overrides):
    a = {"name": name, "role": role, "goal": "do the job", "backend": backend}
    a.update(overrides)
    return a


def _run_and_wait(body, timeout=5.0):
    """POST /run, then poll GET /runs/{id} until it's no longer "running"."""
    r = client.post("/run", json=body)
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status_resp = client.get(f"/runs/{run_id}")
        assert status_resp.status_code == 200
        data = status_resp.json()
        if data["status"] != "running":
            return run_id, data
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not finish within {timeout}s")


def test_ping_and_health_and_backends():
    assert client.get("/ping").json() == {"ok": True}
    health = client.get("/health").json()
    assert health["ok"] is True and "ollama_reachable" in health
    backends = client.get("/backends").json()["backends"]
    assert "ollama" in backends and "test-const" in backends


def test_run_single_topology():
    body = {
        "task": "say hi",
        "crew": {"name": "solo", "topology": "single", "agents": [_agent("solo")]},
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    assert data["result"]["crew"] == "solo"
    assert data["result"]["output"] == "hello from const backend"
    assert len(data["result"]["steps"]) == 1
    assert data["result"]["steps"][0]["agent"] == "solo"


def test_run_sequential_topology_order_and_handoff():
    body = {
        "task": "research something",
        "crew": {
            "name": "research_team",
            "topology": "sequential",
            "agents": [_agent("researcher"), _agent("writer"), _agent("editor")],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    assert [s["agent"] for s in data["result"]["steps"]] == ["researcher", "writer", "editor"]
    assert data["result"]["output"] == "hello from const backend"


def test_run_events_are_ordered_and_end_with_done():
    body = {
        "task": "research something",
        "crew": {
            "name": "research_team",
            "topology": "sequential",
            "agents": [_agent("researcher"), _agent("writer"), _agent("editor")],
        },
    }
    run_id, _ = _run_and_wait(body)
    events_resp = client.get(f"/runs/{run_id}/events")
    assert events_resp.status_code == 200
    payload = events_resp.json()
    assert payload["status"] == "done"
    seqs = [e["seq"] for e in payload["events"]]
    assert seqs == sorted(seqs)  # strictly non-decreasing / ordered
    step_agents = [e["agent"] for e in payload["events"] if e["type"] == "step"]
    assert step_agents == ["researcher", "writer", "editor"]
    assert payload["events"][-1]["type"] == "done"

    # since= filters out already-seen events
    tail = client.get(f"/runs/{run_id}/events", params={"since": len(payload["events"])}).json()
    assert tail["events"] == []


def test_run_supervisor_topology_delegates_then_finishes():
    ScriptedBackend._responses_by_role["supervisor"] = [
        '{"agent": "mathematician", "task": "2+2"}',
        '{"final": "the answer is 4"}',
    ]
    ScriptedBackend._responses_by_role["default"] = ["4"]

    body = {
        "task": "what is 2 + 2",
        "crew": {
            "name": "assistant",
            "topology": "supervisor",
            "supervisor": _agent("supervisor", role="Supervisor", backend="test-scripted"),
            "agents": [_agent("mathematician", backend="test-scripted")],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    assert data["result"]["output"] == "the answer is 4"
    assert any(s["agent"] == "mathematician" for s in data["result"]["steps"])


def test_run_events_include_usage_in_meta():
    body = {
        "task": "say hi",
        "crew": {"name": "solo", "topology": "single", "agents": [_agent("solo")]},
    }
    run_id, data = _run_and_wait(body)
    usage = data["result"]["steps"][0]["meta"].get("usage")
    assert usage is not None
    assert usage["prompt_tokens"] == 10
    assert usage["completion_tokens"] == 5
    assert usage["total_tokens"] == 15


def test_run_rejects_unknown_backend_with_400():
    body = {
        "task": "x",
        "crew": {
            "name": "bad",
            "topology": "single",
            "agents": [_agent("a", backend="not-a-real-backend")],
        },
    }
    r = client.post("/run", json=body)
    assert r.status_code == 400


def test_run_sequential_with_max_handoff_chars():
    body = {
        "task": "x",
        "crew": {
            "name": "truncated_team",
            "topology": "sequential",
            "maxHandoffChars": 200,
            "agents": [_agent("researcher"), _agent("writer")],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"


def test_run_with_per_agent_llm_overrides_uses_correct_override_per_agent():
    body = {
        "task": "x",
        "crew": {
            "name": "byok_team",
            "topology": "sequential",
            "agents": [_agent("researcher", backend="test-multi"), _agent("writer", backend="test-multi")],
        },
        "llmOverrides": {
            "researcher": {"backend": "test-multi", "apiKey": "key-r"},
            "writer": {"backend": "test-multi", "apiKey": "key-w"},
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    steps = {s["agent"]: s["output"] for s in data["result"]["steps"]}
    assert steps["researcher"] == "response-from-key-r"
    assert steps["writer"] == "response-from-key-w"


def test_run_missing_override_for_one_agent_falls_back_to_agents_own_backend():
    # llm_overrides not covering every agent is the sidecar's own, deliberately
    # permissive behavior — full-coverage enforcement is Express's job (the
    # sidecar is also reachable via MCP/local dev with no Express gate in front
    # of it), so an uncovered agent just uses its own stored backend.
    body = {
        "task": "x",
        "crew": {
            "name": "partial_byok_team",
            "topology": "sequential",
            "agents": [_agent("researcher", backend="test-multi"), _agent("writer", backend="test-const")],
        },
        "llmOverrides": {
            "researcher": {"backend": "test-multi", "apiKey": "key-r"},
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    steps = {s["agent"]: s["output"] for s in data["result"]["steps"]}
    assert steps["researcher"] == "response-from-key-r"
    assert steps["writer"] == "hello from const backend"


def test_run_rejects_malformed_llm_overrides_shape():
    body = {
        "task": "x",
        "crew": {"name": "solo", "topology": "single", "agents": [_agent("solo")]},
        "llmOverrides": ["not", "a", "map"],
    }
    r = client.post("/run", json=body)
    assert r.status_code == 422  # pydantic body validation, never reaches the handler


def test_run_with_memories_in_payload():
    body = {
        "task": "follow up on RAG research",
        "crew": {"name": "solo", "topology": "single", "agents": [_agent("solo")]},
        "memories": [
            {"summary": "Previous run discussed vector databases and RAG patterns", "task": "explain RAG"},
        ],
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"


def test_unknown_run_id_404s():
    assert client.get("/runs/does-not-exist").status_code == 404
    assert client.get("/runs/does-not-exist/events").status_code == 404


def test_camelcase_aliases_accepted():
    body = {
        "task": "x",
        "crew": {
            "name": "solo",
            "topology": "single",
            "maxRounds": 2,
            "agents": [
                {
                    "name": "solo", "role": "Agent", "goal": "do it", "backend": "test-const",
                    "maxTokens": 128, "systemPrompt": "be terse",
                }
            ],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"


def test_run_with_dynamic_http_tool_end_to_end(monkeypatch):
    import cohortex.tools as tools_mod
    monkeypatch.setattr(tools_mod.socket, "getaddrinfo",
                         lambda host, port: [(None, None, None, None, ("93.184.216.34", 0))])

    calls = []

    class FakeResponse:
        text = "72F and sunny"
        def raise_for_status(self):
            pass

    def fake_get(url, params=None, headers=None, timeout=None, follow_redirects=None):
        calls.append(url)
        return FakeResponse()

    import httpx as real_httpx
    monkeypatch.setattr(real_httpx, "get", fake_get)

    ScriptedBackend._responses_by_role["default"] = [
        '{"tool": "weather", "input": "paris"}',
        '{"answer": "72F and sunny"}',
    ]

    body = {
        "task": "what's the weather in paris?",
        "crew": {
            "name": "weather_team",
            "topology": "single",
            "agents": [_agent("forecaster", backend="test-scripted", tools=["weather"])],
            "toolDefs": [
                {"name": "weather", "kind": "http", "method": "GET",
                 "urlTemplate": "https://api.example.com/weather?city={input}"},
            ],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"
    assert data["result"]["output"] == "72F and sunny"
    assert calls == ["https://api.example.com/weather?city=paris"]


def test_run_with_builtin_tool_def_is_a_noop_and_still_works():
    # A "builtin" toolDefs entry has nothing to build (the name already resolves
    # via cohortex's global registry) — just shouldn't break the run.
    body = {
        "task": "x",
        "crew": {
            "name": "calc_team",
            "topology": "single",
            "agents": [_agent("a", tools=["calculator"])],
            "toolDefs": [{"name": "calculator", "kind": "builtin"}],
        },
    }
    run_id, data = _run_and_wait(body)
    assert data["status"] == "done"


def test_run_rejects_unsafe_tool_def_with_400():
    body = {
        "task": "x",
        "crew": {
            "name": "bad_tool_team",
            "topology": "single",
            "agents": [_agent("a", tools=["fetch"])],
            "toolDefs": [
                {"name": "fetch", "kind": "http", "method": "GET",
                 "urlTemplate": "http://169.254.169.254/latest/meta-data/"},
            ],
        },
    }
    r = client.post("/run", json=body)
    assert r.status_code == 400


@register("test-tool-gen")
class ToolGenBackend:
    """Returns a canned http-tool JSON proposal."""

    def __init__(self, model=None, **_):
        self.model = model or "tool-gen"

    def chat(self, messages, *, temperature=0.3, **opts):
        return (
            '{"name": "cat_fact", "description": "Get a random cat fact.", '
            '"method": "GET", "urlTemplate": "https://catfact.ninja/fact", "headers": {}}'
        )


@register("test-tool-gen-junk")
class JunkToolGenBackend:
    """Returns no JSON at all — the endpoint should 502, not crash."""

    def __init__(self, model=None, **_):
        self.model = model or "junk"

    def chat(self, messages, *, temperature=0.3, **opts):
        return "sorry, I can't help with that"


def test_generate_tool_returns_parsed_proposal():
    body = {"description": "a tool that returns a random cat fact", "llm": {"backend": "test-tool-gen"}}
    r = client.post("/tools/generate", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["name"] == "cat_fact"
    assert data["method"] == "GET"
    assert data["urlTemplate"] == "https://catfact.ninja/fact"
    assert data["headers"] == {}


def test_generate_tool_502s_when_model_returns_no_json():
    r = client.post("/tools/generate", json={"description": "anything", "llm": {"backend": "test-tool-gen-junk"}})
    assert r.status_code == 502


def test_mcp_run_crew_tool():
    crew = {
        "name": "solo",
        "topology": "single",
        "agents": [_agent("solo")],
    }
    result = mcp_server.run_crew(crew, "say hi")
    assert result["crew"] == "solo"
    assert result["output"] == "hello from const backend"


def test_mcp_list_crews_tool_returns_bundled_examples():
    names = mcp_server.list_crews()
    assert "research_team" in names
    assert "assistant" in names


if __name__ == "__main__":
    import subprocess

    subprocess.run([sys.executable, "-m", "pytest", str(pathlib.Path(__file__)), "-v"])
