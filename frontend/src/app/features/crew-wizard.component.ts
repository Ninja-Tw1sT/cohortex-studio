import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { downloadJson, readJsonFile, stripMeta } from '../core/json-io';
import { LlmConfigService } from '../core/llm-config.service';
import { Agent, Crew, CrewTemplate, CrewTemplateAgent, TOPOLOGIES, Tool, Topology } from '../core/models';

const errMsg = (e: any) => e?.error?.error || e?.message || 'request failed';
type Step = 'pick' | 'review' | 'credentials' | 'confirm';

interface WizardAgent extends CrewTemplateAgent {
  credentialId: string | null;
  // UI-only: which tool category's drawer is expanded for this agent. Never
  // sent to the backend — createAndGo() only reads name/role/goal/tools.
  openCategory: string | null;
}

@Component({
  selector: 'app-crew-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="card">
      <h2>Crew Wizard</h2>
      <p class="muted">Pick a starter crew, review and tune it, assign credentials, then go straight to running it.</p>
      <div class="chips" style="margin-bottom:6px">
        <span class="badge" [class.cyan]="step==='pick'">1. Pick</span>
        <span class="badge" [class.cyan]="step==='review'">2. Review</span>
        <span class="badge" [class.cyan]="step==='credentials'">3. Credentials</span>
        <span class="badge" [class.cyan]="step==='confirm'">4. Create</span>
      </div>
      <p class="err" *ngIf="error">{{ error }}</p>
    </div>

    <!-- Step 1: pick / create / import -->
    <ng-container *ngIf="step==='pick'">
      <div class="card">
        <h3>Starter crews</h3>
        <table>
          <tr><th>Name</th><th>Description</th><th>Agents</th><th></th></tr>
          <tr *ngFor="let t of templates">
            <td><span class="badge violet">{{ t.name }}</span></td>
            <td class="muted">{{ t.description }}</td>
            <td class="muted">{{ t.agents.length }}</td>
            <td style="text-align:right">
              <button class="ghost" (click)="exportTemplate(t)">Export</button>
              <button class="ghost" *ngIf="t.id && auth.user()" (click)="deleteTemplate(t)">Del</button>
              <button class="primary" (click)="pickTemplate(t)">Use this</button>
            </td>
          </tr>
        </table>
        <p *ngIf="!templates.length" class="muted">Loading…</p>
      </div>

      <div class="card" *ngIf="auth.user()">
        <h3>
          Create a custom template
          <button class="ghost" style="float:right" (click)="fileInput.click()">Import JSON</button>
          <input #fileInput type="file" accept="application/json" style="display:none" (change)="importTemplate($event)" />
        </h3>
        <div class="row">
          <div><label>Name</label><input [(ngModel)]="customDraft.name" placeholder="my_custom_crew" /></div>
          <div><label>Topology</label>
            <select [(ngModel)]="customDraft.topology">
              <option *ngFor="let tp of topologies" [ngValue]="tp">{{ tp }}</option>
            </select>
          </div>
        </div>
        <label>Description</label>
        <input [(ngModel)]="customDraft.description" placeholder="What this crew is for" />
        <label>Agents</label>
        <div *ngFor="let a of customDraft.agents; let i = index" class="row" style="align-items:flex-end">
          <div><label>Name</label><input [(ngModel)]="a.name" placeholder="agent_name" /></div>
          <div><label>Role</label><input [(ngModel)]="a.role" placeholder="Role" /></div>
          <div style="flex:2"><label>Goal</label><input [(ngModel)]="a.goal" placeholder="What this agent should do" /></div>
          <div style="flex:0 0 auto"><button class="danger" (click)="removeCustomAgent(i)">Remove</button></div>
        </div>
        <button class="ghost" style="margin-top:8px" (click)="addCustomAgent()">+ Add agent</button>
        <div style="margin-top:14px">
          <button class="primary" (click)="saveCustomTemplate()" [disabled]="!customDraft.name || !customDraft.agents.length">
            Save template &amp; continue ▸
          </button>
        </div>
      </div>
    </ng-container>

    <!-- Step 2: review + tune agents and crew shape -->
    <div class="card" *ngIf="step==='review' && selected">
      <h3>Review — {{ selected.name }}</h3>
      <div class="row">
        <div><label>Crew name</label><input [(ngModel)]="crewName" /></div>
        <div><label>Topology</label>
          <select [(ngModel)]="topology">
            <option *ngFor="let tp of topologies" [ngValue]="tp">{{ tp }}</option>
          </select>
        </div>
        <div *ngIf="topology==='supervisor'"><label>Supervisor</label>
          <select [(ngModel)]="supervisorName">
            <option [ngValue]="null">— pick —</option>
            <option *ngFor="let a of wizardAgents" [ngValue]="a.name">{{ a.name }}</option>
          </select>
        </div>
      </div>

      <div *ngFor="let a of wizardAgents; let i = index" class="step" style="margin-top:10px">
        <div class="row">
          <div><label>Name</label><input [(ngModel)]="a.name" /></div>
          <div><label>Role</label><input [(ngModel)]="a.role" /></div>
        </div>
        <label>Goal</label>
        <textarea [(ngModel)]="a.goal"></textarea>
        <label>Tools <span class="muted" *ngIf="a.tools.length">({{ a.tools.length }} selected)</span></label>
        <select [(ngModel)]="a.openCategory">
          <option [ngValue]="null">— choose a category —</option>
          <option *ngFor="let c of toolCategories()" [ngValue]="c">{{ c }} ({{ toolsInCategory(c).length }})</option>
        </select>
        <div class="checks" *ngIf="a.openCategory" style="margin-top:6px">
          <label *ngFor="let tool of toolsInCategory(a.openCategory)">
            <input type="checkbox" [checked]="a.tools.includes(tool.name)" (change)="toggleAgentTool(a, tool.name)" />
            {{ tool.name }}
          </label>
        </div>
        <div class="chips" *ngIf="a.tools.length" style="margin-top:6px">
          <span class="badge cyan" *ngFor="let tn of a.tools">{{ tn }}</span>
        </div>
        <span *ngIf="!tools.length" class="muted">No tools cataloged yet — add some in Tool Shed first, or skip for now.</span>
        <button class="danger" style="margin-top:8px" (click)="removeWizardAgent(i)" [disabled]="wizardAgents.length <= 1">Remove agent</button>
      </div>
      <button class="ghost" style="margin-top:10px" (click)="addWizardAgent()">+ Add agent</button>

      <div style="margin-top:16px; display:flex; gap:8px">
        <button class="ghost" (click)="step='pick'">Back</button>
        <button class="primary" (click)="step='credentials'"
          [disabled]="!crewName || !wizardAgents.length || (topology==='supervisor' && !supervisorName)">
          Next: assign credentials ▸
        </button>
      </div>
    </div>

    <!-- Step 3: LLM credential assignment -->
    <div class="card" *ngIf="step==='credentials'">
      <h3>Assign LLM credentials</h3>
      <p class="muted" *ngIf="!llmConfig.credentials().length">
        No saved credentials yet — add one in <a routerLink="/llm-config">LLM Config</a>, or skip and assign later on the Run page.
      </p>
      <div class="row" *ngFor="let a of wizardAgents">
        <div><label>{{ a.name }} <span class="muted">({{ a.role || 'agent' }})</span></label>
          <select [(ngModel)]="a.credentialId">
            <option [ngValue]="null">— none (assign later) —</option>
            <option *ngFor="let c of llmConfig.credentials()" [ngValue]="c.id">{{ c.label }} ({{ c.backend }})</option>
          </select>
        </div>
      </div>
      <div style="margin-top:16px; display:flex; gap:8px">
        <button class="ghost" (click)="step='review'">Back</button>
        <button class="primary" (click)="step='confirm'">Next: review &amp; create ▸</button>
      </div>
    </div>

    <!-- Step 4: confirm + create -->
    <div class="card" *ngIf="step==='confirm'">
      <h3>Create &amp; go</h3>
      <p class="muted">
        Crew <strong>{{ crewName }}</strong> ({{ topology }}) with {{ wizardAgents.length }} agent(s).
        {{ agentsToCreate().length }} new agent(s) will be created; {{ wizardAgents.length - agentsToCreate().length }} already exist and will be reused.
      </p>
      <ul>
        <li *ngFor="let a of wizardAgents">
          <strong>{{ a.name }}</strong> — {{ a.role || 'agent' }}
          <span *ngIf="!existingNames().has(a.name)" class="badge cyan">new</span>
          <span *ngIf="a.tools.length" class="muted"> · tools: {{ a.tools.join(', ') }}</span>
          <span *ngIf="a.credentialId" class="muted"> · credential assigned</span>
        </li>
      </ul>
      <div style="margin-top:12px; display:flex; gap:8px">
        <button class="ghost" (click)="step='credentials'" [disabled]="creating">Back</button>
        <button class="primary" (click)="createAndGo()" [disabled]="creating">
          {{ creating ? 'Creating…' : 'Create & Go ▸' }}
        </button>
      </div>
    </div>
  `,
})
export class CrewWizardComponent implements OnInit {
  private api = inject(ApiService);
  private router = inject(Router);
  auth = inject(AuthService);
  llmConfig = inject(LlmConfigService);

  topologies = TOPOLOGIES;
  step: Step = 'pick';
  error = '';
  creating = false;

  templates: CrewTemplate[] = [];
  agents: Agent[] = [];
  tools: Tool[] = [];

  selected: CrewTemplate | null = null;
  crewName = '';
  topology: Topology = 'sequential';
  supervisorName: string | null = null;
  wizardAgents: WizardAgent[] = [];

  customDraft: { name: string; description: string; topology: Topology; agents: CrewTemplateAgent[] } = this.blankCustom();

  ngOnInit() {
    this.api.crewTemplates().subscribe({ next: (t) => (this.templates = t), error: (e) => (this.error = errMsg(e)) });
    this.api.agents().subscribe({ next: (a) => (this.agents = a) });
    this.api.tools().subscribe({ next: (t) => (this.tools = t) });
  }

  blankCustom() {
    return { name: '', description: '', topology: 'sequential' as Topology, agents: [] as CrewTemplateAgent[] };
  }

  addCustomAgent() {
    this.customDraft.agents.push({ name: '', role: '', goal: '', tools: [] });
  }
  removeCustomAgent(i: number) {
    this.customDraft.agents.splice(i, 1);
  }

  saveCustomTemplate() {
    this.error = '';
    this.api.createCrewTemplate(this.customDraft).subscribe({
      next: (t) => {
        this.templates = [...this.templates, t];
        this.customDraft = this.blankCustom();
        this.pickTemplate(t);
      },
      error: (e) => (this.error = errMsg(e)),
    });
  }

  async importTemplate(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = stripMeta(await readJsonFile(file)) as Partial<CrewTemplate>;
      this.api.createCrewTemplate(data).subscribe({
        next: (t) => { this.templates = [...this.templates, t]; this.pickTemplate(t); },
        error: (e) => (this.error = errMsg(e)),
      });
    } catch (e: any) {
      this.error = `import failed: ${e.message}`;
    } finally {
      input.value = '';
    }
  }

  exportTemplate(t: CrewTemplate) {
    downloadJson(`${t.name}.crew-template.json`, stripMeta(t));
  }

  deleteTemplate(t: CrewTemplate) {
    if (!t.id || !confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    this.api.deleteCrewTemplate(t.id).subscribe({
      next: () => (this.templates = this.templates.filter((x) => x.id !== t.id)),
      error: (e) => (this.error = errMsg(e)),
    });
  }

  pickTemplate(t: CrewTemplate) {
    this.selected = t;
    this.crewName = t.name;
    this.topology = t.topology;
    this.supervisorName = null;
    this.wizardAgents = t.agents.map((a) => ({ ...a, tools: [...a.tools], credentialId: null, openCategory: null }));
    this.error = '';
    this.step = 'review';
  }

  toggleAgentTool(a: WizardAgent, toolName: string) {
    const i = a.tools.indexOf(toolName);
    if (i >= 0) a.tools.splice(i, 1); else a.tools.push(toolName);
  }

  toolCategories(): string[] {
    return [...new Set(this.tools.map((t) => t.category || 'General'))].sort();
  }

  toolsInCategory(c: string): Tool[] {
    return this.tools.filter((t) => (t.category || 'General') === c);
  }

  addWizardAgent() {
    this.wizardAgents.push({ name: '', role: '', goal: '', tools: [], credentialId: null, openCategory: null });
  }
  removeWizardAgent(i: number) {
    if (this.wizardAgents.length <= 1) return;
    this.wizardAgents.splice(i, 1);
  }

  existingNames(): Set<string> {
    return new Set(this.agents.map((a) => a.name));
  }

  agentsToCreate(): WizardAgent[] {
    const existing = this.existingNames();
    return this.wizardAgents.filter((a) => !existing.has(a.name));
  }

  createAndGo() {
    this.error = '';
    this.creating = true;
    const toCreate = this.agentsToCreate();
    const createAll: Observable<Agent[] | null> = toCreate.length
      ? forkJoin(toCreate.map((a) => this.api.createAgent({ name: a.name, role: a.role, goal: a.goal, tools: a.tools })))
      : of(null);

    createAll.subscribe({
      next: () => {
        const body: Partial<Crew> = {
          name: this.crewName,
          topology: this.topology,
          agentNames: this.wizardAgents.map((a) => a.name),
          supervisorName: this.topology === 'supervisor' ? this.supervisorName : null,
          maxRounds: 4,
          maxHandoffChars: null,
        };
        this.api.createCrew(body).subscribe({
          next: (crew) => {
            const assignments: Record<string, string | null> = {};
            for (const a of this.wizardAgents) assignments[a.name] = a.credentialId;
            this.creating = false;
            this.router.navigate(['/runs'], { queryParams: { crewId: crew.id }, state: { assignments } });
          },
          error: (e) => { this.error = errMsg(e); this.creating = false; },
        });
      },
      error: (e) => { this.error = errMsg(e); this.creating = false; },
    });
  }
}
