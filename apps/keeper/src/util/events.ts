import { EventEmitter } from 'node:events';

export type StreamEventName = 'fund' | 'holdings' | 'auction' | 'flywheel_event';

export interface StreamEvent {
  type: StreamEventName;
  ts: string;
  data: unknown;
}

/** Process-wide bus feeding the SSE endpoint. */
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  emit(type: StreamEventName, data: unknown): void {
    const ev: StreamEvent = { type, ts: new Date().toISOString(), data };
    this.emitter.emit('event', ev);
  }

  subscribe(fn: (ev: StreamEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
