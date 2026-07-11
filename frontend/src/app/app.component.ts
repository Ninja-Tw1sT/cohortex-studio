import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ApiService } from './core/api.service';
import { AuthService } from './core/auth.service';
import { Agent } from './core/models';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="brand">COHORTEX<span>·STUDIO</span></div>
      <nav>
        <a routerLink="/crews" routerLinkActive="active">Crews</a>
        <a routerLink="/wizard" routerLinkActive="active">Wizard</a>
        <a routerLink="/agents" routerLinkActive="active">Agents</a>
        <a routerLink="/tool-shed" routerLinkActive="active">Tool Shed</a>
        <a routerLink="/runs" routerLinkActive="active">Run</a>
        <a routerLink="/stats" routerLinkActive="active">Usage</a>
        <a routerLink="/llm-config" routerLinkActive="active">LLM Config</a>
      </nav>
      <div class="tag">// visual multi-agent studio</div>
      <div class="auth" *ngIf="auth.ready()">
        <ng-container *ngIf="auth.user() as u; else signedOut">
          <img [src]="u.photoURL" class="avatar" *ngIf="u.photoURL" />
          <span class="who">{{ u.displayName || u.email }}</span>
          <button class="ghost" (click)="auth.signOutUser()">Sign out</button>
        </ng-container>
        <ng-template #signedOut>
          <button class="primary" (click)="auth.signIn()">Sign in with Google</button>
        </ng-template>
      </div>
    </header>
    <div class="roster" *ngIf="agents.length">
      <span class="roster-item" *ngFor="let a of agents">
        <strong [style.color]="a.color || 'var(--violet)'">{{ a.name }}</strong>
        <span class="muted">({{ a.role || 'agent' }})</span>
      </span>
    </div>
    <main class="wrap"><router-outlet></router-outlet></main>
  `,
  styles: [`
    .roster {
      display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline;
      padding: 8px 20px; background: var(--panel); border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .roster-item { display: inline-flex; gap: 4px; align-items: baseline; white-space: nowrap; }
  `],
})
export class AppComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  agents: Agent[] = [];

  ngOnInit() {
    this.api.agents().subscribe({ next: (a) => (this.agents = a) });
  }
}
