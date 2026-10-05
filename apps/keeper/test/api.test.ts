import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api/server.js';
import type { ApiOk } from '../src/api/types.js';
import { MockProvider } from '../src/mock/provider.js';
import { EventBus } from '../src/util/events.js';

const events = new EventBus();
const provider = new MockProvider(events, 42);
const app = createApp({ provider, events, corsOrigin: '*', adminToken: 'test-admin' });

async function get<T>(path: string): Promise<ApiOk<T>> {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ApiOk<T>;
  expect(body.ok).toBe(true);
  expect(typeof body.asOf).toBe('string');
  return body;
}

describe('API shapes (ARCHITECTURE section 5) against the mock provider', () => {
  it('GET /health', async () => {
    const b = await get<{ status: string; mode: string }>('/health');
    expect(b.data.status).toBe('ok');
    expect(b.data.mode).toBe('mock');
  });

  it('GET /v1/fund', async () => {
    const { data } = await get<Record<string, unknown>>('/v1/fund');
    for (const k of ['indexMint', 'fundPda', 'supply', 'navUsd', 'navPerUnitUsd', 'indexLevel', 'marketPriceUsd', 'premiumBps', 'fees', 'assetCount', 'epoch', 'openAuctions', 'paused']) {
      expect(data, k).toHaveProperty(k);
    }
    expect(data.fees).toEqual({ mintBps: 50, redeemBps: 50, mgmtBps: 100 });
    expect(data.assetCount).toBe(40);
    expect(typeof data.supply).toBe('string');
  });

  it('GET /v1/holdings has 40 rows with every field and weights ~10_000', async () => {
    const { data } = await get<Record<string, unknown>[]>('/v1/holdings');
    expect(data).toHaveLength(40);
    const row = data[0]!;
    for (const k of ['slot', 'mint', 'symbol', 'name', 'logo', 'decimals', 'balance', 'balanceUi', 'priceUsd', 'valueUsd', 'weightBps', 'targetWeightBps', 'driftBps', 'change24hPct', 'marketCapUsd', 'status', 'vault', 'verifyUrl']) {
      expect(row, k).toHaveProperty(k);
    }
    const sum = data.reduce((s, r) => s + (r.weightBps as number), 0);
    expect(Math.abs(sum - 10_000)).toBeLessThanOrEqual(40);
    expect(data.map((r) => r.symbol)).toEqual(expect.arrayContaining(['WIF', 'BONK', 'POPCAT', 'PENGU', 'FARTCOIN', 'TRUMP']));
  });

  it('GET /v1/history ranges', async () => {
    const all = await get<unknown[]>('/v1/history?range=all');
    const d7 = await get<{ t: string; navPerUnitUsd: number; indexLevel: number; marketPriceUsd: number; supply: string }[]>('/v1/history?range=7d');
    const d1 = await get<unknown[]>('/v1/history?range=1d');
    expect(all.data.length).toBeGreaterThan(2000);
    expect(d7.data.length).toBeGreaterThan(150);
    expect(d1.data.length).toBeLessThan(d7.data.length);
    expect(d7.data[0]).toHaveProperty('indexLevel');
    const bad = await app.request('/v1/history?range=2y');
    expect(bad.status).toBe(400);
  });

  it('GET /v1/auctions', async () => {
    const open = await get<Record<string, unknown>[]>('/v1/auctions?status=open');
    const all = await get<Record<string, unknown>[]>('/v1/auctions?status=all');
    expect(open.data.length).toBeGreaterThanOrEqual(2);
    expect(all.data.length).toBeGreaterThan(open.data.length);
    const a = open.data[0]!;
    for (const k of ['pda', 'sellMint', 'buyMint', 'sellRemaining', 'sellTotal', 'startPrice', 'endPrice', 'currentPrice', 'startSlot', 'endSlot', 'status', 'fills']) expect(a, k).toHaveProperty(k);
    expect(BigInt(a.currentPrice as string)).toBeLessThanOrEqual(BigInt(a.startPrice as string));
    expect(BigInt(a.currentPrice as string)).toBeGreaterThanOrEqual(BigInt(a.endPrice as string));
  });

  it('GET /v1/flywheel and events pagination', async () => {
    const fw = await get<Record<string, unknown>>('/v1/flywheel');
    for (const k of ['coinMint', 'creatorFeesClaimedSol', 'lpAddedSol', 'airdroppedUnits', 'airdropRounds', 'buybackSol', 'burnedCoin', 'treasurySol', 'next']) expect(fw.data, k).toHaveProperty(k);
    expect(fw.data.creatorFeesClaimedSol as number).toBeGreaterThan(0);
    const p1 = await get<{ id: number; kind: string }[]>('/v1/flywheel/events?limit=10');
    expect(p1.data).toHaveLength(10);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await get<{ id: number }[]>(`/v1/flywheel/events?limit=10&cursor=${p1.nextCursor}`);
    expect(p2.data[0]!.id).toBeLessThan(p1.data[9]!.id);
  });

  it('GET /v1/airdrops/:wallet validates and returns rows', async () => {
    const ok = await get<{ roundId: number; ts: string; units: string; sig: string }[]>('/v1/airdrops/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');
    expect(ok.data.length).toBeGreaterThan(0);
    expect(ok.data[0]).toHaveProperty('roundId');
    const bad = await app.request('/v1/airdrops/not-a-wallet!');
    expect(bad.status).toBe(400);
  });

  it('GET /v1/methodology, /v1/announcements, /v1/verify', async () => {
    const m = await get<{ config: { weighting: { scheme: string } }; lastRun: { weights: unknown[] } | null; nextReconstitution: string }>('/v1/methodology');
    expect(m.data.config.weighting.scheme).toBe('equal');
    expect(m.data.lastRun?.weights.length).toBe(40);
    expect(new Date(m.data.nextReconstitution).getUTCDate()).toBe(1);
    const a = await get<{ ts: string; title: string; body: string }[]>('/v1/announcements');
    expect(a.data.length).toBeGreaterThan(0);
    const v = await get<{ vaults: unknown[]; programId: string; mintAuthority: string; fundPda: string }>('/v1/verify');
    expect(v.data.vaults).toHaveLength(40);
    expect(v.data.mintAuthority).toBe(v.data.fundPda);
    expect(v.data).toHaveProperty('upgradeAuthority');
    expect(v.data).toHaveProperty('programDataAddress');
  });

  it('GET /v1/flywheel next.scheduledRebalanceAt is an ISO date', async () => {
    const fw = await get<{ next: { scheduledRebalanceAt: string | null; rebalanceCheckAt: string | null } }>('/v1/flywheel');
    expect(fw.data.next).toHaveProperty('scheduledRebalanceAt');
    expect(Number.isNaN(Date.parse(fw.data.next.scheduledRebalanceAt ?? ''))).toBe(false);
  });

  it('GET /v1/governance and /v1/proposals (ARCHITECTURE section 5)', async () => {
    const g = await get<Record<string, unknown>>('/v1/governance');
    for (const k of ['timelockSlots', 'pending', 'upgradeAuthority', 'programDataAddress', 'fundAuthority', 'rebalancer', 'feeRecipient', 'maxAuctionDiscountBps', 'reconstitutionMode']) expect(g.data, k).toHaveProperty(k);
    const pending = g.data.pending as Record<string, unknown>[];
    for (const k of ['pda', 'kind', 'kindName', 'payload', 'etaSlot', 'proposer', 'queuedSig']) expect(pending[0], k).toHaveProperty(k);
    const p = await get<Record<string, unknown>[]>('/v1/proposals');
    for (const k of ['id', 'mint', 'action', 'reason', 'status', 'weightBps', 'proposedTs']) expect(p.data[0], k).toHaveProperty(k);
    const none = await get<unknown[]>('/v1/proposals?status=executed');
    expect(none.data).toHaveLength(0);
    expect((await app.request('/v1/proposals?status=bogus')).status).toBe(400);
  });

  it('admin endpoints require the bearer token (and are unavailable on the mock provider)', async () => {
    const noAuth = await app.request('/v1/admin/proposals/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm/approve', { method: 'POST' });
    expect(noAuth.status).toBe(401);
    const withAuth = await app.request('/v1/admin/proposals/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm/approve', { method: 'POST', headers: { authorization: 'Bearer test-admin' } });
    expect(withAuth.status).toBe(503); // mock provider has no admin actions
    const disabled = createApp({ provider, events, corsOrigin: '*' });
    expect((await disabled.request('/v1/admin/assets', { method: 'POST', headers: { authorization: 'Bearer test-admin' } })).status).toBe(403);
  });

  it('GET /v1/quote/create and redeem', async () => {
    const c = await get<{ basket: { mint: string; amount: string }[]; estCostSol: number; estNavUsd: number }>('/v1/quote/create?units=1000000');
    expect(c.data.basket).toHaveLength(40);
    expect(c.data.estNavUsd).toBeGreaterThan(0);
    expect(c.data.estCostSol).toBeGreaterThan(0);
    const r = await get<{ basket: unknown[]; estValueUsd: number }>('/v1/quote/redeem?units=1000000');
    expect(r.data.estValueUsd).toBeLessThan(c.data.estNavUsd);
    const bad = await app.request('/v1/quote/create?units=abc');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('404 envelope', async () => {
    const res = await app.request('/v1/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('SSE stream sends hello and forwards bus events', async () => {
    const res = await app.request('/v1/stream');
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = dec.decode((await reader.read()).value);
    expect(buf).toMatch(/event: hello/);
    events.emit('flywheel_event', { kind: 'claim', sol: 1 });
    buf += dec.decode((await reader.read()).value);
    expect(buf).toMatch(/event: flywheel_event/);
    await reader.cancel();
  });
});
