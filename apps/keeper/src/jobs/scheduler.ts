/** Interval + cron scheduler with per-job locks, structured logs and next-run introspection. */
import cron, { type ScheduledTask } from 'node-cron';
import { childLogger } from '../util/logger.js';
import { LockSet } from '../util/lock.js';

const log = childLogger('scheduler');

export type JobFn = () => Promise<unknown>;

interface JobRecord {
  name: string;
  kind: 'interval' | 'cron';
  spec: string;
  fn: JobFn;
  everyMs: number;
  runImmediately: boolean;
  timer?: NodeJS.Timeout;
  task?: ScheduledTask;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
}

export interface JobStatus {
  kind: string;
  spec: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
}

export class Scheduler {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly locks = new LockSet();
  private running = false;

  private register(name: string, rec: Omit<JobRecord, 'name' | 'nextRunAt' | 'lastRunAt' | 'lastDurationMs' | 'lastError' | 'runs' | 'failures'>): JobRecord {
    if (this.jobs.has(name)) throw new Error(`job ${name} already registered`);
    const j: JobRecord = { name, ...rec, nextRunAt: null, lastRunAt: null, lastDurationMs: null, lastError: null, runs: 0, failures: 0 };
    this.jobs.set(name, j);
    return j;
  }

  addInterval(name: string, everyMs: number, fn: JobFn, opts: { runImmediately?: boolean } = {}): void {
    const j = this.register(name, { kind: 'interval', spec: `${everyMs}ms`, fn, everyMs, runImmediately: opts.runImmediately ?? false });
    if (this.running) this.startInterval(j);
  }

  addCron(name: string, expr: string, fn: JobFn): void {
    if (!cron.validate(expr)) throw new Error(`invalid cron for ${name}: ${expr}`);
    const j = this.register(name, { kind: 'cron', spec: expr, fn, everyMs: 0, runImmediately: false });
    if (this.running) this.startCron(j);
  }

  start(): void {
    this.running = true;
    for (const j of this.jobs.values()) {
      if (j.kind === 'interval') this.startInterval(j);
      else this.startCron(j);
    }
    log.info({ jobs: [...this.jobs.values()].map((j) => `${j.name}@${j.spec}`) }, 'scheduler started');
  }

  stop(): void {
    this.running = false;
    for (const j of this.jobs.values()) {
      if (j.timer) clearInterval(j.timer);
      j.task?.stop();
    }
    log.info('scheduler stopped');
  }

  nextRun(name: string): Date | null {
    return this.jobs.get(name)?.nextRunAt ?? null;
  }

  status(): Record<string, JobStatus> {
    const out: Record<string, JobStatus> = {};
    for (const j of this.jobs.values()) {
      out[j.name] = {
        kind: j.kind,
        spec: j.spec,
        nextRunAt: j.nextRunAt?.toISOString() ?? null,
        lastRunAt: j.lastRunAt?.toISOString() ?? null,
        lastDurationMs: j.lastDurationMs,
        lastError: j.lastError,
        runs: j.runs,
        failures: j.failures,
      };
    }
    return out;
  }

  /** Runs a job now (respecting its lock). Returns false if it was already running. */
  async runNow(name: string): Promise<boolean> {
    const j = this.jobs.get(name);
    if (!j) throw new Error(`unknown job ${name}`);
    return this.execute(j);
  }

  private startInterval(j: JobRecord): void {
    j.nextRunAt = new Date(Date.now() + (j.runImmediately ? 0 : j.everyMs));
    j.timer = setInterval(() => {
      j.nextRunAt = new Date(Date.now() + j.everyMs);
      void this.execute(j);
    }, j.everyMs);
    j.timer.unref?.();
    if (j.runImmediately) {
      void this.execute(j).then(() => {
        j.nextRunAt = new Date(Date.now() + j.everyMs);
      });
    }
  }

  private startCron(j: JobRecord): void {
    j.task = cron.schedule(j.spec, () => void this.execute(j), { timezone: 'UTC' });
    j.nextRunAt = this.cronNext(j);
  }

  private cronNext(j: JobRecord): Date | null {
    try {
      const t = j.task as unknown as { getNextRun?: () => Date | null };
      return t?.getNextRun?.() ?? null;
    } catch {
      return null;
    }
  }

  private async execute(j: JobRecord): Promise<boolean> {
    if (!this.locks.tryAcquire(j.name)) {
      log.warn({ job: j.name }, 'previous run still in progress; skipping');
      return false;
    }
    const t0 = Date.now();
    j.lastRunAt = new Date(t0);
    j.runs++;
    try {
      const result = await j.fn();
      j.lastDurationMs = Date.now() - t0;
      j.lastError = null;
      log.info({ job: j.name, ms: j.lastDurationMs, result: summarize(result) }, 'job ok');
    } catch (err) {
      j.lastDurationMs = Date.now() - t0;
      j.failures++;
      j.lastError = (err as Error).message;
      log.error({ job: j.name, ms: j.lastDurationMs, err: j.lastError }, 'job failed');
    } finally {
      this.locks.release(j.name);
      if (j.kind === 'cron') j.nextRunAt = this.cronNext(j);
    }
    return true;
  }
}

function summarize(v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object') return v;
  const s = JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return s.length > 400 ? s.slice(0, 400) + '...' : JSON.parse(s);
}
