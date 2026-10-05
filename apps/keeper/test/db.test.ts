import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/db.js';
import { Repo } from '../src/db/repo.js';

describe('sqlite repo', () => {
  const repo = new Repo(openDb(':memory:'));

  it('migrates and tracks schema version', () => {
    expect(repo.getKv('schema_version')).toBe('1');
    const tables = repo.db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    for (const t of ['nav_snapshots', 'holdings_snapshots', 'auctions', 'auction_fills', 'flywheel_events', 'airdrop_rounds', 'airdrop_payouts', 'carry', 'announcements', 'methodology_runs', 'kv']) {
      expect(tables).toContain(t);
    }
  });

  it('stores nav snapshots with holdings and reads history', () => {
    const id = repo.insertNavSnapshot({
      ts: '2026-10-02T00:00:00.000Z',
      navUsd: 1000,
      navPerUnitUsd: 1,
      indexLevel: 1000,
      divisor: 1,
      marketPriceUsd: 1.01,
      premiumBps: 100,
      supply: 1_000_000_000n,
      epoch: 3n,
      solPriceUsd: 150,
      holdings: [{ slot: 0, mint: 'A', balance: 5n, priceUsd: 1, valueUsd: 5, weightBps: 10000, targetWeightBps: 10000 }],
    });
    expect(id).toBeGreaterThan(0);
    expect(repo.latestNav()?.supply).toBe('1000000000');
    expect(repo.navHistory(null)).toHaveLength(1);
    expect(repo.navHistory('2027-01-01T00:00:00.000Z')).toHaveLength(0);
  });

  it('flywheel events: insert, paginate, sum', () => {
    for (let i = 0; i < 5; i++) repo.insertFlywheelEvent({ kind: 'claim', sig: `s${i}`, amounts: { sol: 1.5 } });
    repo.insertFlywheelEvent({ kind: 'burn', sig: 'b', amounts: { coin: 10n } });
    const page = repo.flywheelEvents(3);
    expect(page).toHaveLength(3);
    const next = repo.flywheelEvents(3, page[2]?.id);
    expect(next).toHaveLength(3);
    expect(repo.sumFlywheel('claim', 'sol')).toBeCloseTo(7.5);
    expect(repo.sumFlywheel('burn', 'coin')).toBe(10);
    expect(repo.flywheelEvents(10, undefined, 'burn')).toHaveLength(1);
  });

  it('carry table upserts and deletes zero rows', () => {
    repo.setCarry(new Map([['w1', 10n], ['w2', 0n]]));
    expect(repo.getCarry().get('w1')).toBe(10n);
    expect(repo.getCarry().has('w2')).toBe(false);
    repo.setCarry(new Map([['w1', 0n]]));
    expect(repo.getCarry().size).toBe(0);
  });

  it('auctions and fills', () => {
    repo.upsertAuction({ pda: 'A1', nonce: '0', sell_mint: 'X', buy_mint: 'Y', sell_total: '100', sell_remaining: '100', start_price: '1', end_price: '1', start_slot: '1', end_slot: '2', status: 'open', mid_price: 1, reason: 'drift', start_sig: 's' });
    repo.upsertAuction({ pda: 'A1', nonce: '0', sell_mint: 'X', buy_mint: 'Y', sell_total: '100', sell_remaining: '40', start_price: '1', end_price: '1', start_slot: '1', end_slot: '2', status: 'open', mid_price: null, reason: null, start_sig: null });
    const a = repo.getAuction('A1');
    expect(a?.sell_remaining).toBe('40');
    expect(a?.mid_price).toBe(1); // COALESCE keeps original
    expect(repo.insertFill({ auctionPda: 'A1', sig: 'f', filler: 'z', sellAmount: 60n, buyAmount: 60n, price: 1n, slot: 1 })).toBe(true);
    expect(repo.insertFill({ auctionPda: 'A1', sig: 'f', filler: 'z', sellAmount: 60n, buyAmount: 60n, price: 1n, slot: 1 })).toBe(false);
    expect(repo.fillsFor('A1')).toHaveLength(1);
    expect(repo.listAuctions('open')).toHaveLength(1);
  });

  it('announcements dedupe by key; methodology runs round-trip', () => {
    expect(repo.insertAnnouncement({ title: 't', body: 'b', key: 'k' })).toBe(true);
    expect(repo.insertAnnouncement({ title: 't', body: 'b', key: 'k' })).toBe(false);
    repo.insertMethodologyRun({ ts: 'now', configVersion: '1', config: {}, eligible: [1], selected: { a: 1n }, weights: [], dry: true, applied: false });
    expect(JSON.parse(repo.latestMethodologyRun()?.selected ?? '{}')).toEqual({ a: '1' });
  });

  it('market observations give a 7d average', () => {
    for (let d = 1; d <= 10; d++) repo.recordObservation('M', `2026-09-${String(d).padStart(2, '0')}`, d * 100, 1, 1);
    const avg = repo.avgVolume7d('M');
    expect(avg?.days).toBe(7);
    expect(avg?.avg).toBeCloseTo((4 + 5 + 6 + 7 + 8 + 9 + 10) * 100 / 7);
  });
});
