const rateLimit = require("express-rate-limit");

// Generous general ceiling for the whole API — catches scripted abuse without
// bothering normal browsing/polling traffic.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limit on starting a live run specifically — each one costs a real
// LLM call (or several, per crew agent) via the sidecar. Keyed per signed-in
// user rather than IP so one recruiter on shared wifi can't starve another.
// Replays are free (stream stored steps, no sidecar call) so they're exempt.
const runLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid || req.ip,
  skip: (req) => req.body?.mode === "replay",
  message: { error: "rate limit: too many runs started, try again in a while" },
});

module.exports = { apiLimiter, runLimiter };
