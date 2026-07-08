// Base URL of the Cohortex Studio Express API.
// For production (Phase 8) this is swapped to the Cloud Run URL via angular.json
// fileReplacements; for local dev it points at the Express server on :3000.
export const environment = {
  apiBase: 'http://localhost:3000',
};
