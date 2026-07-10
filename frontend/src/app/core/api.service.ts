import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Agent, Crew, GeneratedTool, LlmConfig, Run, RunStats, Tool } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = `${environment.apiBase}/api`;

  constructor(private http: HttpClient) {}

  // agents
  agents(): Observable<Agent[]> { return this.http.get<Agent[]>(`${this.base}/agents`); }
  createAgent(a: Partial<Agent>): Observable<Agent> { return this.http.post<Agent>(`${this.base}/agents`, a); }
  updateAgent(id: string, a: Partial<Agent>): Observable<Agent> { return this.http.put<Agent>(`${this.base}/agents/${id}`, a); }
  deleteAgent(id: string): Observable<unknown> { return this.http.delete(`${this.base}/agents/${id}`); }

  // tools (Tool Shed)
  tools(): Observable<Tool[]> { return this.http.get<Tool[]>(`${this.base}/tools`); }
  createTool(t: Partial<Tool>): Observable<Tool> { return this.http.post<Tool>(`${this.base}/tools`, t); }
  updateTool(id: string, t: Partial<Tool>): Observable<Tool> { return this.http.put<Tool>(`${this.base}/tools/${id}`, t); }
  deleteTool(id: string): Observable<unknown> { return this.http.delete(`${this.base}/tools/${id}`); }
  generateTool(description: string, llm: LlmConfig): Observable<GeneratedTool> {
    return this.http.post<GeneratedTool>(`${this.base}/tools/generate`, { description, llm });
  }

  // crews
  crews(): Observable<Crew[]> { return this.http.get<Crew[]>(`${this.base}/crews`); }
  createCrew(c: Partial<Crew>): Observable<Crew> { return this.http.post<Crew>(`${this.base}/crews`, c); }
  updateCrew(id: string, c: Partial<Crew>): Observable<Crew> { return this.http.put<Crew>(`${this.base}/crews/${id}`, c); }
  deleteCrew(id: string): Observable<unknown> { return this.http.delete(`${this.base}/crews/${id}`); }

  // runs
  runs(): Observable<Run[]> { return this.http.get<Run[]>(`${this.base}/runs`); }
  getRun(id: string): Observable<Run> { return this.http.get<Run>(`${this.base}/runs/${id}`); }
  createRun(
    crewId: string,
    task: string,
    mode: 'live' | 'replay',
    llmOverrides?: Record<string, LlmConfig>
  ): Observable<{ runId: string; status: string }> {
    return this.http.post<{ runId: string; status: string }>(`${this.base}/runs`, {
      crewId, task, mode, llmOverrides,
    });
  }
  streamUrl(runId: string): string { return `${this.base}/runs/${runId}/stream`; }
  cancelRun(runId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/runs/${runId}/cancel`, {});
  }
  runStats(): Observable<RunStats> { return this.http.get<RunStats>(`${this.base}/runs/stats`); }
}
