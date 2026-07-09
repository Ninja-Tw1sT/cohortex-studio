import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { LlmConfigService } from '../core/llm-config.service';
import { BACKENDS, SavedLlmCredential } from '../core/models';

const MODEL_PLACEHOLDER: Record<string, string> = {
  ollama: 'phi3:mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-2-latest',
};

const mask = (key?: string) => (key && key.length > 8 ? `${key.slice(0, 3)}...${key.slice(-4)}` : key ? '••••' : '');

type Draft = Partial<Omit<SavedLlmCredential, 'id'>>;

@Component({
  selector: 'app-llm-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <h2>LLM Config</h2>
      <p class="muted">
        These credentials are stored only in this browser's local storage. They are sent
        directly to Cohortex Studio's sidecar for the duration of a live run and are never
        written to our database. Clearing your browser data deletes them permanently.
      </p>
    </div>

    <ng-container *ngIf="auth.user(); else signInPrompt">
      <div class="card" *ngIf="llmConfig.credentials().length">
        <h3>Saved credentials</h3>
        <table>
          <tr><th>Label</th><th>Provider</th><th>Model</th><th>Key / URL</th><th></th></tr>
          <tr *ngFor="let c of llmConfig.credentials()">
            <td>{{ c.label }}</td>
            <td><span class="badge cyan">{{ c.backend }}</span></td>
            <td class="muted">{{ c.model || '(default)' }}</td>
            <td class="muted">{{ c.backend === 'ollama' ? c.baseUrl : mask(c.apiKey) }}</td>
            <td style="text-align:right"><button class="danger" (click)="remove(c.id)">Remove</button></td>
          </tr>
        </table>
      </div>

      <div class="card">
        <h3>Add a credential</h3>
        <div class="row">
          <div><label>Label</label>
            <input [(ngModel)]="draft.label" placeholder="My OpenAI key" />
          </div>
          <div><label>Provider</label>
            <select [(ngModel)]="draft.backend">
              <option *ngFor="let b of backends" [ngValue]="b">{{ b }}</option>
            </select>
          </div>
          <div><label>Model (optional)</label>
            <input [(ngModel)]="draft.model" [placeholder]="placeholderFor(draft.backend)" />
          </div>
        </div>

        <ng-container *ngIf="draft.backend === 'ollama'; else keyInput">
          <label>Base URL</label>
          <input [(ngModel)]="draft.baseUrl" placeholder="http://localhost:11434" />
        </ng-container>
        <ng-template #keyInput>
          <label>API Key</label>
          <input type="password" [(ngModel)]="draft.apiKey" placeholder="sk-…" autocomplete="off" />
        </ng-template>

        <div style="margin-top:14px">
          <button class="primary" (click)="add()" [disabled]="!canAdd()">Save credential</button>
        </div>
      </div>
    </ng-container>
    <ng-template #signInPrompt>
      <div class="card">
        <p class="muted">Sign in to save LLM credentials.</p>
        <button class="primary" (click)="auth.signIn()">Sign in with Google</button>
      </div>
    </ng-template>
  `,
})
export class LlmConfigComponent {
  auth = inject(AuthService);
  llmConfig = inject(LlmConfigService);
  backends = BACKENDS;
  draft: Draft = this.blank();
  mask = mask;

  blank(): Draft {
    return { label: '', backend: 'openai' };
  }

  placeholderFor(backend?: string) {
    return backend ? MODEL_PLACEHOLDER[backend] : '';
  }

  canAdd() {
    if (!this.draft.label || !this.draft.backend) return false;
    return this.draft.backend === 'ollama' ? !!this.draft.baseUrl : !!this.draft.apiKey;
  }

  add() {
    this.llmConfig.add(this.draft as Omit<SavedLlmCredential, 'id'>);
    this.draft = this.blank();
  }

  remove(id: string) {
    this.llmConfig.remove(id);
  }
}
