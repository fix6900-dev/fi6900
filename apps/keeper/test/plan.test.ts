import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG, withMethodologyOverrides } from '../src/config/methodology.config.js';
import { capQueued, planRebalance, type PlanHolding } from '../src/rebalancer/plan.js';

const cfg = DEFAULT_METHODOLOGY_CONFIG;

function h(mint: string, valueUsd: number, targetBps: number, volume = 10_000_000, priceUsd = 1, decimals = 6): PlanHolding {
  return { mint, decimals, balance: BigInt(Math.round((valueUsd / priceUsd) * 10 ** decimals)), priceUsd, valueUsd, targetWeightBps: targetBps, volume24hUsd: volume, status: 'active' };
}

describe('planRebalance', () => {
  it('pairs the largest overweight with the largest underweight', () => {
    // NAV 1000, 4 assets, target 25% each (250 USD)
    const holdings = [h('A', 400, 2500), h('B', 300, 2500), h('C', 200, 2500), h('D', 100, 2500)];
    const plan = planRebalance(holdings, 1000, cfg);
    expect(plan.trades[0]).toMatchObject({ sellMint: 'A', buyMint: 'D' });
    expect(plan.trades[0]?.sellUsd).toBeCloseTo(150, 6);
    expect(plan.trades[1]).toMatchObject({ sellMint: 'B', buyMint: 'C' });
    expect(plan.trades[1]?.sellUsd).toBeCloseTo(50, 6);
    expect(plan.turnoverUsd).toBeCloseTo(200, 6);
    expect(plan.queued).toHaveLength(0);
    // raw sell amount at $1 / 6 decimals
    expect(plan.trades[0]?.sellAmount).toBe(150_000_000n);
  });

  it('a removing asset is fully sold', () => {
    const holdings = [h('A', 500, 5000), h('B', 300, 5000), { ...h('X', 200, 0), status: 'removing' as const }];
    const plan = planRebalance(holdings, 1000, cfg);
    const sells = plan.trades.filter((t) => t.sellMint === 'X').reduce((s, t) => s + t.sellUsd, 0);
    expect(sells).toBeCloseTo(200, 6);
  });

  it('respects maxTradePctOfDailyVolume and queues the remainder', () => {
    // A is overweight by 300 but only traded 2000/day -> cap 5% = 100
    const holdings = [h('A', 550, 2500, 2000), h('B', 250, 2500), h('C', 250, 2500), h('D', -50 + 0, 2500)];
    holdings[3] = h('D', 0, 2500); // fully underweight by 250 ... total under = 250, over = 300 -> trade 250 capped to 100
    const plan = planRebalance(holdings, 1000, cfg);
    const a = plan.trades.find((t) => t.sellMint === 'A');
    expect(a?.capped).toBe(true);
    expect(a?.sellUsd).toBeCloseTo(100, 6);
    expect(plan.queued).toHaveLength(1);
    expect(plan.queued[0]?.sellUsd).toBeCloseTo(150, 6);
  });

  it('drops trades below minTradeUsd', () => {
    const holdings = [h('A', 510, 5000), h('B', 490, 5000)];
    const plan = planRebalance(holdings, 1000, cfg); // 10 USD < 25 min
    expect(plan.trades).toHaveLength(0);
  });

  it('never sells more than the balance', () => {
    const holdings = [h('A', 1000, 0), h('B', 0, 10000)];
    const plan = planRebalance(holdings, 1000, cfg);
    expect(plan.trades[0]?.sellAmount).toBe(holdings[0]?.balance);
  });

  it('is a no-op when within target', () => {
    const plan = planRebalance([h('A', 500, 5000), h('B', 500, 5000)], 1000, cfg);
    expect(plan.trades).toHaveLength(0);
    expect(plan.turnoverUsd).toBe(0);
  });
});

describe('capQueued', () => {
  it('re-applies the cap on the next cycle', () => {
    const cfgTight = withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { maxTradePctOfDailyVolume: 5 });
    const holdings = [h('A', 500, 2500, 2000), h('B', 0, 2500)];
    const queued = [{ sellMint: 'A', buyMint: 'B', sellAmount: 150_000_000n, sellUsd: 150 }];
    const plan = capQueued(queued, holdings, cfgTight);
    expect(plan.trades[0]?.sellUsd).toBeCloseTo(100, 6);
    expect(plan.queued[0]?.sellUsd).toBeCloseTo(50, 6);
  });
});
