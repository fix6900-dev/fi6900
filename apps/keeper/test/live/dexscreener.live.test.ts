import { describe, expect, it } from 'vitest';
import { DexScreenerSource } from '../../src/sources/dexscreener.js';
import { CompositeMarketData } from '../../src/sources/market-data.js';
import { JupiterPriceSource } from '../../src/sources/jupiter-price.js';
import { JupiterTokenListSource } from '../../src/sources/jupiter-tokens.js';
import { BONK, LIVE, LIVE_TIMEOUT, POPCAT, TRIO, WIF, jupiter } from './_live.js';

/** DexScreener contract (verified 2026-10-03): tokens/v1 = one (primary) pair per token; token-pairs/v1 = all pools. */
describe.skipIf(!LIVE)('LIVE dexscreener', () => {
  const dex = new DexScreenerSource('https://api.dexscreener.com', 0);

  it(
    'tokens/v1 returns the primary pair with the fields the keeper reads',
    async () => {
      const md = await dex.getMarketData(TRIO);
      for (const m of TRIO) {
        const d = md.get(m)!;
        expect(d, m).toBeDefined();
        expect(d.priceUsd).toBeGreaterThan(0);
        expect(d.volume24hUsd).toBeGreaterThan(0);
        expect(d.liquidityUsd).toBeGreaterThan(10_000);
        expect(d.fdvUsd).toBeGreaterThan(1_000_000);
        expect(d.marketCapUsd).toBeGreaterThan(1_000_000);
        expect(d.pairCreatedAt).toBeGreaterThan(Date.parse('2022-01-01'));
        expect(typeof d.change24hPct).toBe('number');
        expect(d.symbol).toBeTruthy();
      }
      expect(md.get(WIF)!.logo).toMatch(/^https?:\/\//); // info.imageUrl
      expect(md.get(BONK)!.pairCreatedAt!).toBeLessThan(Date.parse('2023-02-01')); // BONK launched Dec 2022
    },
    LIVE_TIMEOUT,
  );

  it(
    'token-pairs/v1 aggregates all pools: total volume >= primary pool volume, earliest pair <= primary pair',
    async () => {
      const primary = (await dex.getMarketData([WIF])).get(WIF)!;
      const pairs = await dex.getAllPairs(WIF);
      expect(pairs.length).toBeGreaterThan(3);
      const agg = (await dex.getAggregated(WIF))!;
      expect(agg.volume24hUsd).toBeGreaterThanOrEqual(primary.volume24hUsd * 0.99);
      expect(agg.liquidityUsd).toBeGreaterThanOrEqual(primary.liquidityUsd * 0.99);
      expect(agg.pairCreatedAt!).toBeLessThanOrEqual(primary.pairCreatedAt!);
    },
    LIVE_TIMEOUT,
  );

  it(
    'composite merge: Jupiter aggregate volume wins over the single DexScreener pool, age is the earliest known',
    async () => {
      const ep = jupiter();
      const composite = new CompositeMarketData(new JupiterPriceSource(ep.apiBase, 0, ep.headers, ep.limiter), dex, new JupiterTokenListSource(ep.tokensBase, ep.headers, ep.limiter), 150);
      const single = (await dex.getMarketData([POPCAT])).get(POPCAT)!;
      const merged = (await composite.getMarketData([POPCAT], { allPairs: true })).get(POPCAT)!;
      expect(merged.volume24hUsd).toBeGreaterThanOrEqual(single.volume24hUsd);
      expect(merged.pairCreatedAt!).toBeLessThanOrEqual(single.pairCreatedAt!);
      expect(merged.marketCapUsd).toBeGreaterThan(1_000_000);
      expect(merged.source).toBe('mixed');
      expect(merged.logo).toMatch(/^https?:\/\//);
    },
    LIVE_TIMEOUT,
  );
});
