import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve, type ServerType } from '@hono/node-server';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import type { ApiErr, ApiOk, HistoryRange, KeeperDataProvider } from './types.js';

const log = childLogger('api');

export interface ApiOptions {
  provider: KeeperDataProvider;
  events: EventBus;
  corsOrigin: string;
  /** Bearer token for POST /v1/admin/*; admin routes answer 403 when unset. */
  adminToken?: string;
}

function ok<T>(c: Context, data: T, extra: Partial<Pick<ApiOk<T>, 'nextCursor'>> = {}): Response {
  const body: ApiOk<T> = { ok: true, data, asOf: new Date().toISOString(), ...extra };
  return c.json(body);
}

function fail(c: Context, error: string, status: 400 | 404 | 500 | 503 = 500): Response {
  const body: ApiErr = { ok: false, error };
  return c.json(body, status);
}

function parseUnits(raw: string | undefined): bigint {
  if (!raw || !/^\d+$/.test(raw)) throw new Error('units must be a positive integer (raw, 6 decimals)');
  const v = BigInt(raw);
  if (v <= 0n) throw new Error('units must be > 0');
  return v;
}

export function createApp(opts: ApiOptions): Hono {
  const app = new Hono();
  const { provider, events } = opts;

  app.use('*', cors({ origin: opts.corsOrigin === '*' ? '*' : opts.corsOrigin.split(',').map((s) => s.trim()), allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));
  app.use('*', async (c, next) => {
    const t0 = Date.now();
    await next();
    log.debug({ path: c.req.path, status: c.res.status, ms: Date.now() - t0 }, 'req');
  });
  app.onError((err, c) => {
    log.error({ err: err.message, path: c.req.path }, 'request failed');
    return fail(c, err.message);
  });
  app.notFound((c) => fail(c, `no route ${c.req.method} ${c.req.path}`, 404));

  app.get('/health', async (c) => ok(c, { status: 'ok', mode: provider.mode, ...(await provider.health()) }));

  app.get('/v1/fund', async (c) => ok(c, await provider.fund()));
  app.get('/v1/holdings', async (c) => ok(c, await provider.holdings()));
  app.get('/v1/history', async (c) => {
    const range = (c.req.query('range') ?? '7d') as HistoryRange;
    if (!['1d', '7d', '30d', 'all'].includes(range)) return fail(c, 'range must be 1d|7d|30d|all', 400);
    return ok(c, await provider.history(range));
  });
  app.get('/v1/auctions', async (c) => {
    const status = (c.req.query('status') ?? 'open') as 'open' | 'all';
    if (status !== 'open' && status !== 'all') return fail(c, 'status must be open|all', 400);
    return ok(c, await provider.auctions(status));
  });
  app.get('/v1/flywheel', async (c) => ok(c, await provider.flywheel()));
  app.get('/v1/flywheel/events', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const cursorRaw = c.req.query('cursor');
    const cursor = cursorRaw && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : undefined;
    const { items, nextCursor } = await provider.flywheelEvents(limit, cursor);
    return ok(c, items, { nextCursor });
  });
  app.get('/v1/airdrops/:wallet', async (c) => {
    const wallet = c.req.param('wallet');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return fail(c, 'invalid wallet', 400);
    return ok(c, await provider.airdrops(wallet));
  });
  app.get('/v1/methodology', async (c) => ok(c, await provider.methodology()));
  app.get('/v1/announcements', async (c) => ok(c, await provider.announcements()));
  app.get('/v1/verify', async (c) => ok(c, await provider.verify()));
  app.get('/v1/governance', async (c) => ok(c, await provider.governance()));
  app.get('/v1/proposals', async (c) => {
    const status = c.req.query('status');
    if (status && !['proposed', 'approved', 'rejected', 'queued', 'executed'].includes(status)) return fail(c, 'status must be proposed|approved|rejected|queued|executed', 400);
    return ok(c, await provider.proposals(status));
  });

  // ---- admin (ADMIN_TOKEN bearer) ----
  const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const adminGuard = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (!opts.adminToken) return c.json({ ok: false, error: 'admin API disabled (ADMIN_TOKEN unset)' } satisfies ApiErr, 403);
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${opts.adminToken}`) return c.json({ ok: false, error: 'unauthorized' } satisfies ApiErr, 401);
    if (!provider.admin) return c.json({ ok: false, error: 'admin actions unavailable in this mode' } satisfies ApiErr, 503);
    await next();
  };
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      const b = (await c.req.json()) as unknown;
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
  app.use('/v1/admin/*', adminGuard);
  app.post('/v1/admin/proposals/:mint/approve', async (c) => {
    const mint = c.req.param('mint');
    if (!MINT_RE.test(mint)) return fail(c, 'invalid mint', 400);
    const b = await body(c);
    try {
      return ok(c, await provider.admin!.approveProposal(mint, { weightBps: optNum(b.weightBps), immediate: b.immediate === true }));
    } catch (err) {
      return fail(c, (err as Error).message, 400);
    }
  });
  app.post('/v1/admin/proposals/:mint/reject', async (c) => {
    const mint = c.req.param('mint');
    if (!MINT_RE.test(mint)) return fail(c, 'invalid mint', 400);
    const b = await body(c);
    try {
      return ok(c, await provider.admin!.rejectProposal(mint, typeof b.note === 'string' ? b.note : undefined));
    } catch (err) {
      return fail(c, (err as Error).message, 400);
    }
  });
  app.post('/v1/admin/assets', async (c) => {
    const b = await body(c);
    const mint = typeof b.mint === 'string' ? b.mint : '';
    if (!MINT_RE.test(mint)) return fail(c, 'body.mint required', 400);
    const action = b.action === 'remove' ? 'remove' : 'add';
    try {
      const r =
        action === 'remove'
          ? await provider.admin!.removeAsset(mint, { immediate: b.immediate === true })
          : await provider.admin!.addAsset(mint, { weightBps: optNum(b.weightBps), immediate: b.immediate === true, force: b.force === true });
      return ok(c, r);
    } catch (err) {
      return fail(c, (err as Error).message, 400);
    }
  });
  app.get('/v1/quote/create', async (c) => {
    try {
      return ok(c, await provider.quoteCreate(parseUnits(c.req.query('units'))));
    } catch (err) {
      return fail(c, (err as Error).message, 400);
    }
  });
  app.get('/v1/quote/redeem', async (c) => {
    try {
      return ok(c, await provider.quoteRedeem(parseUnits(c.req.query('units'))));
    } catch (err) {
      return fail(c, (err as Error).message, 400);
    }
  });

  app.get('/v1/stream', (c) =>
    streamSSE(c, async (stream) => {
      let id = 0;
      let closed = false;
      const unsub = events.subscribe((ev) => {
        if (closed) return;
        void stream.writeSSE({ event: ev.type, id: String(++id), data: JSON.stringify({ type: ev.type, ts: ev.ts, data: ev.data }) }).catch(() => {
          closed = true;
        });
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
      });
      await stream.writeSSE({ event: 'hello', id: '0', data: JSON.stringify({ mode: provider.mode, ts: new Date().toISOString() }) });
      while (!closed) {
        await stream.sleep(15_000);
        if (!closed) await stream.writeSSE({ event: 'ping', data: new Date().toISOString() }).catch(() => (closed = true));
      }
    }),
  );

  return app;
}

export function startServer(app: Hono, port: number): ServerType {
  const server = serve({ fetch: app.fetch, port }, (info) => log.info({ port: info.port }, 'api listening'));
  return server;
}
