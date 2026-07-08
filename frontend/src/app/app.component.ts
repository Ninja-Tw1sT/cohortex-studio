import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="brand">COHORTEX<span>·STUDIO</span></div>
      <nav>
        <a routerLink="/crews" routerLinkActive="active">Crews</a>
        <a routerLink="/agents" routerLinkActive="active">Agents</a>
        <a routerLink="/runs" routerLinkActive="active">Run</a>
      </nav>
      <div class="tag">// visual multi-agent studio</div>
    </header>
    <main class="wrap"><router-outlet></router-outlet></main>
  `,
})
export class AppComponent {}
