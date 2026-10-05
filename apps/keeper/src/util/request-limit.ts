/** Fixed-window in-memory request limiter keyed by an arbitrary string (per IP / wallet) for the public POST routes. */
export class RequestLimiter {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();
  constructor(private readonly o: { windowMs: number; max: number }) {}

  /** Records a hit; returns false when the key is over its budget for the current window. */
  hit(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) this.sweep(now);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + this.o.windowMs });
      return true;
    }
    cur.n++;
    return cur.n <= this.o.max;
  }

  sweep(now = Date.now()): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
