// Central error handler — normalizes everything to {"error": "..."} (matching the
// house style in ai-workflow/api/server.py and the FastAPI sidecar).
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message });
  }
  if (err.name === "CastError") {
    return res.status(400).json({ error: `invalid ${err.path}: ${err.value}` });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: `duplicate key: ${JSON.stringify(err.keyValue)}` });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: err.message || "internal error" });
};
