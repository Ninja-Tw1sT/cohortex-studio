import { Routes } from '@angular/router';
import { CrewsComponent } from './features/crews.component';
import { CrewWizardComponent } from './features/crew-wizard.component';
import { AgentsComponent } from './features/agents.component';
import { ToolShedComponent } from './features/tool-shed.component';
import { RunsComponent } from './features/runs.component';
import { LlmConfigComponent } from './features/llm-config.component';
import { StatsComponent } from './features/stats.component';

export const routes: Routes = [
  { path: '', redirectTo: 'crews', pathMatch: 'full' },
  { path: 'crews', component: CrewsComponent },
  { path: 'wizard', component: CrewWizardComponent },
  { path: 'agents', component: AgentsComponent },
  { path: 'tool-shed', component: ToolShedComponent },
  { path: 'runs', component: RunsComponent },
  { path: 'stats', component: StatsComponent },
  { path: 'llm-config', component: LlmConfigComponent },
  { path: '**', redirectTo: 'crews' },
];
