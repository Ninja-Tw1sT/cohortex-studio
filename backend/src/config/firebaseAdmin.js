const admin = require("firebase-admin");

// Lazy singleton: only touches GOOGLE_APPLICATION_CREDENTIALS the first time a
// token actually needs verifying, so routes/tests that never send a Bearer
// token keep working without a service account key present.
let app;
function getAdminApp() {
  if (!app) {
    app = admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return app;
}

module.exports = { getAdminApp };
