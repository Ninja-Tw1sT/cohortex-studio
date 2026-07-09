import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Agent, Crew, TOPOLOGIES, Topology } from '../core/models';

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';

@Component({
  selector: 'app-crews',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="card">
      <h2>Crews</h2>
      <p class="muted">Compose agents into a crew and pick how they collaborate. No YAML — it's all config.</p>
      <table>
        <tr><th>Name</th><th>Topology</th><th>Agents</th><th></th></tr>
        <tr *ngFor="let c of crews">
          <td>{{ c.name }}</td>
          <td><span class="badge violet">{{ c.topology }}</span></td>
          <td class="muted">
            {{ c.agentNames.join(' → ') }}
            <span *ngIf="c.supervisorName" class="badge magenta">super: {{ c.supervisorName }}</span>
          </td>
          <td style="text-align:right">
            <ng-container *ngIf="auth.user(); else noAccess">
              <button class="ghost" (click)="edit(c)">Edit</button>
              <button class="danger" (click)="remove(c)">Del</button>
            </ng-container>
            <ng-template #noAccess><span class="muted">—</span></ng-template>
          </td>
        </tr>
      </table>
      <p *ngIf="!crews.length" class="muted">No crews yet — build one below.</p>
    </div>

    <div class="card" *ngIf="auth.user(); else signInPrompt">
      <h3>{{ draft.id ? 'Edit crew' : 'Build a crew' }}</h3>
      <p class="err" *ngIf="error">{{ error }}</p>
      <div class="row">
        <div><label>Name</label><input [(ngModel)]="draft.name" placeholder="research_team" /></div>
        <div><label>Topology</label>
          <select [(ngModel)]="draft.topology">
            <option *ngFor="let t of topologies" [ngValue]="t">{{ t }}</option>
          </select>
        </div>
        <div *ngIf="draft.topology === 'supervisor'"><label>Supervisor</label>
          <select [(ngModel)]="draft.supervisorName">
            <option [ngValue]="null">— pick —</option>
            <option *ngFor="let a of agents" [ngValue]="a.name">{{ a.name }}</option>
          </select>
        </div>
        <div *ngIf="draft.topology === 'supervisor'"><label>Max rounds</label>
          <input type="number" min="1" max="20" [(ngModel)]="draft.maxRounds" />
        </div>
      </div>

      <label>Agents {{ draft.topology === 'sequential' ? '(run in this order)' : '' }}</label>
      <div class="checks">
        <label *ngFor="let a of agents">
          <input type="checkbox" [checked]="isSelected(a.name)" (change)="toggle(a.name)" />
          {{ a.name }} <span class="muted">· {{ a.role || 'agent' }}</span>
        </label>
        <span *ngIf="!agents.length" class="muted">Create agents first, then compose them here.</span>
      </div>

      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="primary" (click)="save()" [disabled]="!draft.name || !draft.agentNames.length">Save crew</button>
        <button class="ghost" (click)="reset()" *ngIf="draft.id">Cancel</button>
      </div>
    </div>
    <ng-template #signInPrompt>
      <div class="card">
        <p class="muted">Sign in to build your own crews. Demo crews above are read-only.</p>
        <button class="primary" (click)="auth.signIn()">Sign in with Google</button>
      </div>
    </ng-template>
  `,
})
export class CrewsComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  topologies = TOPOLOGIES;
  crews: Crew[] = [];
  agents: Agent[] = [];
  draft: Partial<Crew> & { agentNames: string[] } = this.blank();
  error = '';

  ngOnInit() { this.load(); }

  load() {
    this.api.agents().subscribe({ next: (a) => (this.agents = a) });
    this.api.crews().subscribe({ next: (c) => (this.crews = c), error: (e) => (this.error = errMsg(e)) });
  }

  blank() {
    return { name: '', topology: 'sequential' as Topology, agentNames: [] as string[], supervisorName: null as string | null, maxRounds: 4 };
  }

  reset() { this.draft = this.blank(); this.error = ''; }

  edit(c: Crew) { this.draft = { ...c, agentNames: [...c.agentNames] }; }

  isSelected(name: string) { return this.draft.agentNames.includes(name); }
  toggle(name: string) {
    const set = this.draft.agentNames;
    const i = set.indexOf(name);
    if (i >= 0) set.splice(i, 1); else set.push(name);
  }

  save() {
    const d = this.draft;
    const body: Partial<Crew> = {
      name: d.name!, topology: d.topology as Topology, agentNames: d.agentNames,
      supervisorName: d.topology === 'supervisor' ? d.supervisorName ?? null : null,
      maxRounds: Number(d.maxRounds ?? 4),
    };
    const req = d.id ? this.api.updateCrew(d.id, body) : this.api.createCrew(body);
    req.subscribe({ next: () => { this.reset(); this.load(); }, error: (e) => (this.error = errMsg(e)) });
  }

  remove(c: Crew) {
    if (c.id) this.api.deleteCrew(c.id).subscribe({ next: () => this.load(), error: (e) => (this.error = errMsg(e)) });
  }
}
