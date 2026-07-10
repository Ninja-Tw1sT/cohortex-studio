const express = require("express");
const cors = require("cors");

const health = require("./routes/health");
const agents = require("./routes/agents");
const crews = require("./routes/crews");
const runs = require("./routes/runs");
const tools = require("./routes/tools");
const errorHandler = require("./middleware/errorHandler");
const { optionalAuth } = require("./middleware/auth");
const { apiLimiter } = require("./middleware/rateLimit");

// ALLOWED_ORIGINS restricts CORS to specific origins in prod (comma-separated).
// Unset (local dev, tests) falls back to allowing any origin.
const corsOptions = () => {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.length ? { origin: allowed } : {};
};

// App factory (no DB connection, no listen) so tests can mount it directly.
function createApp() {
  const app = express();
  app.use(cors(corsOptions()));
  app.use(express.json());
  app.use("/api", apiLimiter, optionalAuth);

  app.use("/api", health);
  app.use("/api/agents", agents);
  app.use("/api/crews", crews);
  app.use("/api/runs", runs);
  app.use("/api/tools", tools);

  app.use((req, res) => res.status(404).json({ error: `not found: ${req.method} ${req.path}` }));
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
