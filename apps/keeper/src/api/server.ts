import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { serve, type ServerType } from '@hono/node-server';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import type { ApiErr, ApiOk, HistoryRange, KeeperDataProvider } from './types.js';
import { GovError } from '../governance/holder-gov.js';
import { RequestLimiter } from '../util/request-limit.js';

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

function fail(c: Context, error: string, status: 400 | 403 | 404 | 409 | 429 | 500 | 503 = 500): Response {
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

  // ---- holder governance (public reads; signature-authenticated writes; docs/governance.md) ----
  const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const govLimiter = new RequestLimiter({ windowMs: 60_000, max: 20 });
  const govOrFail = (c: Context): Response | null => (provider.gov ? null : fail(c, 'holder governance is disabled on this keeper', 503));
  const govErr = (c: Context, err: unknown): Response => (err instanceof GovError ? fail(c, err.message, err.status) : fail(c, (err as Error).message, 400));
  const walletQ = (c: Context): string | undefined => {
    const w = c.req.query('wallet');
    return w && WALLET_RE.test(w) ? w : undefined;
  };
  const clientIp = (c: Context): string => (c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'local').split(',')[0]!.trim();
  const rateLimited = (c: Context, key: string): Response | null => (govLimiter.hit(`${clientIp(c)}|${key}`) ? null : fail(c, 'too many requests; try again in a minute', 429));
  const jsonBody = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      const b = (await c.req.json()) as unknown;
      return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const isAdminBearer = (c: Context): boolean => Boolean(opts.adminToken) && (c.req.header('authorization') ?? '') === `Bearer ${opts.adminToken}`;
  const parseId = (raw: string): number | null => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

  app.get('/v1/governance/proposals', (c) => {
    const g = govOrFail(c);
    if (g) return g;
    try {
      return ok(c, provider.gov!.proposals(c.req.query('status') || undefined, walletQ(c)));
    } catch (err) {
      return govErr(c, err);
    }
  });
  app.get('/v1/governance/proposals/:id', (c) => {
    const g = govOrFail(c);
    if (g) return g;
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 'invalid proposal id', 400);
    try {
      return ok(c, provider.gov!.proposal(id, walletQ(c)));
    } catch (err) {
      return govErr(c, err);
    }
  });
  app.get('/v1/governance/eligibility', async (c) => {
    const g = govOrFail(c);
    if (g) return g;
    const w = walletQ(c);
    if (!w) return fail(c, 'wallet query required', 400);
    try {
      return ok(c, await provider.gov!.eligibility(w));
    } catch (err) {
      return govErr(c, err);
    }
  });
  app.post('/v1/governance/proposals', async (c) => {
    const g = govOrFail(c);
    if (g) return g;
    const b = await jsonBody(c);
    const admin = isAdminBearer(c);
    const proposer = typeof b.proposer === 'string' ? b.proposer : '';
    const rl = admin ? null : rateLimited(c, `propose|${proposer}`);
    if (rl) return rl;
    try {
      const dto = await provider.gov!.propose(
        {
          kind: String(b.kind ?? ''),
          payload: b.payload && typeof b.payload === 'object' ? (b.payload as Record<string, unknown>) : {},
          title: typeof b.title === 'string' ? b.title : '',
          description: typeof b.description === 'string' ? b.description : '',
          proposer,
          message: typeof b.message === 'string' ? b.message : undefined,
          signature: typeof b.signature === 'string' ? b.signature : undefined,
        },
        { admin },
      );
      return c.json({ ok: true, data: dto, asOf: new Date().toISOString() } satisfies ApiOk<typeof dto>, 201);
    } catch (err) {
      return govErr(c, err);
    }
  });
  app.post('/v1/governance/proposals/:id/vote', async (c) => {
    const g = govOrFail(c);
    if (g) return g;
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 'invalid proposal id', 400);
    const b = await jsonBody(c);
    const wallet = typeof b.wallet === 'string' ? b.wallet : '';
    const rl = rateLimited(c, `vote|${wallet}`);
    if (rl) return rl;
    try {
      return ok(c, provider.gov!.vote(id, { wallet, choice: String(b.choice ?? ''), message: typeof b.message === 'string' ? b.message : '', signature: typeof b.signature === 'string' ? b.signature : '' }));
    } catch (err) {
      return govErr(c, err);
    }
  });

  // ---- admin (ADMIN_TOKEN bearer) ----
  const MINT_RE = WALLET_RE;
  const adminGuard = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (!opts.adminToken) return c.json({ ok: false, error: 'admin API disabled (ADMIN_TOKEN unset)' } satisfies ApiErr, 403);
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${opts.adminToken}`) return c.json({ ok: false, error: 'unauthorized' } satisfies ApiErr, 401);
    if (!provider.admin && !c.req.path.startsWith('/v1/admin/governance/')) return c.json({ ok: false, error: 'admin actions unavailable in this mode' } satisfies ApiErr, 503);
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
  app.post('/v1/admin/governance/proposals/:id/cancel', async (c) => {
    const g = govOrFail(c);
    if (g) return g;
    const id = parseId(c.req.param('id'));
    if (id === null) return fail(c, 'invalid proposal id', 400);
    const b = await body(c);
    try {
      return ok(c, provider.gov!.cancel(id, typeof b.note === 'string' ? b.note : undefined));
    } catch (err) {
      return govErr(c, err);
    }
  });
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
