import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { JupiterPriceSource } from '../../src/sources/jupiter-price.js';
import { JupiterQuoteSource } from '../../src/sources/jupiter-quote.js';
import { JupiterTokenListSource } from '../../src/sources/jupiter-tokens.js';
import { USDC_MINT, WSOL_MINT } from '../../src/sources/types.js';
import { BONK, LIVE, LIVE_TIMEOUT, POPCAT, TRIO, WIF, connection, jupiter } from './_live.js';

/**
 * Live contract test for the Jupiter surface the keeper depends on. Verified 2026-10-03:
 *   price/v3 (<=50 ids), swap/v1 quote+swap, tokens/v2 tag/search. quote-api.jup.ag/v6, tokens.jup.ag, price/v2 are dead.
 */
describe.skipIf(!LIVE)('LIVE jupiter', () => {
  const ep = jupiter();
  const prices = new JupiterPriceSource(ep.apiBase, 0, ep.headers, ep.limiter);
  const quotes = new JupiterQuoteSource(ep.swapBase, ep.headers, 'auto', ep.limiter);
  const tokens = new JupiterTokenListSource(ep.tokensBase, ep.headers, ep.limiter);

  it(
    'price/v3 returns a positive USD price for WIF, BONK, POPCAT and SOL',
    async () => {
      const p = await prices.getPrices([...TRIO, WSOL_MINT]);
      for (const m of [...TRIO, WSOL_MINT]) expect(p.get(m), m).toBeGreaterThan(0);
      expect(p.get(WSOL_MINT)!).toBeGreaterThan(5);
      expect(p.get(BONK)!).toBeLessThan(0.01);
    },
    LIVE_TIMEOUT,
  );

  it(
    'price/v3 batches of more than 50 ids are chunked (the API silently drops ids beyond 50)',
    async () => {
      const list = await tokens.topByVolume(120);
      const ids = list.map((t) => t.mint).slice(0, 110);
      const p = await prices.getPrices(ids);
      // allow a few delisted/unpriced names, but far more than 50 must come back
      expect(p.size).toBeGreaterThan(80);
    },
    LIVE_TIMEOUT,
  );

  it(
    'tokens/v2 verified universe has volume, mcap, fdv, liquidity, age and audit fields',
    async () => {
      const top = await tokens.topByVolume(150);
      expect(top.length).toBe(150);
      expect((top[0]!.dailyVolumeUsd ?? 0) > (top[149]!.dailyVolumeUsd ?? 0)).toBe(true);
      const info = await tokens.getTokenInfo(TRIO);
      for (const m of TRIO) {
        const t = info.get(m)!;
        expect(t, m).toBeDefined();
        expect(t.decimals).toBeGreaterThan(0);
        expect(t.stats?.volume24hUsd ?? 0).toBeGreaterThan(10_000);
        expect(t.stats?.marketCapUsd ?? 0).toBeGreaterThan(1_000_000);
        expect(t.stats?.fdvUsd ?? 0).toBeGreaterThan(1_000_000);
        expect(t.stats?.liquidityUsd ?? 0).toBeGreaterThan(100_000);
        expect(t.stats?.firstPoolCreatedAt ?? 0).toBeGreaterThan(Date.parse('2022-01-01'));
        expect(t.stats?.audit?.mintAuthorityDisabled).toBe(true);
        expect(t.stats?.audit?.freezeAuthorityDisabled).toBe(true);
      }
      expect(info.get(WIF)!.symbol.toUpperCase()).toContain('WIF');
      expect(info.get(POPCAT)!.tags.map((x) => x.toLowerCase())).toContain('verified');
    },
    LIVE_TIMEOUT,
  );

  it(
    'quote: $10k sell of WIF/BONK/POPCAT into USDC parses with a small price impact',
    async () => {
      const p = await prices.getPrices(TRIO);
      const info = await tokens.getTokenInfo(TRIO);
      for (const m of TRIO) {
        const amount = BigInt(Math.floor((10_000 / p.get(m)!) * 10 ** info.get(m)!.decimals));
        const q = await quotes.quote({ inputMint: m, outputMint: USDC_MINT, amount, slippageBps: 500 });
        expect(q.inAmount).toBe(amount);
        expect(Number(q.outAmount) / 1e6).toBeGreaterThan(9_000); // >= $9k out
        expect(Number(q.outAmount) / 1e6).toBeLessThan(11_000);
        expect(q.priceImpactPct).toBeGreaterThanOrEqual(0);
        expect(q.priceImpactPct).toBeLessThan(0.02); // methodology bound 2%
        expect(q.routeLabels.length).toBeGreaterThan(0);
      }
    },
    LIVE_TIMEOUT,
  );

  it(
    'quote ExactOut works (used by AP/flywheel basket buys)',
    async () => {
      const q = await quotes.quote({ inputMint: WSOL_MINT, outputMint: BONK, amount: 100_000_000_000n, slippageBps: 100, swapMode: 'ExactOut' });
      expect(q.outAmount).toBe(100_000_000_000n);
      expect(q.inAmount).toBeGreaterThan(0n);
    },
    LIVE_TIMEOUT,
  );

  it(
    'swap: SOL -> BONK transaction is built for a throwaway wallet, deserializes and simulates (fails only for missing funds)',
    async () => {
      const user = Keypair.generate();
      const q = await quotes.quote({ inputMint: WSOL_MINT, outputMint: BONK, amount: 100_000_000n, slippageBps: 100 });
      const tx = await quotes.swapTx(q, user.publicKey.toBase58());
      expect(tx).toBeInstanceOf(VersionedTransaction);
      expect(tx.message.compiledInstructions.length).toBeGreaterThan(1);
      const conn = connection();
      const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
      // A throwaway wallet has no lamports: the only acceptable failure is the fee payer / funds check.
      const err = JSON.stringify(sim.value.err ?? null);
      expect(err === 'null' || /AccountNotFound|InsufficientFunds|insufficient/i.test(err + (sim.value.logs ?? []).join(' ')), err + '\n' + (sim.value.logs ?? []).join('\n')).toBe(true);
    },
    LIVE_TIMEOUT,
  );
});
