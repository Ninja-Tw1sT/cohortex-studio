"""
Sidecar tests using fake LLM backends — no network, no Ollama, no cloud keys.

Registers test-only backends into cohortex's real provider registry (the same mechanism
cohortex.providers.register uses for ollama/openai/anthropic/gemini/grok), so the sidecar's
crew_builder/main code path is exercised exactly as in production, just with a scripted
"model" standing in for the LLM.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from cohortex.providers import register
from app.main import app

client = TestClient(app)


@register("test-const")
class ConstBackend:
    """Always returns the same string — mirrors cohortex/tests/test_framework.py's fake."""

    def __init__(self, model=None, **_):
        self.model = model or "const"

    def chat(self, messages, *, temperature=0.3, max_tokens=None, **opts):
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


def _agent(name, role="Agent", backend="test-const", **overrides):
    a = {"name": name, "role": role, "goal": "do the job", "backend": backend}
    a.update(overrides)
    return a


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
    r = client.post("/run", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["crew"] == "solo"
    assert data["output"] == "hello from const backend"
    assert len(data["steps"]) == 1
    assert data["steps"][0]["agent"] == "solo"


def test_run_sequential_topology_order_and_handoff():
    body = {
        "task": "research something",
        "crew": {
            "name": "research_team",
            "topology": "sequential",
            "agents": [
                _agent("researcher"),
                _agent("writer"),
                _agent("editor"),
            ],
        },
    }
    r = client.post("/run", json=body)
    assert r.status_code == 200
    data = r.json()
    assert [s["agent"] for s in data["steps"]] == ["researcher", "writer", "editor"]
    assert data["output"] == "hello from const backend"


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
    r = client.post("/run", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["output"] == "the answer is 4"
    assert any(s["agent"] == "mathematician" for s in data["steps"])


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
    assert "error" in r.json() or "detail" in r.json()


def test_camelcase_aliases_accepted():
    body = {
        "task": "x",
        "crew": {
            "name": "solo",
            "topology": "single",
            "maxRounds": 2,
            "agents": [
                {
                    "name": "solo",
                    "role": "Agent",
                    "goal": "do it",
                    "backend": "test-const",
                    "maxTokens": 128,
                    "systemPrompt": "be terse",
                }
            ],
        },
    }
    r = client.post("/run", json=body)
    assert r.status_code == 200


if __name__ == "__main__":
    import subprocess

    subprocess.run([sys.executable, "-m", "pytest", str(pathlib.Path(__file__)), "-v"])
