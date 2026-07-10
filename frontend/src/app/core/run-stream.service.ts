import { Injectable, NgZone } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { RunEvent } from './models';

/**
 * Consumes the Express SSE endpoint (`/api/runs/:id/stream`) as an Observable of
 * typed RunEvents. Server-sent named events are `delta` / `step` / `done` /
 * `failed` (deliberately NOT `error`, which would collide with EventSource's
 * transport error event). Completes on `done`/`failed`.
 */
@Injectable({ providedIn: 'root' })
export class RunStreamService {
  constructor(private api: ApiService, private zone: NgZone) {}

  stream(runId: string): Observable<RunEvent> {
    return new Observable<RunEvent>((sub) => {
      const es = new EventSource(this.api.streamUrl(runId));

      const handle = (type: 'delta' | 'step' | 'done' | 'failed') => (e: MessageEvent) =>
        this.zone.run(() => {
          const data = e.data ? JSON.parse(e.data) : {};
          sub.next({ type, ...data } as RunEvent);
          if (type === 'done' || type === 'failed') {
            es.close();
            sub.complete();
          }
        });

      es.addEventListener('delta', handle('delta') as EventListener);
      es.addEventListener('step', handle('step') as EventListener);
      es.addEventListener('done', handle('done') as EventListener);
      es.addEventListener('failed', handle('failed') as EventListener);

      // Transport-level errors (connection dropped) — surface once, then stop.
      es.addEventListener('error', () =>
        this.zone.run(() => {
          if (es.readyState === EventSource.CLOSED) {
            sub.complete();
          }
        })
      );

      return () => es.close();
    });
  }
}
