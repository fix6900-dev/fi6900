/** Per-key mutual exclusion; `tryAcquire` is non-blocking (jobs skip overlapping runs). */
export class LockSet {
  private readonly held = new Set<string>();

  tryAcquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  release(key: string): void {
    this.held.delete(key);
  }

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  /** Runs fn under the lock, or returns undefined if the lock is already held. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (!this.tryAcquire(key)) return undefined;
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }
}
