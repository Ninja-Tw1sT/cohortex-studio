import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Agent, BACKENDS, Tool } from '../core/models';

interface Draft extends Partial<Agent> { vaultsStr?: string; }

const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <h2>Agents</h2>
      <p class="muted">Reusable roles. Each picks its own LLM backend and (optionally) tools + knowledge vaults.</p>
      <table>
        <tr><th>Name</th><th>Role</th><th>Backend</th><th>Tools</th><th></th></tr>
        <tr *ngFor="let a of agents">
          <td><span class="swatch" [style.background]="a.color" [style.color]="a.color"></span>{{ a.name }}</td>
          <td class="muted">{{ a.role }}</td>
          <td><span class="badge cyan">{{ a.backend || 'default' }}</span></td>
          <td class="muted">{{ a.tools.join(', ') || '—' }}</td>
          <td style="text-align:right">
            <ng-container *ngIf="auth.user(); else noAccess">
              <button class="ghost" (click)="edit(a)">Edit</button>
              <button class="danger" (click)="remove(a)">Del</button>
            </ng-container>
            <ng-template #noAccess><span class="muted">—</span></ng-template>
          </td>
        </tr>
      </table>
      <p *ngIf="!agents.length" class="muted">No agents yet — create one below.</p>
    </div>

    <div class="card" *ngIf="auth.user(); else signInPrompt">
      <h3>
        <span class="swatch" *ngIf="draft.color" [style.background]="draft.color" [style.color]="draft.color"></span>
        {{ draft.id ? 'Edit agent' : 'New agent' }}
      </h3>
      <p class="err" *ngIf="error">{{ error }}</p>
      <div class="row">
        <div><label>Name</label><input [(ngModel)]="draft.name" placeholder="researcher" /></div>
        <div><label>Backend</label>
          <select [(ngModel)]="draft.backend">
            <option [ngValue]="null">default (global)</option>
            <option *ngFor="let b of backends" [ngValue]="b">{{ b }}</option>
          </select>
        </div>
        <div><label>Model (optional)</label><input [(ngModel)]="draft.model" placeholder="phi3:mini" /></div>
        <div *ngIf="draft.id"><label>Color</label><input type="color" [(ngModel)]="draft.color" /></div>
      </div>
      <label>Role</label><input [(ngModel)]="draft.role" placeholder="Research Analyst" />
      <label>Goal</label><input [(ngModel)]="draft.goal" placeholder="list the key facts about the topic" />
      <label>System prompt (optional)</label><textarea [(ngModel)]="draft.systemPrompt"></textarea>
      <div class="row">
        <div><label>Temperature</label><input type="number" step="0.1" min="0" max="2" [(ngModel)]="draft.temperature" /></div>
        <div><label>Max tokens (optional)</label><input type="number" [(ngModel)]="draft.maxTokens" /></div>
        <div><label>Vaults (comma-sep)</label><input [(ngModel)]="draft.vaultsStr" placeholder="demo_kb" /></div>
      </div>
      <label>Tools</label>
      <div class="checks">
        <label *ngFor="let t of tools">
          <input type="checkbox" [checked]="hasTool(t.name)" (change)="toggleTool(t.name)"
                 [style.accentColor]="draft.color || '#8a5cff'" />
          {{ t.name }}
        </label>
        <span *ngIf="!tools.length" class="muted">No tools cataloged yet — add one in <a routerLink="/tool-shed">Tool Shed</a>.</span>
      </div>
      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="primary" (click)="save()" [disabled]="!draft.name">Save</button>
        <button class="ghost" (click)="reset()" *ngIf="draft.id">Cancel</button>
      </div>
    </div>
    <ng-template #signInPrompt>
      <div class="card">
        <p class="muted">Sign in to create your own agents. Demo agents above are read-only.</p>
        <button class="primary" (click)="auth.signIn()">Sign in with Google</button>
      </div>
    </ng-template>
  `,
})
export class AgentsComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  backends = BACKENDS;
  agents: Agent[] = [];
  tools: Tool[] = [];
  draft: Draft = this.blank();
  error = '';

  ngOnInit() { this.load(); }

  load() {
    this.api.agents().subscribe({ next: (a) => (this.agents = a), error: (e) => (this.error = errMsg(e)) });
    this.api.tools().subscribe({ next: (t) => (this.tools = t) });
  }

  blank(): Draft {
    return { name: '', role: '', goal: '', backend: null, model: null, temperature: 0.3, maxTokens: null, systemPrompt: '', tools: [], vaultsStr: '', color: null };
  }

  reset() { this.draft = this.blank(); this.error = ''; }

  edit(a: Agent) {
    this.draft = { ...a, tools: [...(a.tools || [])], vaultsStr: (a.vaults || []).join(', ') };
  }

  hasTool(name: string) { return (this.draft.tools || []).includes(name); }
  toggleTool(name: string) {
    const set = (this.draft.tools ||= []);
    const i = set.indexOf(name);
    if (i >= 0) set.splice(i, 1); else set.push(name);
  }

  save() {
    const d = this.draft;
    const body: Partial<Agent> = {
      name: d.name!, role: d.role || '', goal: d.goal || '',
      backend: d.backend || null, model: d.model || null,
      temperature: Number(d.temperature ?? 0.3),
      maxTokens: d.maxTokens ? Number(d.maxTokens) : null,
      systemPrompt: d.systemPrompt || '',
      tools: d.tools || [], vaults: split(d.vaultsStr),
    };
    // Color is only sent when editing an existing agent (where one is already
    // assigned) — creation always lets the server auto-pick from the palette.
    if (d.id && d.color) body.color = d.color;
    const req = d.id ? this.api.updateAgent(d.id, body) : this.api.createAgent(body);
    req.subscribe({ next: () => { this.reset(); this.load(); }, error: (e) => (this.error = errMsg(e)) });
  }

  remove(a: Agent) {
    if (a.id) this.api.deleteAgent(a.id).subscribe({ next: () => this.load(), error: (e) => (this.error = errMsg(e)) });
  }
}
