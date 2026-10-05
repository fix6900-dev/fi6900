import { describe, expect, it } from 'vitest';
import { batch, computeAirdrop, minUnitsForRent } from '../src/flywheel/airdrop.js';

describe('computeAirdrop', () => {
  const holders = [
    { owner: 'whale', amount: 700n },
    { owner: 'mid', amount: 200n },
    { owner: 'shrimp', amount: 100n },
    { owner: 'pool', amount: 5000n }, // excluded LP pool
  ];

  it('splits pro-rata among non-excluded holders', () => {
    const r = computeAirdrop({ holders, totalUnits: 1_000_000n, carry: new Map(), minUnits: 0n, exclude: new Set(['pool']) });
    const get = (w: string): bigint => r.payouts.find((p) => p.wallet === w)?.units ?? 0n;
    expect(get('whale')).toBe(700_000n);
    expect(get('mid')).toBe(200_000n);
    expect(get('shrimp')).toBe(100_000n);
    expect(get('pool')).toBe(0n);
    expect(r.distributedUnits).toBe(1_000_000n);
    expect(r.undistributedUnits).toBe(0n);
    expect(r.eligibleHolders).toBe(3);
  });

  it('skips wallets below the rent threshold and carries their share forward', () => {
    const r = computeAirdrop({ holders, totalUnits: 1_000_000n, carry: new Map(), minUnits: 150_000n, exclude: new Set(['pool']) });
    expect(r.payouts.map((p) => p.wallet).sort()).toEqual(['mid', 'whale']);
    expect(r.carry.get('shrimp')).toBe(100_000n);
    expect(r.skipped).toBe(1);
    expect(r.carriedUnits).toBe(100_000n);
    expect(r.distributedUnits).toBe(900_000n);
  });

  it('pays out once accumulated carry crosses the threshold', () => {
    const carry = new Map([['shrimp', 60_000n]]);
    const r = computeAirdrop({ holders, totalUnits: 1_000_000n, carry, minUnits: 150_000n, exclude: new Set(['pool']) });
    expect(r.payouts.find((p) => p.wallet === 'shrimp')?.units).toBe(160_000n);
    expect(r.carry.has('shrimp')).toBe(false);
  });

  it('keeps carry for wallets that are no longer holders', () => {
    const carry = new Map([['gone', 5_000n]]);
    const r = computeAirdrop({ holders, totalUnits: 1_000n, carry, minUnits: 10_000n, exclude: new Set() });
    expect(r.carry.get('gone')).toBe(5_000n);
  });

  it('returns rounding dust as undistributed', () => {
    const r = computeAirdrop({ holders: [{ owner: 'a', amount: 3n }, { owner: 'b', amount: 3n }, { owner: 'c', amount: 3n }], totalUnits: 10n, carry: new Map(), minUnits: 0n, exclude: new Set() });
    expect(r.distributedUnits).toBe(9n);
    expect(r.undistributedUnits).toBe(1n);
  });

  it('handles empty inputs', () => {
    const r = computeAirdrop({ holders: [], totalUnits: 100n, carry: new Map([['x', 1n]]), minUnits: 0n, exclude: new Set() });
    expect(r.payouts).toEqual([]);
    expect(r.undistributedUnits).toBe(100n);
    expect(r.carry.get('x')).toBe(1n);
  });
});

describe('batch', () => {
  it('splits into groups of 18', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    const b = batch(items, 18);
    expect(b.map((x) => x.length)).toEqual([18, 18, 4]);
  });
});

describe('minUnitsForRent', () => {
  it('converts ATA rent to index units', () => {
    // 0.00203928 SOL * $150 = $0.306; at NAV/unit $1.00 -> 0.306 units = 305_892 raw
    expect(minUnitsForRent(2_039_280, 150, 1)).toBe(305_892n);
    expect(minUnitsForRent(2_039_280, 150, 0)).toBe(0n);
  });
});
