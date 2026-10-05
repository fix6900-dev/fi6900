import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { GpaHolderSource, HeliusHolderSource } from '../../src/sources/helius.js';
import { HELIUS_API_KEY, LIVE, LIVE_TIMEOUT, connection } from './_live.js';

/**
 * Holder snapshots. Picks a mid-size token (a few thousand holders) from Jupiter's top-traded list so the gPA
 * fallback is exercised without blowing the public RPC's data allowance (BONK-sized mints return ~600 MB).
 * Observed 2026-10-03 on api.mainnet-beta.solana.com: ~17.5k token accounts / 5.9k holders in ~3 s (Token-2022 mint).
 */
describe.skipIf(!LIVE)('LIVE holders', () => {
  async function midSizeMint(): Promise<{ id: string; symbol: string; holderCount: number; tokenProgram: string }> {
    const res = await fetch('https://lite-api.jup.ag/tokens/v2/toptraded/24h?limit=100');
    const list = (await res.json()) as { id: string; symbol: string; holderCount?: number; tokenProgram: string }[];
    const pick = list.find((t) => (t.holderCount ?? 0) > 1_500 && (t.holderCount ?? 0) < 8_000);
    if (!pick) throw new Error('no mid-size token in top traded');
    return { id: pick.id, symbol: pick.symbol, holderCount: pick.holderCount ?? 0, tokenProgram: pick.tokenProgram };
  }

  it(
    'getProgramAccounts fallback (dataSlice + memcmp on mint) returns holders for a mid-size token on the configured RPC',
    async () => {
      const t = await midSizeMint();
      const conn = connection();
      const src = new GpaHolderSource(conn);
      const program = await src.resolveProgram(new PublicKey(t.id));
      expect(program.toBase58()).toBe(t.tokenProgram);
      const t0 = Date.now();
      const holders = await src.getHolders(t.id);
      const ms = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`gPA ${t.symbol} (${program.toBase58().slice(0, 8)}): ${holders.length} holders in ${ms} ms (Jupiter holderCount ${t.holderCount})`);
      expect(holders.length).toBeGreaterThan(500);
      expect(holders.length).toBeLessThan(t.holderCount * 1.5 + 1_000);
      expect(holders[0]!.amount).toBeGreaterThanOrEqual(holders[holders.length - 1]!.amount);
      for (const h of holders.slice(0, 20)) expect(() => new PublicKey(h.owner)).not.toThrow();
    },
    LIVE_TIMEOUT,
  );

  it.skipIf(!HELIUS_API_KEY)(
    'Helius DAS getTokenAccounts pages through holders and agrees with gPA within 5%',
    async () => {
      const t = await midSizeMint();
      const das = await new HeliusHolderSource(HELIUS_API_KEY!).getHolders(t.id);
      const gpa = await new GpaHolderSource(connection()).getHolders(t.id);
      expect(Math.abs(das.length - gpa.length) / gpa.length).toBeLessThan(0.05);
    },
    LIVE_TIMEOUT,
  );
});
