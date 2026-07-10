const { URL } = require("url");
const net = require("net");

// Fast, best-effort UX check when a Tool Shed HTTP tool is created/edited — lets
// the form reject an obviously-bad URL immediately instead of waiting for a run
// to fail. This is NOT the security boundary: it only sees the literal
// urlTemplate (no DNS resolution, no re-check of the agent-substituted URL at
// call time). The real enforcement is cohortex.tools._is_safe_url in the
// sidecar, which re-resolves the host on every call — see that module's
// docstring for why a one-time check here wouldn't be sufficient on its own.
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isObviouslyUnsafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (!["http:", "https:"].includes(u.protocol)) return true;
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (net.isIPv4(host)) return isPrivateIPv4(host);
  if (net.isIPv6(host)) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  return false; // a real hostname — can't resolve synchronously here
}

module.exports = { isObviouslyUnsafeUrl };
