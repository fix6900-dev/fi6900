import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { PUMP_PROGRAM_ID, PUMP_SWAP_PROGRAM_ID, PumpCreatorFeeClaimer, creatorVaultPda, loadPumpSdk, pumpSwapCreatorVaultPda } from '../../src/flywheel/creator-fees.js';
import { LIVE, LIVE_TIMEOUT, connection } from './_live.js';

/**
 * pump.fun creator-fee claim against the deployed programs (simulate only). Finds a live pump.fun coin in
 * Jupiter's top-traded list (vanity mints end in "pump"), reads its creator from the bonding curve, builds the
 * claim with the REAL creator as payer/signer and simulates with sigVerify:false so the programs actually run.
 * Verified 2026-10-03: 4 instructions (pump collect_creator_fee, WSOL ATA create, pAMM collect_coin_creator_fee,
 * close WSOL) and err=null.
 */
describe.skipIf(!LIVE)('LIVE pump.fun creator fees', () => {
  const conn = connection();
  const claimer = new PumpCreatorFeeClaimer(conn);

  async function findCreator(): Promise<{ mint: PublicKey; creator: PublicKey; symbol: string }> {
    const sdk = loadPumpSdk();
    const online = new sdk.OnlinePumpSdk(conn);
    const res = await fetch('https://lite-api.jup.ag/tokens/v2/toptraded/24h?limit=100');
    const list = (await res.json()) as { id: string; symbol: string; tags?: string[] }[];
    for (const t of list.filter((x) => x.id.endsWith('pump')).slice(0, 10)) {
      try {
        const bc = await online.fetchBondingCurve(new PublicKey(t.id));
        const creator = (bc as unknown as { creator: PublicKey }).creator;
        if (creator && !creator.equals(PublicKey.default)) return { mint: new PublicKey(t.id), creator, symbol: t.symbol };
      } catch {
        /* not a pump coin */
      }
    }
    throw new Error('no pump.fun coin with a creator found in top traded');
  }

  it('SDK program ids match the deployed programs', () => {
    const sdk = loadPumpSdk();
    expect(sdk.PUMP_PROGRAM_ID.toBase58()).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    expect(sdk.PUMP_AMM_PROGRAM_ID.toBase58()).toBe('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
    expect(PUMP_PROGRAM_ID.equals(sdk.PUMP_PROGRAM_ID)).toBe(true);
    expect(PUMP_SWAP_PROGRAM_ID.equals(sdk.PUMP_AMM_PROGRAM_ID)).toBe(true);
  });

  it(
    'Global account decodes and the creator vault PDAs derive',
    async () => {
      const sdk = loadPumpSdk();
      const g = await new sdk.OnlinePumpSdk(conn).fetchGlobal();
      expect(g.feeRecipient).toBeInstanceOf(PublicKey);
      const { creator } = await findCreator();
      const [vault, bump] = PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM_ID);
      expect(creatorVaultPda(creator).equals(vault)).toBe(true);
      expect(bump).toBeLessThanOrEqual(255);
      const [ammVault] = PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), creator.toBuffer()], PUMP_SWAP_PROGRAM_ID);
      expect(pumpSwapCreatorVaultPda(creator).equals(ammVault)).toBe(true);
    },
    LIVE_TIMEOUT,
  );

  it(
    'claimable fees are readable per program and the claim tx simulates through both programs',
    async () => {
      const { creator, symbol } = await findCreator();
      const b = await claimer.pendingBreakdown(creator);
      // eslint-disable-next-line no-console
      console.log(`${symbol} creator ${creator.toBase58()} unclaimed: bonding curve ${Number(b.bondingCurve) / 1e9} SOL, PumpSwap ${Number(b.pumpSwap) / 1e9} SOL`);
      expect(b.total).toBe(b.bondingCurve + b.pumpSwap);
      expect(await claimer.pendingLamports(creator)).toBe(b.total);

      const ixs = await claimer.buildClaimIxs(creator);
      const programs = ixs.map((ix) => ix.programId.toBase58());
      expect(programs).toContain(PUMP_PROGRAM_ID.toBase58());
      expect(programs).toContain(PUMP_SWAP_PROGRAM_ID.toBase58());
      // the creator must sign the pump leg (creator account is a writable signer)
      const pumpIx = ixs.find((ix) => ix.programId.equals(PUMP_PROGRAM_ID))!;
      expect(pumpIx.keys.some((k) => k.pubkey.equals(creator) && k.isWritable)).toBe(true);

      const bh = await conn.getLatestBlockhash();
      const msg = new TransactionMessage({ payerKey: creator, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message();
      const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
      const logs = (sim.value.logs ?? []).join('\n');
      expect(logs).toContain('Instruction: CollectCreatorFee');
      expect(logs).toContain('Instruction: CollectCoinCreatorFee');
      expect(sim.value.err, logs).toBeNull();

      // with a throwaway (unfunded) payer the only failure is the fee payer check, before any program runs
      const msg2 = new TransactionMessage({ payerKey: Keypair.generate().publicKey, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message();
      const sim2 = await conn.simulateTransaction(new VersionedTransaction(msg2), { sigVerify: false, replaceRecentBlockhash: true });
      expect(JSON.stringify(sim2.value.err)).toMatch(/AccountNotFound|InsufficientFunds/);
    },
    LIVE_TIMEOUT,
  );
});
