import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { LlmConfigService } from '../core/llm-config.service';
import { Agent, BUILTIN_TOOLS, HTTP_METHODS, SUGGESTED_TOOL_CATEGORIES, TOOL_KINDS, Tool } from '../core/models';
import { TOOL_TEMPLATES, ToolTemplate } from '../core/tool-templates';
import { SCHEMA_PROVIDERS, SchemaProvider, schemaFor } from '../core/tool-schema-export';

interface Draft extends Partial<Tool> { headersStr?: string; }

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

const parseHeaders = (s?: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const pair of (s || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
};
const formatHeaders = (h?: Record<string, string>) =>
  Object.entries(h || {}).map(([k, v]) => `${k}=${v}`).join(', ');

@Component({
  selector: 'app-tool-shed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <h2>Tool Shed</h2>
      <p class="muted">Load or generate the tools your agents can call. Assign them by name on the Agents screen.</p>
      <div class="row" style="align-items:center; margin-bottom:8px">
        <div style="flex:0 0 auto"><label>Category</label>
          <select [(ngModel)]="categoryFilter">
            <option [ngValue]="null">All ({{ tools.length }})</option>
            <option *ngFor="let c of categories()" [ngValue]="c">{{ c }} ({{ toolsInCategory(c).length }})</option>
          </select>
        </div>
      </div>
      <table>
        <tr><th>Name</th><th>Category</th><th>Kind</th><th>Details</th><th></th></tr>
        <ng-container *ngFor="let t of filteredTools()">
          <tr>
            <td>
              <span class="badge violet">{{ t.name }}</span>
              <span class="chips" style="margin-left:8px">
                <span class="swatch" *ngFor="let a of usedBy(t)" [title]="a.name"
                      [style.background]="a.color" [style.color]="a.color"></span>
              </span>
            </td>
            <td><span class="badge magenta">{{ t.category || 'General' }}</span></td>
            <td><span class="badge" [class.cyan]="t.kind==='http'">{{ t.kind }}</span></td>
            <td class="muted">
              <ng-container *ngIf="t.kind === 'http'; else builtinDesc">
                <span class="badge">{{ t.method || 'GET' }}</span> {{ t.urlTemplate }}
              </ng-container>
              <ng-template #builtinDesc>{{ t.description || '—' }}</ng-template>
            </td>
            <td style="text-align:right">
              <button class="ghost" (click)="toggleSchema(t)">{{ schemaOpenFor === t.id ? 'Hide' : 'Schema' }}</button>
              <ng-container *ngIf="auth.user(); else noAccess">
                <button class="ghost" (click)="edit(t)">Edit</button>
                <button class="danger" (click)="remove(t)">Del</button>
              </ng-container>
              <ng-template #noAccess><span class="muted"></span></ng-template>
            </td>
          </tr>
          <tr *ngIf="schemaOpenFor === t.id">
            <td colspan="5">
              <div class="row" style="align-items:center">
                <div style="flex:0 0 auto"><label>As</label>
                  <select [(ngModel)]="schemaProvider">
                    <option *ngFor="let p of schemaProviders" [ngValue]="p.id">{{ p.label }}</option>
                  </select>
                </div>
                <button class="ghost" style="flex:0 0 auto" (click)="copySchema(t)">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
              </div>
              <pre class="schema-block">{{ schemaJson(t) }}</pre>
              <p class="muted" style="font-size:11px">
                Reference only — Cohortex's agents call tools via a universal prompt-based ReAct loop, not
                provider-native tool-calling, so nothing here is consumed by this app. Useful if you want to
                call this same tool from a provider's native tools API elsewhere.
              </p>
            </td>
          </tr>
        </ng-container>
      </table>
      <p *ngIf="!tools.length" class="muted">No tools cataloged yet — add one below.</p>
    </div>

    <div class="card" *ngIf="auth.user()">
      <h3>Templates</h3>
      <p class="muted">Ready-made tools against well-known public APIs that need no key — pick one to pre-fill the form below.</p>
      <div class="chips">
        <button class="ghost" *ngFor="let t of templates" (click)="useTemplate(t)" [title]="t.description">
          {{ t.name }}
        </button>
      </div>
    </div>

    <div class="card" *ngIf="auth.user()">
      <h3>Generate with AI</h3>
      <p class="muted" *ngIf="!llmConfig.credentials().length">
        No saved credentials yet — add one in <a routerLink="/llm-config">LLM Config</a> to generate tools.
      </p>
      <ng-container *ngIf="llmConfig.credentials().length">
        <label>Describe the tool</label>
        <textarea [(ngModel)]="genDescription" placeholder="A tool that converts a temperature in Celsius to Fahrenheit"></textarea>
        <div class="row">
          <div><label>Using</label>
            <select [(ngModel)]="genCredentialId">
              <option [ngValue]="null">— pick a saved credential —</option>
              <option *ngFor="let c of llmConfig.credentials()" [ngValue]="c.id">{{ c.label }} ({{ c.backend }})</option>
            </select>
          </div>
        </div>
        <p class="err" *ngIf="genError">{{ genError }}</p>
        <button class="primary" style="margin-top:10px" (click)="generate()" [disabled]="!genDescription || !genCredentialId || generating">
          {{ generating ? 'Generating…' : 'Generate ▸' }}
        </button>
      </ng-container>
    </div>

    <div class="card" *ngIf="auth.user(); else signInPrompt">
      <h3>{{ draft.id ? 'Edit tool' : 'New tool' }}</h3>
      <p class="err" *ngIf="error">{{ error }}</p>
      <div class="row">
        <div><label>Kind</label>
          <select [(ngModel)]="draft.kind" [disabled]="!!draft.id">
            <option *ngFor="let k of kinds" [ngValue]="k">{{ k }}</option>
          </select>
        </div>
        <div *ngIf="draft.kind === 'builtin'"><label>Name</label>
          <select [(ngModel)]="draft.name" [disabled]="!!draft.id">
            <option [ngValue]="undefined">— pick —</option>
            <option *ngFor="let n of builtinNames" [ngValue]="n">{{ n }}</option>
          </select>
        </div>
        <div *ngIf="draft.kind === 'http'"><label>Name</label>
          <input [(ngModel)]="draft.name" placeholder="weather_lookup" [disabled]="!!draft.id" />
        </div>
        <div *ngIf="draft.kind === 'http'"><label>Method</label>
          <select [(ngModel)]="draft.method">
            <option *ngFor="let m of methods" [ngValue]="m">{{ m }}</option>
          </select>
        </div>
        <div><label>Category</label>
          <input [(ngModel)]="draft.category" list="tool-categories" placeholder="Utility" />
          <datalist id="tool-categories">
            <option *ngFor="let c of categories()" [value]="c"></option>
          </datalist>
        </div>
      </div>
      <ng-container *ngIf="draft.kind === 'http'">
        <label>URL template</label>
        <input [(ngModel)]="draft.urlTemplate" placeholder="https://api.example.com/weather?city={input}" />
        <span class="muted" style="font-size:11px">
          The host must be a fixed literal — use <code>&#123;input&#125;</code> only in the path/query for the agent's tool argument.
        </span>
        <label>Headers (optional, key=value comma-sep)</label>
        <input [(ngModel)]="draft.headersStr" placeholder="X-Api-Key=abc123" />
      </ng-container>
      <label>Description (optional)</label>
      <textarea [(ngModel)]="draft.description" placeholder="What this tool does for an agent"></textarea>
      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="primary" (click)="save()" [disabled]="!draft.name">Save</button>
        <button class="ghost" (click)="reset()" *ngIf="draft.id">Cancel</button>
      </div>
    </div>
    <ng-template #signInPrompt>
      <div class="card">
        <p class="muted">Sign in to load or generate your own tools. Demo entries above are read-only.</p>
        <button class="primary" (click)="auth.signIn()">Sign in with Google</button>
      </div>
    </ng-template>
  `,
  styles: [`
    .schema-block {
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: 10px; margin-top: 8px; font-size: 11px; overflow-x: auto; color: var(--text);
    }
  `],
})
export class ToolShedComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  llmConfig = inject(LlmConfigService);
  builtinNames = BUILTIN_TOOLS;
  kinds = TOOL_KINDS;
  methods = HTTP_METHODS;
  schemaProviders = SCHEMA_PROVIDERS;
  templates = TOOL_TEMPLATES;
  tools: Tool[] = [];
  agents: Agent[] = [];
  draft: Draft = this.blank();
  error = '';
  categoryFilter: string | null = null;

  schemaOpenFor: string | null = null;
  schemaProvider: SchemaProvider = 'openai';
  copied = false;

  genDescription = '';
  genCredentialId: string | null = null;
  generating = false;
  genError = '';

  ngOnInit() { this.load(); }

  load() {
    this.api.tools().subscribe({ next: (t) => (this.tools = t), error: (e) => (this.error = errMsg(e)) });
    this.api.agents().subscribe({ next: (a) => (this.agents = a) });
  }

  usedBy(t: Tool): Agent[] {
    return this.agents.filter((a) => a.tools.includes(t.name));
  }

  categories(): string[] {
    const known = new Set([...SUGGESTED_TOOL_CATEGORIES, ...this.tools.map((t) => t.category || 'General')]);
    return [...known].sort();
  }

  toolsInCategory(c: string): Tool[] {
    return this.tools.filter((t) => (t.category || 'General') === c);
  }

  filteredTools(): Tool[] {
    return this.categoryFilter ? this.toolsInCategory(this.categoryFilter) : this.tools;
  }

  toggleSchema(t: Tool) {
    this.schemaOpenFor = this.schemaOpenFor === t.id ? null : (t.id ?? null);
    this.copied = false;
  }

  schemaJson(t: Tool): string {
    return JSON.stringify(schemaFor(t, this.schemaProvider), null, 2);
  }

  copySchema(t: Tool) {
    navigator.clipboard.writeText(this.schemaJson(t)).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    });
  }

  blank(): Draft {
    return { name: undefined, kind: 'builtin', description: '', category: 'General', method: 'GET', urlTemplate: '', headersStr: '' };
  }

  reset() { this.draft = this.blank(); this.error = ''; }

  edit(t: Tool) { this.draft = { ...t, headersStr: formatHeaders(t.headers) }; }

  useTemplate(t: ToolTemplate) {
    this.draft = { name: t.name, kind: 'http', description: t.description, method: t.method, urlTemplate: t.urlTemplate, headersStr: '' };
    this.error = '';
  }

  generate() {
    const cred = this.llmConfig.credentials().find((c) => c.id === this.genCredentialId);
    if (!cred) return;
    this.generating = true;
    this.genError = '';
    this.api.generateTool(this.genDescription, {
      backend: cred.backend, model: cred.model || undefined, apiKey: cred.apiKey, baseUrl: cred.baseUrl,
    }).subscribe({
      next: (proposed) => {
        this.generating = false;
        this.draft = {
          name: proposed.name, kind: 'http', description: proposed.description,
          method: proposed.method, urlTemplate: proposed.urlTemplate,
          headersStr: formatHeaders(proposed.headers),
        };
      },
      error: (e) => { this.generating = false; this.genError = errMsg(e); },
    });
  }

  save() {
    const d = this.draft;
    const body: Partial<Tool> = { name: d.name, kind: d.kind, description: d.description || '', category: d.category || 'General' };
    if (d.kind === 'http') {
      body.method = d.method || 'GET';
      body.urlTemplate = d.urlTemplate || '';
      body.headers = parseHeaders(d.headersStr);
    }
    const req = d.id ? this.api.updateTool(d.id, body) : this.api.createTool(body);
    req.subscribe({ next: () => { this.reset(); this.load(); }, error: (e) => (this.error = errMsg(e)) });
  }

  remove(t: Tool) {
    if (!t.id || !confirm(`Delete tool "${t.name}"? Any agent assigned to it will lose access.`)) return;
    this.api.deleteTool(t.id).subscribe({ next: () => this.load(), error: (e) => (this.error = errMsg(e)) });
  }
}
