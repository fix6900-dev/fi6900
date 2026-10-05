import { describe, expect, it } from 'vitest';
import { auctionPrices, buyAmountFor, midRawPrice, priceAtSlot, selfFillSlot, shouldSelfFill } from '../src/rebalancer/auction-pricing.js';
import { auctionPriceAt } from '../src/chain/sdk.js';
import { fromQ64, toQ64 } from '../src/util/math.js';

describe('Q64.64 helpers', () => {
  it('round-trips typical and tiny prices', () => {
    for (const p of [1, 0.5, 1234.5678, 1e-6, 3.3e-9, 42e6]) {
      expect(fromQ64(toQ64(p))).toBeCloseTo(p, 12);
    }
  });
});

describe('auctionPrices', () => {
  it('mid converts USD prices to raw buy-per-sell with decimals', () => {
    // sell WIF ($1, 6 dec) for BONK ($0.00002, 5 dec): 1 WIF = 50_000 BONK -> raw: 1e6 WIF-raw = 5e9 BONK-raw => 5000 per raw
    expect(midRawPrice(1, 0.00002, 6, 5)).toBeCloseTo(5000, 6);
  });
  it('start = mid * 1.03, end = mid * 0.96', () => {
    const p = auctionPrices({ sellPriceUsd: 2, buyPriceUsd: 1, sellDecimals: 6, buyDecimals: 6, startPremiumBps: 300, maxDiscountBps: 400 });
    expect(p.midRaw).toBeCloseTo(2, 12);
    expect(fromQ64(p.startPrice)).toBeCloseTo(2.06, 9);
    expect(fromQ64(p.endPrice)).toBeCloseTo(1.92, 9);
  });
});

describe('price curve', () => {
  const start = toQ64(2.06);
  const end = toQ64(1.92);
  it('decays linearly and clamps', () => {
    expect(priceAtSlot(start, end, 100n, 250n, 50n)).toBe(start);
    expect(priceAtSlot(start, end, 100n, 250n, 300n)).toBe(end);
    expect(fromQ64(priceAtSlot(start, end, 100n, 250n, 175n))).toBeCloseTo(1.99, 9);
  });
  it('matches the SDK-adapter auctionPriceAt implementation', () => {
    const a = { startPrice: start, endPrice: end, startSlot: 100n, endSlot: 250n };
    for (const s of [90n, 100n, 137n, 200n, 250n, 260n]) expect(auctionPriceAt(a, s)).toBe(priceAtSlot(start, end, 100n, 250n, s));
  });
  it('buy amount is ceil(sell * price)', () => {
    expect(buyAmountFor(1_000_000n, toQ64(1.5))).toBe(1_500_000n);
    expect(buyAmountFor(3n, toQ64(0.5))).toBe(2n); // 1.5 -> 2
  });
});

describe('fallback fill rule', () => {
  const mid = 2;
  const start = toQ64(2.06);
  const end = toQ64(1.92);
  it('fills once price <= mid * 0.995', () => {
    expect(shouldSelfFill(toQ64(2.0), mid, 50)).toBe(false);
    expect(shouldSelfFill(toQ64(1.99), mid, 50)).toBe(true);
  });
  it('predicts the crossing slot on the curve', () => {
    const s = selfFillSlot(start, end, 0n, 150n, mid, 50);
    // crossing at price 1.99: (2.06-1.99)/(2.06-1.92) = 0.5 -> slot 75
    expect(Number(s)).toBe(75);
    expect(shouldSelfFill(priceAtSlot(start, end, 0n, 150n, s), mid, 50)).toBe(true);
    expect(shouldSelfFill(priceAtSlot(start, end, 0n, 150n, s - 2n), mid, 50)).toBe(false);
  });
});
