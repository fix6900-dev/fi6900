export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: boolean;
  /** Return false to stop retrying for this error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public override readonly cause: unknown,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with optional jitter. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const maxMs = opts.maxMs ?? 8_000;
  const factor = opts.factor ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || (opts.shouldRetry && !opts.shouldRetry(err, attempt))) break;
      let delay = Math.min(maxMs, baseMs * factor ** attempt);
      if (opts.jitter !== false) delay = delay * (0.5 + Math.random());
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw new RetryError(`failed after ${retries + 1} attempts: ${errorMessage(lastErr)}`, lastErr, retries + 1);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions extends RetryOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
}

/** fetch + JSON + timeout + retry (4xx other than 429 are not retried). */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return withRetry(
    async (attempt) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: {
            accept: 'application/json',
            // Some CDNs (Jupiter's Cloudflare) 403 requests with a generic/empty user agent.
            'user-agent': 'fi6900-keeper/0.1 (+https://fi6900.vercel.app)',
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
            ...opts.headers,
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
        });
        if (res.status === 429) {
          // Rate limited: back off hard before the retry (Retry-After when given, else 5 s per attempt).
          const ra = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5_000 * (attempt + 1));
        }
        if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      retries: opts.retries ?? 3,
      baseMs: opts.baseMs,
      maxMs: opts.maxMs,
      shouldRetry: (err) =>
        !(err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429),
      onRetry: opts.onRetry,
    },
  );
}
