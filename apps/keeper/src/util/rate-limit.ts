import { sleep } from './retry.js';

/**
 * Minimal client-side rate limiter: serialises callers and enforces a minimum interval between
 * request starts. Used for the public Jupiter tier (lite-api.jup.ag, ~60 req/min per IP) so a
 * methodology run with 150 impact quotes does not degrade into 429 storms. One instance per host.
 */
export class RateLimiter {
  private last = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private minIntervalMs: number) {}

  get intervalMs(): number {
    return this.minIntervalMs;
  }

  setInterval(ms: number): void {
    this.minIntervalMs = Math.max(0, ms);
  }

  /** Resolves when the caller may start its request. Callers are served FIFO. */
  acquire(): Promise<void> {
    const next = this.queue.then(async () => {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
    });
    // keep the chain alive even if a caller is rejected upstream
    this.queue = next.catch(() => undefined);
    return next;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }
}

/** No-op limiter for tests / paid tiers. */
export const NO_LIMIT = new RateLimiter(0);
