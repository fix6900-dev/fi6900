import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { COINGECKO_FREE_BASE, COINGECKO_PRO_BASE, CoinGeckoSource, isValidSolanaMint } from '../../src/sources/coingecko.js';
import { JupiterTokenListSource } from '../../src/sources/jupiter-tokens.js';
import { CompositeUniverseSource } from '../../src/sources/universe.js';
import { BONK, LIVE, LIVE_TIMEOUT, WIF, jupiter } from './_live.js';

/**
 * Live contract test for the CoinGecko surface the universe depends on (verified 2026-10-03):
 *   /coins/markets?category=solana-meme-coins (250/page), /coins/list?include_platform=true (~22k rows), /coins/{id}.
 * Free tier, no key needed (COINGECKO_API_KEY / COINGECKO_PRO honoured when set). ~3-5 requests at 2.1 s spacing.
 */
describe.skipIf(!LIVE)('LIVE coingecko', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-live-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const apiKey = process.env.COINGECKO_API_KEY || undefined;
  const pro = /^(1|true)$/i.test(process.env.COINGECKO_PRO ?? '');
  const cg = new CoinGeckoSource({ apiKey, pro, dataDir: dir });

  it(
    'resolves the Solana Meme Coins category to >= 100 valid mints ranked by market cap, with BONK and WIF near the top',
    async () => {
      expect(cg.base).toBe(pro && apiKey ? COINGECKO_PRO_BASE : COINGECKO_FREE_BASE);
      const res = await cg.resolve(150);
      expect(res.candidates.length).toBeGreaterThanOrEqual(100);
      for (const c of res.candidates) {
        expect(isValidSolanaMint(c.mint), c.cgId).toBe(true);
        expect(c.cgRank).toBeGreaterThan(0);
        expect(c.symbol).toBe(c.symbol.toUpperCase());
      }
      // market_cap_desc order (nulls, if any, sink)
      const caps = res.candidates.map((c) => c.marketCapUsd ?? 0).filter((x) => x > 0);
      for (let i = 1; i < caps.length; i++) expect(caps[i]!).toBeLessThanOrEqual(caps[i - 1]! * 1.05);
      const bonk = res.candidates.find((c) => c.mint === BONK);
      const wif = res.candidates.find((c) => c.mint === WIF);
      expect(bonk?.cgId).toBe('bonk');
      expect(wif?.cgId).toBe('dogwifcoin');
      expect(bonk!.cgRank).toBeLessThanOrEqual(15);
      expect(wif!.cgRank).toBeLessThanOrEqual(15);
      expect(bonk!.marketCapUsd).toBeGreaterThan(1e7);
      expect(bonk!.volume24hUsd).toBeGreaterThan(1e5);
      // only a handful of category members lack a Solana contract on CoinGecko
      expect(res.dropped.length).toBeLessThan(15);
    },
    LIVE_TIMEOUT * 2,
  );

  it(
    'the composite universe merges Jupiter metadata onto CoinGecko members',
    async () => {
      const ep = jupiter();
      const jup = new JupiterTokenListSource(ep.tokensBase, ep.headers, ep.limiter);
      const u = new CompositeUniverseSource('coingecko', jup, cg);
      const list = await u.universe(40);
      expect(list.length).toBeGreaterThanOrEqual(35);
      const bonk = list.find((c) => c.mint === BONK)!;
      expect(bonk.decimals).toBe(5);
      expect(bonk.cg?.id).toBe('bonk');
      expect(bonk.universeSource).toBe('coingecko');
      expect(bonk.tags.length).toBeGreaterThan(0); // from Jupiter
      expect(bonk.stats?.liquidityUsd ?? 0).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT * 2,
  );
});
