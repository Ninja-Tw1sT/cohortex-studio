import { Routes } from '@angular/router';
import { CrewsComponent } from './features/crews.component';
import { AgentsComponent } from './features/agents.component';
import { RunsComponent } from './features/runs.component';
import { LlmConfigComponent } from './features/llm-config.component';

export const routes: Routes = [
  { path: '', redirectTo: 'crews', pathMatch: 'full' },
  { path: 'crews', component: CrewsComponent },
  { path: 'agents', component: AgentsComponent },
  { path: 'runs', component: RunsComponent },
  { path: 'llm-config', component: LlmConfigComponent },
  { path: '**', redirectTo: 'crews' },
];
