import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="brand">COHORTEX<span>·STUDIO</span></div>
      <nav>
        <a routerLink="/crews" routerLinkActive="active">Crews</a>
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
    <main class="wrap"><router-outlet></router-outlet></main>
  `,
})
export class AppComponent {
  auth = inject(AuthService);
}
