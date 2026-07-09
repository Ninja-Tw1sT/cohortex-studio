import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { RunStreamService } from '../core/run-stream.service';
import { Crew, Run, RunStep } from '../core/models';

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-runs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <h2>Run a crew</h2>
      <p class="err" *ngIf="error">{{ error }}</p>
      <div class="row">
        <div><label>Crew</label>
          <select [(ngModel)]="crewId">
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
      <label>Task</label>
      <textarea [(ngModel)]="task" placeholder="Explain why vector databases matter for AI applications"></textarea>
      <div style="margin-top:12px">
        <button class="primary" (click)="run()" [disabled]="!crewId || !task || running || (mode==='live' && !auth.user())">
          {{ running ? 'Running…' : 'Run ▸' }}
        </button>
        <span *ngIf="status" class="badge" [class.green]="status==='done'" [class.magenta]="status==='error'" [class.cyan]="status==='running'" style="margin-left:10px">{{ status }}</span>
        <span *ngIf="mode==='live' && !auth.user()" class="muted" style="margin-left:10px">sign in to run live — try replay to preview</span>
      </div>
    </div>

    <div class="card" *ngIf="steps.length || finalOutput || running">
      <h3>Live progress</h3>
      <div class="step" *ngFor="let s of steps">
        <div class="who">{{ s.agent }}</div>
        <div>{{ s.output }}</div>
      </div>
      <div class="step muted" *ngIf="running && !steps.length">// waiting for the first agent…</div>
      <div class="step final" *ngIf="finalOutput">
        <div class="who" style="color:var(--cyan)">FINAL</div>
        <div>{{ finalOutput }}</div>
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

  crews: Crew[] = [];
  history: Run[] = [];
  crewId = '';
  task = '';
  mode: 'live' | 'replay' = 'replay';

  running = false;
  status = '';
  steps: RunStep[] = [];
  finalOutput = '';
  error = '';

  ngOnInit() {
    this.api.crews().subscribe({ next: (c) => (this.crews = c) });
    this.loadHistory();
  }

  loadHistory() { this.api.runs().subscribe({ next: (r) => (this.history = r) }); }

  run() {
    this.error = '';
    this.steps = [];
    this.finalOutput = '';
    this.running = true;
    this.status = 'running';

    this.api.createRun(this.crewId, this.task, this.mode).subscribe({
      next: ({ runId }) => this.listen(runId),
      error: (e) => { this.error = errMsg(e); this.running = false; this.status = 'error'; },
    });
  }

  private listen(runId: string) {
    this.streamer.stream(runId).subscribe({
      next: (ev) => {
        if (ev.type === 'step') this.steps.push({ agent: ev.agent, output: ev.output });
        else if (ev.type === 'done') { this.finalOutput = ev.output; this.status = 'done'; }
        else if (ev.type === 'failed') { this.error = ev.message; this.status = 'error'; }
      },
      complete: () => { this.running = false; this.loadHistory(); },
      error: () => { this.running = false; this.status = 'error'; },
    });
  }
}
