import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../core/api.service';
import { CrewUsage, RunStats } from '../core/models';

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h2>Usage</h2>
      <p class="muted">Token totals aggregated from every completed run's step data — nothing new tracked, just added up.</p>
      <p class="err" *ngIf="error">{{ error }}</p>

      <ng-container *ngIf="stats as s">
        <div class="row">
          <div class="stat"><div class="stat-num">{{ s.runCount }}</div><div class="muted">completed runs</div></div>
          <div class="stat"><div class="stat-num">{{ s.totals.promptTokens | number }}</div><div class="muted">prompt tokens</div></div>
          <div class="stat"><div class="stat-num">{{ s.totals.completionTokens | number }}</div><div class="muted">completion tokens</div></div>
          <div class="stat"><div class="stat-num cyan">{{ s.totals.totalTokens | number }}</div><div class="muted">total tokens</div></div>
        </div>

        <h3 style="margin-top:20px">By crew</h3>
        <table>
          <tr><th>Crew</th><th>Steps</th><th>Prompt</th><th>Completion</th><th>Total</th><th></th></tr>
          <tr *ngFor="let c of s.byCrew">
            <td>{{ c.crewName }}</td>
            <td class="muted">{{ c.steps }}</td>
            <td class="muted">{{ c.promptTokens | number }}</td>
            <td class="muted">{{ c.completionTokens | number }}</td>
            <td><span class="badge cyan">{{ c.totalTokens | number }}</span></td>
            <td style="width:40%">
              <div class="bar-track"><div class="bar-fill" [style.width.%]="pctOf(c)"></div></div>
            </td>
          </tr>
        </table>
        <p *ngIf="!s.byCrew.length" class="muted">No completed runs yet — run a crew to see usage here.</p>
      </ng-container>
    </div>
  `,
  styles: [`
    .stat { text-align: center; }
    .stat-num { font-size: 28px; font-weight: 700; color: var(--text); }
    .stat-num.cyan { color: var(--cyan); }
    .bar-track { height: 8px; border-radius: 4px; background: var(--border); overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--violet), var(--magenta)); }
  `],
})
export class StatsComponent implements OnInit {
  private api = inject(ApiService);

  stats: RunStats | null = null;
  error = '';

  ngOnInit() {
    this.api.runStats().subscribe({ next: (s) => (this.stats = s), error: (e) => (this.error = errMsg(e)) });
  }

  pctOf(c: CrewUsage): number {
    const max = Math.max(...(this.stats?.byCrew.map((x) => x.totalTokens) || [1]), 1);
    return (c.totalTokens / max) * 100;
  }
}
