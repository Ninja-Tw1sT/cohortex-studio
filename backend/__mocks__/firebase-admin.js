// Manual mock for firebase-admin — Jest auto-applies mocks for node_modules
// packages placed here (no jest.mock() call needed), so tests exercise the
// real auth middleware without real Firebase credentials. A token of the
// form "test:<uid>" decodes to that uid; anything else is rejected, matching
// verifyIdToken's real behavior for a bad token.
const authService = {
  verifyIdToken: async (token) => {
    const m = /^test:(.+)$/.exec(token);
    if (!m) throw new Error("invalid token");
    return { uid: m[1], email: `${m[1]}@example.com`, name: m[1] };
  },
};

module.exports = {
  // Real firebase-admin's initializeApp() returns an App instance with its
  // own bound .auth() (that's what our middleware calls) — mirror that shape.
  initializeApp: () => ({ auth: () => authService }),
  credential: { applicationDefault: () => ({}) },
  auth: () => authService,
};
