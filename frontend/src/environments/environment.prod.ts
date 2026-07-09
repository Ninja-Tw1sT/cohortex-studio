// Swapped in for `ng build --configuration production` via angular.json's
// fileReplacements. Update apiBase once the Cloud Run backend URL is known.
export const environment = {
  apiBase: 'https://cohortex-studio-api-REPLACE_ME.a.run.app',
  firebaseConfig: {
    apiKey: 'AIzaSyAnYT89Q27XAC9kFuMKeCbS9Mb07EL2TLs',
    authDomain: 'cohortex-studio.firebaseapp.com',
    projectId: 'cohortex-studio',
    storageBucket: 'cohortex-studio.firebasestorage.app',
    messagingSenderId: '1028715429573',
    appId: '1:1028715429573:web:08be68f84fcec309c2faac',
  },
};
