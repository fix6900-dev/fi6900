import { describe, expect, it } from 'vitest';
import type { AssetState } from '../src/chain/types.js';
import { computeNav, creationBasket, premiumBps, redemptionBasket } from '../src/nav/compute.js';
import { decideArb } from '../src/ap/arb.js';

function asset(mint: string, index: number, decimals: number, vault: bigint, target: number, pendDep = 0n, pendWd = 0n): AssetState {
  return { pda: `pda-${mint}`, fund: 'fund', mint, vault: `vault-${mint}`, tokenProgram: 'tok', index, status: 'active', decimals, targetWeightBps: target, pendingDeposits: pendDep, pendingWithdrawals: pendWd, vaultAmount: vault };
}

describe('computeNav', () => {
  const assets = [asset('A', 0, 6, 1_000_000_000n, 5000), asset('B', 1, 9, 500_000_000_000n, 5000, 100_000_000_000n)];
  const prices = new Map([
    ['A', 1],
    ['B', 2],
  ]);
  it('uses effective balance (vault - pending) and reports weights and drift', () => {
    const r = computeNav(assets, prices, 1_000_000_000n); // 1000 units
    expect(r.navUsd).toBeCloseTo(1000 + 800, 9); // A: 1000*1 ; B: (500-100)*2
    expect(r.navPerUnitUsd).toBeCloseTo(1.8, 9);
    expect(r.holdings[0]?.weightBps).toBe(5556);
    expect(r.holdings[0]?.driftBps).toBe(556);
    expect(r.holdings[1]?.driftBps).toBe(-556);
    expect(r.unpriced).toEqual([]);
  });
  it('flags unpriced assets and excludes them', () => {
    const r = computeNav(assets, new Map([['A', 1]]), 1_000_000_000n);
    expect(r.unpriced).toEqual(['B']);
    expect(r.navUsd).toBeCloseTo(1000, 9);
  });
  it('baskets mirror on-chain rounding', () => {
    const c = creationBasket(assets, 10_000_000n, 1_000_000_000n); // 1% of supply
    expect(c[0]?.amount).toBe(10_000_000n);
    expect(c[1]?.amount).toBe(4_000_000_000n);
    const r = redemptionBasket(assets, 10_000_000n, 1_000_000_000n, 50); // 0.5% fee
    expect(r[0]?.amount).toBe(9_950_000n);
  });
  it('premium bps', () => {
    expect(premiumBps(1.01, 1)).toBe(100);
    expect(premiumBps(0.99, 1)).toBe(-100);
    expect(premiumBps(1, 0)).toBe(0);
  });
});

describe('decideArb', () => {
  const base = { navPerUnitUsd: 1, thresholdBps: 75, mintFeeBps: 50, redeemFeeBps: 50, basketSlippageBps: 20, fixedCostUsd: 1, notionalUsd: 10_000 };
  it('creates on a premium above threshold and profitable after fees', () => {
    const d = decideArb({ ...base, buyPriceUsd: 1.012, sellPriceUsd: 1.01 });
    expect(d.action).toBe('create');
    expect(d.premiumBps).toBe(100);
    // 10_000 units: proceeds 9950 * 1.01 = 10049.5 ; cost 10_000 * 1.002 + 1 = 10021 -> ~28.5
    expect(d.expectedProfitUsd).toBeCloseTo(28.5, 1);
  });
  it('does nothing when premium is above threshold but fees eat it', () => {
    // premium 80bps > 75 threshold, but 100bps basket slippage + 50bps mint fee exceed it
    const d = decideArb({ ...base, basketSlippageBps: 100, buyPriceUsd: 1.009, sellPriceUsd: 1.008 });
    expect(d.premiumBps).toBe(80);
    expect(d.action).toBe('none');
    expect(d.reason).toMatch(/unprofitable/);
  });
  it('redeems on a discount', () => {
    const d = decideArb({ ...base, buyPriceUsd: 0.98, sellPriceUsd: 0.979 });
    expect(d.action).toBe('redeem');
    expect(d.discountBps).toBe(200);
    expect(d.expectedProfitUsd).toBeGreaterThan(0);
  });
  it('stays idle within threshold or without nav', () => {
    expect(decideArb({ ...base, buyPriceUsd: 1.003, sellPriceUsd: 0.998 }).action).toBe('none');
    expect(decideArb({ ...base, navPerUnitUsd: 0, buyPriceUsd: 1, sellPriceUsd: 1 }).reason).toMatch(/nav/);
  });
});
