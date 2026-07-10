import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { LlmConfigService } from '../core/llm-config.service';
import { RunStreamService } from '../core/run-stream.service';
import { Agent, Crew, LlmConfig, Run, RunStep, Usage } from '../core/models';

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-runs',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <h2>Run a crew</h2>
      <p class="err" *ngIf="error">{{ error }}</p>
      <div class="row">
        <div><label>Crew</label>
          <select [ngModel]="crewId" (ngModelChange)="onCrewChange($event)">
            <option [ngValue]="''">— pick a crew —</option>
            <option *ngFor="let c of crews" [ngValue]="c.id">{{ c.name }} ({{ c.topology }})</option>
          </select>
        </div>
        <div><label>Mode</label>
          <select [(ngModel)]="mode">
            <option value="live" [disabled]="!auth.user()">live (calls the LLMs){{ auth.user() ? '' : ' — sign in required' }}</option>
            <option value="replay">replay (cached, no LLM cost)</option>
          </select>
        </div>
      </div>

      <div class="card" *ngIf="mode==='live' && crewMembers.length" style="margin:14px 0">
        <h3>Assign an LLM credential to each agent</h3>
        <p class="muted" *ngIf="!llmConfig.credentials().length">
          No saved credentials yet — add one in <a routerLink="/llm-config">LLM Config</a>.
        </p>
        <div class="row" *ngFor="let m of crewMembers">
          <div><label><span class="swatch" [style.background]="m.color" [style.color]="m.color"></span>{{ m.name }} <span class="muted">({{ m.role }})</span></label>
            <select [(ngModel)]="assignments[m.name]">
              <option [ngValue]="null">— none (use server default) —</option>
              <option *ngFor="let c of llmConfig.credentials()" [ngValue]="c.id">{{ c.label }} ({{ c.backend }})</option>
            </select>
          </div>
        </div>
      </div>

      <label>Task</label>
      <textarea [(ngModel)]="task" placeholder="Explain why vector databases matter for AI applications"></textarea>
      <div style="margin-top:12px">
        <button class="primary" (click)="run()"
          [disabled]="!crewId || !task || running || (mode==='live' && !auth.user()) || (mode==='live' && crewMembers.length && !allCovered())">
          {{ running ? 'Running…' : 'Run ▸' }}
        </button>
        <span *ngIf="status" class="badge" [class.green]="status==='done'" [class.magenta]="status==='error'" [class.cyan]="status==='running'" style="margin-left:10px">{{ status }}</span>
        <span *ngIf="mode==='live' && !auth.user()" class="muted" style="margin-left:10px">sign in to run live — try replay to preview</span>
        <span *ngIf="mode==='live' && auth.user() && crewMembers.length && !allCovered()" class="muted" style="margin-left:10px">
          assign a saved credential to every agent to run live
        </span>
      </div>
    </div>

    <div class="card" *ngIf="steps.length || finalOutput || running">
      <h3>Live progress</h3>
      <div class="step" *ngFor="let s of steps" [style.borderLeftColor]="colorOf(s.agent)">
        <div class="who" [style.color]="colorOf(s.agent)">{{ s.agent }}</div>
        <div>{{ s.output }}</div>
        <div class="usage" *ngIf="usageOf(s) as u">
          <span class="badge">{{ u.prompt_tokens }}p</span>
          <span class="badge">{{ u.completion_tokens }}c</span>
          <span class="badge cyan">{{ u.total_tokens }} tok</span>
        </div>
      </div>
      <div class="step" *ngIf="streamingAgent" [style.borderLeftColor]="colorOf(streamingAgent)">
        <div class="who" [style.color]="colorOf(streamingAgent)">{{ streamingAgent }}</div>
        <div>{{ streamingText }}<span class="muted">▍</span></div>
      </div>
      <div class="step muted" *ngIf="running && !steps.length && !streamingAgent">// waiting for the first agent…</div>
      <div class="step final" *ngIf="finalOutput">
        <div class="who" style="color:var(--cyan)">FINAL</div>
        <div>{{ finalOutput }}</div>
        <div class="usage" *ngIf="totalUsage() as t">
          Total: {{ t.prompt_tokens }}p + {{ t.completion_tokens }}c = {{ t.total_tokens }} tokens
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Recent runs</h3>
      <table>
        <tr><th>Crew</th><th>Task</th><th>Mode</th><th>Status</th></tr>
        <tr *ngFor="let r of history">
          <td>{{ r.crewName }}</td>
          <td class="muted">{{ r.task | slice: 0:60 }}</td>
          <td><span class="badge">{{ r.mode }}</span></td>
          <td><span class="badge" [class.green]="r.status==='done'" [class.magenta]="r.status==='error'">{{ r.status }}</span></td>
        </tr>
      </table>
      <p *ngIf="!history.length" class="muted">No runs yet.</p>
    </div>
  `,
})
export class RunsComponent implements OnInit {
  private api = inject(ApiService);
  private streamer = inject(RunStreamService);
  auth = inject(AuthService);
  llmConfig = inject(LlmConfigService);

  crews: Crew[] = [];
  agents: Agent[] = [];
  crewMembers: Agent[] = [];
  assignments: Record<string, string | null> = {};
  history: Run[] = [];
  crewId = '';
  task = '';
  mode: 'live' | 'replay' = 'replay';

  running = false;
  status = '';
  steps: RunStep[] = [];
  streamingAgent: string | null = null;
  streamingText = '';
  finalOutput = '';
  error = '';

  ngOnInit() {
    this.api.crews().subscribe({ next: (c) => (this.crews = c) });
    this.api.agents().subscribe({ next: (a) => (this.agents = a) });
    this.loadHistory();
  }

  loadHistory() { this.api.runs().subscribe({ next: (r) => (this.history = r) }); }

  onCrewChange(id: string) {
    this.crewId = id;
    const crew = this.crews.find((c) => c.id === id);
    const names = crew
      ? Array.from(new Set([...crew.agentNames, ...(crew.supervisorName ? [crew.supervisorName] : [])]))
      : [];
    const byName = new Map(this.agents.map((a) => [a.name, a]));
    this.crewMembers = names.map((n) => byName.get(n)).filter((a): a is Agent => !!a);
    this.assignments = {};
  }

  allCovered() {
    return this.crewMembers.every((m) => !!this.assignments[m.name]);
  }

  colorOf(agentName: string): string | null {
    return this.agents.find((a) => a.name === agentName)?.color ?? null;
  }

  usageOf(s: RunStep): Usage | null {
    const u = s.meta?.['usage'];
    return u ? (u as Usage) : null;
  }

  totalUsage(): Usage | null {
    const usages = this.steps.map((s) => this.usageOf(s)).filter((u): u is Usage => !!u);
    if (!usages.length) return null;
    return {
      prompt_tokens: usages.reduce((s, u) => s + (u.prompt_tokens || 0), 0),
      completion_tokens: usages.reduce((s, u) => s + (u.completion_tokens || 0), 0),
      total_tokens: usages.reduce((s, u) => s + (u.total_tokens || 0), 0),
    };
  }

  run() {
    this.error = '';
    this.steps = [];
    this.streamingAgent = null;
    this.streamingText = '';
    this.finalOutput = '';
    this.running = true;
    this.status = 'running';

    const overrides: Record<string, LlmConfig> | undefined =
      this.mode === 'live' && this.crewMembers.length
        ? Object.fromEntries(
            this.crewMembers.map((m) => {
              const cred = this.llmConfig.credentials().find((c) => c.id === this.assignments[m.name]);
              return [m.name, { backend: cred!.backend, model: cred!.model || undefined, apiKey: cred!.apiKey, baseUrl: cred!.baseUrl }];
            })
          )
        : undefined;

    this.api.createRun(this.crewId, this.task, this.mode, overrides).subscribe({
      next: ({ runId }) => this.listen(runId),
      error: (e) => { this.error = errMsg(e); this.running = false; this.status = 'error'; },
    });
  }

  private listen(runId: string) {
    this.streamer.stream(runId).subscribe({
      next: (ev) => {
        if (ev.type === 'delta') {
          if (this.streamingAgent !== ev.agent) { this.streamingAgent = ev.agent; this.streamingText = ''; }
          this.streamingText += ev.text;
        } else if (ev.type === 'step') {
          this.steps.push({ agent: ev.agent, output: ev.output, meta: ev.meta });
          this.streamingAgent = null;
          this.streamingText = '';
        } else if (ev.type === 'done') { this.finalOutput = ev.output; this.status = 'done'; }
        else if (ev.type === 'failed') { this.error = ev.message; this.status = 'error'; }
      },
      complete: () => { this.running = false; this.loadHistory(); },
      error: () => { this.running = false; this.status = 'error'; },
    });
  }
}
