const { getAdminApp } = require("../config/firebaseAdmin");

// Populates req.user from a Firebase ID token if one is present; never rejects
// the request. Lets GET routes serve the public demo namespace (ownerId: null)
// to anonymous visitors while also recognizing signed-in users, so a single
// route can return "demo + mine" without a separate authenticated code path.
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try {
    const decoded = await getAdminApp().auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email, name: decoded.name };
  } catch {
    // Invalid/expired token on an optional route — treat as anonymous instead
    // of erroring, since the caller may just be browsing the public demo.
  }
  next();
}

// Rejects the request unless optionalAuth (mounted app-wide) already resolved
// a valid signed-in user. Mount after optionalAuth on routes that mutate data
// or start a paid/costly (live) run.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "sign-in required" });
  next();
}

module.exports = { optionalAuth, requireAuth };
