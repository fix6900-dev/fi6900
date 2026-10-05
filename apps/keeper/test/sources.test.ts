import { describe, expect, it } from 'vitest';
import { aggregatePairs, type DexPair } from '../src/sources/dexscreener.js';
import { mergeByOwner } from '../src/sources/helius.js';
import { parseJupiterPriceResponse } from '../src/sources/jupiter-price.js';
import { midPriceFromQuotes, parseQuote } from '../src/sources/jupiter-quote.js';
import { TtlCache } from '../src/util/cache.js';
import { withRetry } from '../src/util/retry.js';

describe('jupiter price parsing', () => {
  it('parses v2 and v3 shapes, skipping nulls', () => {
    const v2 = parseJupiterPriceResponse({ data: { A: { id: 'A', price: '1.5' }, B: null, C: { id: 'C', price: 0 } } });
    expect([...v2.entries()]).toEqual([['A', 1.5]]);
    const v3 = parseJupiterPriceResponse({ A: { usdPrice: 2.25 }, B: { usdPrice: 0.0001 } } as never);
    expect(v3.get('A')).toBe(2.25);
    expect(v3.get('B')).toBe(0.0001);
  });
});

describe('dexscreener aggregation', () => {
  const pair = (o: Partial<DexPair> & { base: string; liq: number; vol: number; created?: number }): DexPair => ({
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: 'p',
    baseToken: { address: o.base, symbol: o.base, name: o.base },
    quoteToken: { address: 'SOL', symbol: 'SOL', name: 'SOL' },
    priceUsd: o.priceUsd ?? '1',
    volume: { h24: o.vol },
    liquidity: { usd: o.liq },
    fdv: o.fdv ?? 1e7,
    marketCap: o.marketCap,
    pairCreatedAt: o.created,
    priceChange: { h24: 3 },
  });
  it('takes price from the deepest pool, sums volume and liquidity, min pairCreatedAt', () => {
    const md = aggregatePairs(
      [
        pair({ base: 'A', liq: 100, vol: 10, priceUsd: '0.9', created: 2000 }),
        pair({ base: 'A', liq: 900, vol: 40, priceUsd: '1.1', created: 1000 }),
        pair({ base: 'B', liq: 5, vol: 1 }),
        { ...pair({ base: 'A', liq: 1e9, vol: 1e9 }), chainId: 'ethereum' },
      ],
      new Set(['A']),
    );
    const a = md.get('A');
    expect(a?.priceUsd).toBe(1.1);
    expect(a?.volume24hUsd).toBe(50);
    expect(a?.liquidityUsd).toBe(1000);
    expect(a?.pairCreatedAt).toBe(1000);
    expect(md.has('B')).toBe(false);
  });
});

describe('jupiter quote', () => {
  it('parses and computes mid', () => {
    const buy = parseQuote({ inputMint: 'SOL', outputMint: 'IDX', inAmount: '1000000000', outAmount: '150000000', otherAmountThreshold: '149000000', slippageBps: 50, priceImpactPct: '0.001', routePlan: [{ swapInfo: { label: 'Meteora' } }] });
    const sell = parseQuote({ inputMint: 'IDX', outputMint: 'SOL', inAmount: '150000000', outAmount: '990000000', otherAmountThreshold: '980000000', slippageBps: 50, priceImpactPct: 0.002 });
    expect(buy.priceImpactPct).toBe(0.001);
    expect(buy.routeLabels).toEqual(['Meteora']);
    const m = midPriceFromQuotes(buy, sell, 9, 6);
    // 1 SOL buys 150 units -> 0.006667 SOL/unit ; 150 units sell for 0.99 SOL -> 0.0066
    expect(m.buyPrice).toBeCloseTo(1 / 150, 9);
    expect(m.sellPrice).toBeCloseTo(0.99 / 150, 9);
    expect(m.mid).toBeCloseTo((1 / 150 + 0.99 / 150) / 2, 9);
  });
});

describe('holders', () => {
  it('merges multiple token accounts per owner and sorts desc', () => {
    const merged = mergeByOwner([
      { owner: 'a', tokenAccount: 't1', amount: 5n },
      { owner: 'b', tokenAccount: 't2', amount: 50n },
      { owner: 'a', tokenAccount: 't3', amount: 7n },
    ]);
    expect(merged.map((m) => [m.owner, m.amount])).toEqual([
      ['b', 50n],
      ['a', 12n],
    ]);
  });
});

describe('TtlCache + retry', () => {
  it('expires entries and coalesces loads', async () => {
    let now = 0;
    const c = new TtlCache<number>(100, () => now);
    let loads = 0;
    const load = (): Promise<number> => {
      loads++;
      return Promise.resolve(42);
    };
    const [a, b] = await Promise.all([c.getOrLoad('k', load), c.getOrLoad('k', load)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(loads).toBe(1);
    now = 150;
    expect(c.get('k')).toBeUndefined();
  });
  it('withRetry retries then throws RetryError', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error('boom');
        },
        { retries: 2, baseMs: 1, jitter: false },
      ),
    ).rejects.toThrow(/failed after 3 attempts/);
    expect(n).toBe(3);
  });
});
