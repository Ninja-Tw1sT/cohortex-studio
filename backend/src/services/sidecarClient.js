// Thin HTTP client for the Cohortex FastAPI sidecar. Uses Node's global fetch.
// SIDECAR_URL is read at call time so tests can point it at a fake sidecar.
const base = () => process.env.SIDECAR_URL || "http://localhost:8000";
const authHeaders = () =>
  process.env.SIDECAR_SHARED_KEY ? { "X-Sidecar-Key": process.env.SIDECAR_SHARED_KEY } : {};

async function startRun(crewPayload, task) {
  const res = await fetch(`${base()}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ task, crew: crewPayload }),
  });
  if (!res.ok) throw new Error(`sidecar /run ${res.status}: ${await res.text()}`);
  return res.json(); // { run_id }
}

async function getRun(sidecarRunId) {
  const res = await fetch(`${base()}/runs/${sidecarRunId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`sidecar /runs/${sidecarRunId} ${res.status}`);
  return res.json(); // { status, result, error }
}

async function getEvents(sidecarRunId, since = 0) {
  const res = await fetch(`${base()}/runs/${sidecarRunId}/events?since=${since}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`sidecar events ${res.status}`);
  return res.json(); // { events, status }
}

module.exports = { startRun, getRun, getEvents };
