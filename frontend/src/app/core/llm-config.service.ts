import { Injectable, signal } from '@angular/core';
import { SavedLlmCredential } from './models';

// Stored in localStorage only — never sent anywhere except as part of the
// visitor's own run requests (see RunsComponent.run()). We never persist this
// server-side, so there's nothing here to leak from a database breach.
const STORAGE_KEY = 'cohortex-studio.llm-credentials.v1';

@Injectable({ providedIn: 'root' })
export class LlmConfigService {
  credentials = signal<SavedLlmCredential[]>(this.load());

  private load(): SavedLlmCredential[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private persist(list: SavedLlmCredential[]) {
    this.credentials.set(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  add(c: Omit<SavedLlmCredential, 'id'>) {
    this.persist([...this.credentials(), { ...c, id: crypto.randomUUID() }]);
  }

  update(id: string, patch: Partial<SavedLlmCredential>) {
    this.persist(this.credentials().map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  remove(id: string) {
    this.persist(this.credentials().filter((c) => c.id !== id));
  }
}
