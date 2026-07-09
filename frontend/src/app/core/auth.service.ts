import { Injectable, signal } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private app = initializeApp(environment.firebaseConfig);
  private auth = getAuth(this.app);
  private provider = new GoogleAuthProvider();

  // null until the SDK resolves the initial auth state (avoids a signed-out flash).
  ready = signal(false);
  user = signal<User | null>(null);

  constructor() {
    onAuthStateChanged(this.auth, (u) => {
      this.user.set(u);
      this.ready.set(true);
    });
  }

  signIn() {
    return signInWithPopup(this.auth, this.provider);
  }

  signOutUser() {
    return signOut(this.auth);
  }

  getIdToken(): Promise<string | null> {
    const u = this.auth.currentUser;
    return u ? u.getIdToken() : Promise.resolve(null);
  }
}
