import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Agent, BACKENDS } from '../core/models';

interface Draft extends Partial<Agent> { toolsStr?: string; vaultsStr?: string; }

const split = (s?: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <h2>Agents</h2>
      <p class="muted">Reusable roles. Each picks its own LLM backend and (optionally) tools + knowledge vaults.</p>
      <table>
        <tr><th>Name</th><th>Role</th><th>Backend</th><th>Tools</th><th></th></tr>
        <tr *ngFor="let a of agents">
          <td>{{ a.name }}</td>
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
      <h3>{{ draft.id ? 'Edit agent' : 'New agent' }}</h3>
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
      </div>
      <label>Role</label><input [(ngModel)]="draft.role" placeholder="Research Analyst" />
      <label>Goal</label><input [(ngModel)]="draft.goal" placeholder="list the key facts about the topic" />
      <label>System prompt (optional)</label><textarea [(ngModel)]="draft.systemPrompt"></textarea>
      <div class="row">
        <div><label>Temperature</label><input type="number" step="0.1" min="0" max="2" [(ngModel)]="draft.temperature" /></div>
        <div><label>Max tokens (optional)</label><input type="number" [(ngModel)]="draft.maxTokens" /></div>
        <div><label>Tools (comma-sep)</label><input [(ngModel)]="draft.toolsStr" placeholder="calculator" /></div>
        <div><label>Vaults (comma-sep)</label><input [(ngModel)]="draft.vaultsStr" placeholder="demo_kb" /></div>
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
  draft: Draft = this.blank();
  error = '';

  ngOnInit() { this.load(); }

  load() {
    this.api.agents().subscribe({ next: (a) => (this.agents = a), error: (e) => (this.error = errMsg(e)) });
  }

  blank(): Draft {
    return { name: '', role: '', goal: '', backend: null, model: null, temperature: 0.3, maxTokens: null, systemPrompt: '', toolsStr: '', vaultsStr: '' };
  }

  reset() { this.draft = this.blank(); this.error = ''; }

  edit(a: Agent) {
    this.draft = { ...a, toolsStr: (a.tools || []).join(', '), vaultsStr: (a.vaults || []).join(', ') };
  }

  save() {
    const d = this.draft;
    const body: Partial<Agent> = {
      name: d.name!, role: d.role || '', goal: d.goal || '',
      backend: d.backend || null, model: d.model || null,
      temperature: Number(d.temperature ?? 0.3),
      maxTokens: d.maxTokens ? Number(d.maxTokens) : null,
      systemPrompt: d.systemPrompt || '',
      tools: split(d.toolsStr), vaults: split(d.vaultsStr),
    };
    const req = d.id ? this.api.updateAgent(d.id, body) : this.api.createAgent(body);
    req.subscribe({ next: () => { this.reset(); this.load(); }, error: (e) => (this.error = errMsg(e)) });
  }

  remove(a: Agent) {
    if (a.id) this.api.deleteAgent(a.id).subscribe({ next: () => this.load(), error: (e) => (this.error = errMsg(e)) });
  }
}
