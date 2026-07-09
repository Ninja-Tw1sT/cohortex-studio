import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LlmConfigService } from '../core/llm-config.service';
import { BACKENDS, LlmConfig } from '../core/models';

const MODEL_PLACEHOLDER: Record<string, string> = {
  ollama: 'phi3:mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-2-latest',
};

const mask = (key?: string) => (key && key.length > 8 ? `${key.slice(0, 3)}...${key.slice(-4)}` : key ? '••••' : '');

@Component({
  selector: 'app-llm-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <h2>LLM Config</h2>
      <p class="muted">
        Bring your own API key to unlock live runs. Stored only in this browser (localStorage),
        sent directly with your own run requests — never saved on our servers, never seen by us.
      </p>

      <p *ngIf="llmConfig.config() as c" class="badge cyan" style="margin-bottom:14px">
        saved: {{ c.backend }} {{ c.model || '(default model)' }} — {{ c.backend === 'ollama' ? c.baseUrl : mask(c.apiKey) }}
      </p>

      <div class="row">
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

      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="primary" (click)="save()" [disabled]="!canSave()">Save</button>
        <button class="danger" (click)="clear()" *ngIf="llmConfig.config()">Clear saved key</button>
      </div>
    </div>
  `,
})
export class LlmConfigComponent {
  llmConfig = inject(LlmConfigService);
  backends = BACKENDS;
  draft: Partial<LlmConfig> = { ...(this.llmConfig.config() ?? { backend: 'openai' }) };
  mask = mask;

  placeholderFor(backend?: string) {
    return backend ? MODEL_PLACEHOLDER[backend] : '';
  }

  canSave() {
    if (!this.draft.backend) return false;
    return this.draft.backend === 'ollama' ? !!this.draft.baseUrl : !!this.draft.apiKey;
  }

  save() {
    this.llmConfig.save(this.draft as LlmConfig);
  }

  clear() {
    this.llmConfig.clear();
    this.draft = { backend: 'openai' };
  }
}
