/**
 * LP leg: add $FI6900 + SOL liquidity to a Meteora DAMM v2 (cp-amm, program cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG)
 * pool, plus the one-off pool creation used by `keeper create-pool` at launch.
 *
 * Verified against mainnet on 2026-10-03 with @meteora-ag/cp-amm-sdk 1.5.1 (test/live/meteora.live.test.ts):
 *   - fetchPoolState / getDepositQuote / createPositionAndAddLiquidity match the SDK types used here; the SDK
 *     wraps SOL itself when one side is the native mint (wrapSOLInstruction + close WSOL account), so the keeper
 *     passes lamports and never pre-wraps.
 *   - Simulating createPositionAndAddLiquidity for a real pool with a funded owner runs `AddLiquidity` in the
 *     program and fails only at the token transfer (owner has no tokens) -> instruction layout is correct.
 *   - createPool(config = deriveConfigAddress(idx)) runs `initializePool` (position NFT mint + metadata) and fails
 *     only at the transfer -> correct. Public configs idx 0 (collect fee in both tokens) and 1 (fee in quote only)
 *     exist with full price range and 0.25% base fee.
 * If METEORA_POOL is not configured the tokens are held and the action is logged.
 */
import { Keypair, PublicKey, type Connection, type Transaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import type { TxSender } from '../chain/tx.js';
import { DRY_RUN_SIG } from '../chain/tx.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('flywheel.lp');

export const CP_AMM_PROGRAM_ID = new PublicKey('cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG');

export interface LpProvider {
  readonly configured: boolean;
  /** Adds liquidity; returns tx signature(s). amounts are raw. */
  addLiquidity(p: { owner: PublicKey; indexAmount: bigint; solLamports: bigint }): Promise<{ sigs: string[]; position: string | null }>;
}

interface PoolStateLike {
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  tokenAFlag: number;
  tokenBFlag: number;
  sqrtPrice: BN;
  sqrtMinPrice: BN;
  sqrtMaxPrice: BN;
  liquidity: BN;
  collectFeeMode: number;
}

type CpAmmModule = typeof import('@meteora-ag/cp-amm-sdk');

export async function loadCpAmm(): Promise<CpAmmModule> {
  return import('@meteora-ag/cp-amm-sdk');
}

export interface PoolSnapshot {
  pool: string;
  tokenAMint: string;
  tokenBMint: string;
  /** price of token A in token B (UI units), e.g. SOL per index unit when A = index, B = SOL */
  priceAinB: number;
  tokenAVaultAmount: bigint;
  tokenBVaultAmount: bigint;
  liquidity: string;
  collectFeeMode: number;
}

/** Read-only view of a DAMM v2 pool (used by the runbook checks and the live test). */
export async function readPool(connection: Connection, pool: PublicKey, decimalsA: number, decimalsB: number): Promise<PoolSnapshot> {
  const mod = await loadCpAmm();
  const cpAmm = new mod.CpAmm(connection);
  const st = (await cpAmm.fetchPoolState(pool)) as unknown as PoolStateLike;
  const [vaultA, vaultB] = await Promise.all([connection.getTokenAccountBalance(st.tokenAVault), connection.getTokenAccountBalance(st.tokenBVault)]);
  return {
    pool: pool.toBase58(),
    tokenAMint: st.tokenAMint.toBase58(),
    tokenBMint: st.tokenBMint.toBase58(),
    priceAinB: Number(mod.getPriceFromSqrtPrice(st.sqrtPrice, decimalsA, decimalsB).toString()),
    tokenAVaultAmount: BigInt(vaultA.value.amount),
    tokenBVaultAmount: BigInt(vaultB.value.amount),
    liquidity: st.liquidity.toString(),
    collectFeeMode: st.collectFeeMode,
  };
}

export class MeteoraLpProvider implements LpProvider {
  readonly configured = true;

  constructor(
    private readonly connection: Connection,
    private readonly tx: TxSender,
    private readonly pool: PublicKey,
    private readonly indexMint: PublicKey,
    /** Extra SOL the tx may spend above the quote (bps) so a price tick between quote and send does not revert. */
    private readonly solBufferBps = 100,
  ) {}

  /** Builds the add-liquidity transaction without sending (used by DRY_RUN simulation and the live test). */
  async buildAddLiquidity(p: { owner: PublicKey; indexAmount: bigint; solLamports: bigint }): Promise<{ tx: Transaction; positionNft: Keypair; position: PublicKey; solIn: bigint; indexIn: bigint }> {
    const mod = await loadCpAmm();
    const cpAmm = new mod.CpAmm(this.connection);
    const pool = (await cpAmm.fetchPoolState(this.pool)) as unknown as PoolStateLike;
    const indexIsA = pool.tokenAMint.equals(this.indexMint);
    if (!indexIsA && !pool.tokenBMint.equals(this.indexMint)) throw new Error(`pool ${this.pool.toBase58()} does not contain the index mint`);
    const solMint = indexIsA ? pool.tokenBMint : pool.tokenAMint;
    if (!solMint.equals(NATIVE_MINT)) throw new Error(`pool ${this.pool.toBase58()} quote is ${solMint.toBase58()}, expected wSOL`);
    const [vaultA, vaultB] = await Promise.all([this.connection.getTokenAccountBalance(pool.tokenAVault), this.connection.getTokenAccountBalance(pool.tokenBVault)]);
    const tokenAAmount = new BN(vaultA.value.amount);
    const tokenBAmount = new BN(vaultB.value.amount);
    const common = { minSqrtPrice: pool.sqrtMinPrice, maxSqrtPrice: pool.sqrtMaxPrice, sqrtPrice: pool.sqrtPrice, collectFeeMode: pool.collectFeeMode, tokenAAmount, tokenBAmount, liquidity: pool.liquidity };

    // Quote using the SOL side as input so the index side is the dependent amount; cap by what we hold.
    const quote = cpAmm.getDepositQuote({ inAmount: new BN(p.solLamports.toString()), isTokenA: !indexIsA, ...common });
    let indexNeeded = BigInt(quote.outputAmount.toString());
    let liquidityDelta = quote.liquidityDelta;
    let solIn = p.solLamports;
    if (indexNeeded > p.indexAmount) {
      // Not enough index tokens: re-quote from the index side.
      const q2 = cpAmm.getDepositQuote({ inAmount: new BN(p.indexAmount.toString()), isTokenA: indexIsA, ...common });
      liquidityDelta = q2.liquidityDelta;
      solIn = BigInt(q2.outputAmount.toString());
      indexNeeded = p.indexAmount;
    }
    const maxIndex = new BN(indexNeeded.toString());
    const solCap = (solIn * BigInt(10_000 + this.solBufferBps)) / 10_000n;
    const maxSol = new BN((solCap > p.solLamports ? p.solLamports : solCap).toString());
    const positionNft = Keypair.generate();
    const tx = await cpAmm.createPositionAndAddLiquidity({
      owner: p.owner,
      pool: this.pool,
      positionNft: positionNft.publicKey,
      liquidityDelta,
      maxAmountTokenA: indexIsA ? maxIndex : maxSol,
      maxAmountTokenB: indexIsA ? maxSol : maxIndex,
      tokenAAmountThreshold: indexIsA ? maxIndex : maxSol,
      tokenBAmountThreshold: indexIsA ? maxSol : maxIndex,
      tokenAMint: pool.tokenAMint,
      tokenBMint: pool.tokenBMint,
      tokenAProgram: mod.getTokenProgram(pool.tokenAFlag),
      tokenBProgram: mod.getTokenProgram(pool.tokenBFlag),
    });
    return { tx, positionNft, position: mod.derivePositionAddress(positionNft.publicKey), solIn, indexIn: indexNeeded };
  }

  async addLiquidity(p: { owner: PublicKey; indexAmount: bigint; solLamports: bigint }): Promise<{ sigs: string[]; position: string | null }> {
    const built = await this.buildAddLiquidity(p);
    const sig = await this.tx.sendLegacy(built.tx, { signers: [built.positionNft], label: 'meteora add liquidity' });
    const position = built.position.toBase58();
    log.info({ sig, position, solIn: built.solIn.toString(), index: built.indexIn.toString() }, 'liquidity added');
    return { sigs: [sig], position: sig === DRY_RUN_SIG ? null : position };
  }
}

export class HoldLpProvider implements LpProvider {
  readonly configured = false;
  async addLiquidity(p: { owner: PublicKey; indexAmount: bigint; solLamports: bigint }): Promise<{ sigs: string[]; position: string | null }> {
    log.warn({ index: p.indexAmount.toString(), sol: p.solLamports.toString() }, 'METEORA_POOL not configured; holding LP leg in dev wallet');
    return { sigs: [], position: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Pool creation (launch step 4 in docs/launch-runbook.md)
// ---------------------------------------------------------------------------------------------

export interface CreatePoolParams {
  connection: Connection;
  /** Pays rent + supplies both tokens; becomes the position owner. */
  creator: PublicKey;
  indexMint: PublicKey;
  indexDecimals: number;
  /** Raw index units to seed. */
  indexAmount: bigint;
  /** Initial price in SOL per index unit (= NAV per unit in USD / SOL price). */
  priceSolPerUnit: number;
  /** Public DAMM v2 config index. 0 = fees collected in both tokens, 1 = fees collected in quote (SOL) only. */
  configIndex?: number;
}

export interface CreatePoolPlan {
  tx: Transaction;
  positionNft: Keypair;
  pool: PublicKey;
  config: PublicKey;
  position: PublicKey;
  /** Lamports the creator must supply for the SOL side. */
  solLamports: bigint;
  indexAmount: bigint;
  /** Price actually encoded in initSqrtPrice (UI SOL per unit) for the operator to compare with NAV. */
  impliedPriceSolPerUnit: number;
}

/**
 * Builds the `initializePool` transaction for an INDEX/SOL pool at `priceSolPerUnit`.
 * Token A = index mint, token B = wSOL; the SDK orders the PDA seeds itself. The SDK wraps the SOL side.
 */
export async function buildCreateIndexSolPool(p: CreatePoolParams): Promise<CreatePoolPlan> {
  const mod = await loadCpAmm();
  const cpAmm = new mod.CpAmm(p.connection);
  const config = mod.deriveConfigAddress(new BN(p.configIndex ?? 1));
  const cfg = await cpAmm.fetchConfigState(config);
  const indexAmount = new BN(p.indexAmount.toString());
  const solLamports = BigInt(Math.round((Number(p.indexAmount) / 10 ** p.indexDecimals) * p.priceSolPerUnit * 1e9));
  const solAmount = new BN(solLamports.toString());
  const prep = cpAmm.preparePoolCreationParams({
    tokenAAmount: indexAmount,
    tokenBAmount: solAmount,
    minSqrtPrice: cfg.sqrtMinPrice,
    maxSqrtPrice: cfg.sqrtMaxPrice,
    collectFeeMode: cfg.collectFeeMode,
  });
  const positionNft = Keypair.generate();
  const indexInfo = await p.connection.getAccountInfo(p.indexMint);
  if (!indexInfo) throw new Error(`index mint ${p.indexMint.toBase58()} not found`);
  const tx = await cpAmm.createPool({
    creator: p.creator,
    payer: p.creator,
    config,
    positionNft: positionNft.publicKey,
    tokenAMint: p.indexMint,
    tokenBMint: NATIVE_MINT,
    initSqrtPrice: prep.initSqrtPrice,
    liquidityDelta: prep.liquidityDelta,
    tokenAAmount: indexAmount,
    tokenBAmount: solAmount,
    activationPoint: null,
    tokenAProgram: indexInfo.owner,
    tokenBProgram: TOKEN_PROGRAM_ID,
  });
  return {
    tx,
    positionNft,
    pool: mod.derivePoolAddress(config, p.indexMint, NATIVE_MINT),
    config,
    position: mod.derivePositionAddress(positionNft.publicKey),
    solLamports,
    indexAmount: p.indexAmount,
    impliedPriceSolPerUnit: Number(mod.getPriceFromSqrtPrice(prep.initSqrtPrice, p.indexDecimals, 9).toString()),
  };
}
