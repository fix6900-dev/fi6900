import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { CP_AMM_PROGRAM_ID, MeteoraLpProvider, buildCreateIndexSolPool, loadCpAmm, readPool } from '../../src/flywheel/lp.js';
import type { TxSender } from '../../src/chain/tx.js';
import { LIVE, LIVE_TIMEOUT, connection } from './_live.js';

/**
 * Meteora DAMM v2 (cp-amm) against a real pool. Finds a live DAMM v2 X/SOL pool through DexScreener (dexId
 * "meteora", label "DYN2"), reads it, quotes a deposit and builds the add-liquidity and create-pool transactions
 * for the pool's creator (funded, sigVerify:false). Both must reach the cp-amm program and fail ONLY at the token
 * transfer (the creator does not hold the tokens) - that proves the instruction layouts. Verified 2026-10-03.
 */
describe.skipIf(!LIVE)('LIVE meteora damm v2', () => {
  const conn = connection();

  async function findPool(): Promise<{ pool: PublicKey; base: PublicKey; symbol: string }> {
    const res = await fetch('https://lite-api.jup.ag/tokens/v2/toptraded/24h?limit=60');
    const list = (await res.json()) as { id: string; symbol: string }[];
    for (const t of list.slice(0, 40)) {
      const pairs = (await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${t.id}`)).json()) as { dexId: string; labels?: string[]; pairAddress: string; quoteToken: { address: string }; liquidity?: { usd?: number } }[];
      const p = pairs.find((x) => x.dexId === 'meteora' && (x.labels ?? []).includes('DYN2') && x.quoteToken.address === NATIVE_MINT.toBase58() && (x.liquidity?.usd ?? 0) > 20_000);
      if (p) return { pool: new PublicKey(p.pairAddress), base: new PublicKey(t.id), symbol: t.symbol };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('no DAMM v2 X/SOL pool found');
  }

  const simulate = async (tx: { instructions: unknown[]; feePayer?: PublicKey; recentBlockhash?: string; compileMessage(): import('@solana/web3.js').Message }, payer: PublicKey) => {
    tx.feePayer = payer;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true });
    return { err: JSON.stringify(sim.value.err), logs: (sim.value.logs ?? []).join('\n'), units: sim.value.unitsConsumed ?? 0 };
  };

  it('SDK program id matches the deployed cp-amm program', async () => {
    const mod = await loadCpAmm();
    expect(mod.CP_AMM_PROGRAM_ID.toBase58()).toBe(CP_AMM_PROGRAM_ID.toBase58());
    expect(CP_AMM_PROGRAM_ID.toBase58()).toBe('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');
  });

  it(
    'pool state reads and the deposit quote + add-liquidity tx reach the program (funded owner, no tokens)',
    async () => {
      const { pool, base, symbol } = await findPool();
      const mod = await loadCpAmm();
      const st = await new mod.CpAmm(conn).fetchPoolState(pool);
      const snap = await readPool(conn, pool, await mod.getTokenDecimals(conn, st.tokenAMint), 9);
      // eslint-disable-next-line no-console
      console.log(`${symbol}/SOL pool ${pool.toBase58()} price ${snap.priceAinB} SOL, vaults ${snap.tokenAVaultAmount}/${snap.tokenBVaultAmount}`);
      expect(snap.tokenBMint).toBe(NATIVE_MINT.toBase58());
      expect(snap.priceAinB).toBeGreaterThan(0);
      expect(snap.tokenAVaultAmount).toBeGreaterThan(0n);

      const owner = (st as unknown as { creator: PublicKey }).creator;
      const fakeTx = { dryRun: true, payer: owner } as unknown as TxSender;
      const lp = new MeteoraLpProvider(conn, fakeTx, pool, base);
      const built = await lp.buildAddLiquidity({ owner, indexAmount: 10n ** 15n, solLamports: 10_000_000n });
      expect(built.indexIn).toBeGreaterThan(0n);
      expect(built.solIn).toBe(10_000_000n);
      expect(built.tx.instructions.some((ix) => ix.programId.equals(CP_AMM_PROGRAM_ID))).toBe(true);
      const r = await simulate(built.tx, owner);
      expect(r.logs).toContain('Instruction: AddLiquidity');
      // success, or failure inside the token transfer because the creator holds no tokens; never a layout/deser error
      expect(r.err === 'null' || /insufficient funds|Custom":1\}/.test(r.err + r.logs), r.err + '\n' + r.logs).toBe(true);
      expect(r.logs).not.toMatch(/InstructionDidNotDeserialize|AccountDidNotDeserialize|invalid account data/i);
    },
    LIVE_TIMEOUT,
  );

  it(
    'create-pool (initializePool) for an X/SOL pair at a chosen price reaches the program',
    async () => {
      const { pool, base } = await findPool();
      const mod = await loadCpAmm();
      const st = await new mod.CpAmm(conn).fetchPoolState(pool);
      const owner = (st as unknown as { creator: PublicKey }).creator;
      const decimals = await mod.getTokenDecimals(conn, base);
      // pick a config index whose pool for this pair does not exist yet
      let configIndex = 2;
      for (; configIndex < 6; configIndex++) {
        const cfg = mod.deriveConfigAddress(new (await import('bn.js')).default(configIndex));
        if (!(await conn.getAccountInfo(mod.derivePoolAddress(cfg, base, NATIVE_MINT)))) break;
      }
      const plan = await buildCreateIndexSolPool({ connection: conn, creator: owner, indexMint: base, indexDecimals: decimals, indexAmount: BigInt(1_000 * 10 ** decimals), priceSolPerUnit: 0.0001, configIndex });
      expect(plan.impliedPriceSolPerUnit).toBeCloseTo(0.0001, 7);
      expect(plan.solLamports).toBe(100_000_000n); // 1000 units * 0.0001 SOL
      expect(plan.pool.equals(mod.derivePoolAddress(plan.config, base, NATIVE_MINT))).toBe(true);
      const r = await simulate(plan.tx, owner);
      expect(r.logs).toMatch(/initializePool|InitializePool|Instruction: Initialize/);
      expect(r.err === 'null' || /insufficient funds|Custom":1\}/.test(r.err + r.logs), r.err + '\n' + r.logs).toBe(true);
      expect(r.logs).not.toMatch(/InstructionDidNotDeserialize|AccountDidNotDeserialize/i);
      expect(plan.positionNft).toBeInstanceOf(Keypair);
    },
    LIVE_TIMEOUT,
  );
});
