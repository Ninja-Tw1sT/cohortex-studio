import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Agent, Crew } from '../core/models';

interface DiagramNode {
  name: string;
  color: string;
  x: number;
  y: number;
  state: 'pending' | 'active' | 'done';
}

interface DiagramEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Live crew topology: agents as colored nodes (reusing each agent's assigned
// swatch color from the Agents/Tool Shed pages), arrows showing hand-off
// order, current speaker glowing. Purely presentational — computes its own
// layout from crew.topology + agentNames, no state of its own.
@Component({
  selector: 'app-crew-diagram',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="diagram-wrap">
      <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="ariaLabel">
        <title>{{ ariaLabel }}</title>
        <defs>
          <marker id="cd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--dim)" />
          </marker>
          <filter id="cd-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <line *ngFor="let e of edges" [attr.x1]="e.x1" [attr.y1]="e.y1" [attr.x2]="e.x2" [attr.y2]="e.y2"
              stroke="var(--dim)" stroke-width="1.5" marker-end="url(#cd-arrow)" opacity="0.5" />
        <g *ngFor="let n of nodes">
          <circle [attr.cx]="n.x" [attr.cy]="n.y" r="26" stroke-width="2"
                  [attr.stroke]="n.color" [attr.fill]="n.color" [attr.fill-opacity]="n.state === 'active' ? 0.18 : 0"
                  [attr.filter]="n.state === 'active' ? 'url(#cd-glow)' : null"
                  [attr.opacity]="n.state === 'pending' ? 0.4 : 1" />
          <circle *ngIf="n.state === 'active'" [attr.cx]="n.x" [attr.cy]="n.y" r="4" [attr.fill]="n.color" />
          <path *ngIf="n.state === 'done'" [attr.transform]="'translate(' + (n.x - 6) + ',' + (n.y - 6) + ')'"
                d="M0 6 L4 10 L12 1" stroke="var(--dim)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          <text [attr.x]="n.x" [attr.y]="n.y + 44" text-anchor="middle" font-size="11"
                [attr.fill]="n.state === 'pending' ? 'var(--dim)' : 'var(--text)'">{{ n.name }}</text>
        </g>
      </svg>
    </div>
  `,
  styles: [`
    .diagram-wrap { overflow-x: auto; }
    svg { width: 100%; height: auto; display: block; min-width: 260px; }
  `],
})
export class CrewDiagramComponent implements OnChanges {
  @Input() crew: Crew | null = null;
  @Input() agents: Agent[] = [];
  @Input() activeAgent: string | null = null;
  @Input() completedAgents: string[] = [];

  nodes: DiagramNode[] = [];
  edges: DiagramEdge[] = [];
  width = 300;
  height = 110;
  ariaLabel = '';

  ngOnChanges() {
    this.layout();
  }

  private colorOf(name: string): string {
    return this.agents.find((a) => a.name === name)?.color || '#8a5cff';
  }

  private stateOf(name: string): 'pending' | 'active' | 'done' {
    if (this.activeAgent === name) return 'active';
    if (this.completedAgents.includes(name)) return 'done';
    return 'pending';
  }

  private layout() {
    const crew = this.crew;
    if (!crew || !crew.agentNames.length) { this.nodes = []; this.edges = []; return; }
    const names = crew.agentNames;
    const gap = 110;
    this.ariaLabel = `${crew.name} — ${crew.topology} topology`;

    if (crew.topology === 'supervisor' && crew.supervisorName) {
      this.height = 140;
      this.width = Math.max(220, names.length * gap);
      const sup: DiagramNode = { name: crew.supervisorName, color: this.colorOf(crew.supervisorName), x: this.width / 2, y: 30, state: this.stateOf(crew.supervisorName) };
      const specs: DiagramNode[] = names.map((n, i) => ({ name: n, color: this.colorOf(n), x: gap / 2 + i * gap, y: 90, state: this.stateOf(n) }));
      this.nodes = [sup, ...specs];
      this.edges = specs.map((n) => ({ x1: sup.x, y1: sup.y + 26, x2: n.x, y2: n.y - 26 }));
    } else {
      this.height = 110;
      this.width = Math.max(180, names.length * gap);
      this.nodes = names.map((n, i) => ({ name: n, color: this.colorOf(n), x: gap / 2 + i * gap, y: 70, state: this.stateOf(n) }));
      this.edges = this.nodes.slice(0, -1).map((n, i) => ({ x1: n.x + 26, y1: n.y, x2: this.nodes[i + 1].x - 26, y2: this.nodes[i + 1].y }));
    }
  }
}
