import { Injectable, signal } from '@angular/core';
import { LlmConfig } from './models';

// Stored in localStorage only — never sent anywhere except as part of the
// visitor's own run requests (see RunsComponent.run()). We never persist this
// server-side, so there's nothing here to leak from a database breach.
const STORAGE_KEY = 'cohortex_llm_config';

@Injectable({ providedIn: 'root' })
export class LlmConfigService {
  config = signal<LlmConfig | null>(this.load());

  private load(): LlmConfig | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  save(cfg: LlmConfig) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    this.config.set(cfg);
  }

  clear() {
    localStorage.removeItem(STORAGE_KEY);
    this.config.set(null);
  }
}
