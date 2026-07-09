// Base URL of the Cohortex Studio Express API.
// For production (Phase 8) this is swapped to the Cloud Run URL via angular.json
// fileReplacements; for local dev it points at the Express server on :3000.
//
// firebaseConfig values come from Firebase console > Project settings > Your apps
// (Web app). These identify the project only — not secret, safe to commit — but
// fill in your own project's values below rather than using placeholders.
export const environment = {
  apiBase: 'http://localhost:3000',
  firebaseConfig: {
    apiKey: 'AIzaSyAnYT89Q27XAC9kFuMKeCbS9Mb07EL2TLs',
    authDomain: 'cohortex-studio.firebaseapp.com',
    projectId: 'cohortex-studio',
    storageBucket: 'cohortex-studio.firebasestorage.app',
    messagingSenderId: '1028715429573',
    appId: '1:1028715429573:web:08be68f84fcec309c2faac',
  },
};
