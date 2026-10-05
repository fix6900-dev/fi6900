/**
 * Creator-fee claiming for the $FIX6900 pump.fun coin, isolated behind `CreatorFeeClaimer`.
 *
 * Uses the official @pump-fun/pump-sdk `OnlinePumpSdk` (v2.0.0). Verified against mainnet on 2026-10-03
 * (test/live/pump.live.test.ts, simulate-only):
 *
 *   collectCoinCreatorFeeInstructions(creator, feePayer) -> 4 instructions
 *     1. 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P  collect_creator_fee          (disc 1416567bc61cdb84)
 *        accounts: creator(w) creator_vault(w) system_program event_authority program
 *     2. ATokenGPvb…  create_idempotent WSOL ATA for the creator (PumpSwap pays fees in WSOL)
 *     3. pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA  collect_coin_creator_fee     (disc a039592ab58b2b42)
 *        accounts: wsol_mint token_program creator coin_creator_vault_authority coin_creator_vault_ata(w) creator_ata(w) event_authority program
 *     4. Tokenkeg…  close_account (unwrap the WSOL back to SOL)
 *   Simulation with the real creator as payer and sigVerify:false succeeds end-to-end (err=null).
 *
 *   Claimable amount: `getCreatorVaultBalanceBothPrograms(creator)` = lamports in creatorVaultPda(creator)
 *   (bonding curve program) + WSOL in the PumpSwap coin-creator vault ATA; `getCreatorVaultBalance` is the
 *   bonding-curve part only. Both are plain account reads (no indexed RPC).
 *
 * The SDK's ESM build cannot be `import()`ed from this ESM package (its dependency
 * @pump-fun/agent-payments-sdk does `import { BN } from '@coral-xyz/anchor'`, which Node rejects for a
 * CommonJS module), so the CommonJS build is loaded through createRequire.
 */
import { createRequire } from 'node:module';
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('flywheel.creator-fees');

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_SWAP_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');

export interface CreatorFeeBreakdown {
  /** Lamports claimable from the bonding-curve creator vault. */
  bondingCurve: bigint;
  /** Lamports (WSOL) claimable from the PumpSwap coin-creator vault. */
  pumpSwap: bigint;
  total: bigint;
}

export interface CreatorFeeClaimer {
  /** Claimable lamports across bonding curve + PumpSwap vaults. */
  pendingLamports(creator: PublicKey): Promise<bigint>;
  /** Per-program breakdown (for `/v1/flywheel.creatorFeesUnclaimed*`). */
  pendingBreakdown(creator: PublicKey): Promise<CreatorFeeBreakdown>;
  /** Instructions that move the fees into the creator wallet. May be empty. */
  buildClaimIxs(creator: PublicKey): Promise<TransactionInstruction[]>;
}

type PumpSdkModule = typeof import('@pump-fun/pump-sdk');

interface PumpSdkLike {
  getCreatorVaultBalance(creator: PublicKey): Promise<{ toString(): string }>;
  getCreatorVaultBalanceBothPrograms(creator: PublicKey): Promise<{ toString(): string }>;
  collectCoinCreatorFeeInstructions(creator: PublicKey, feePayer?: PublicKey): Promise<TransactionInstruction[]>;
}

let pumpModule: PumpSdkModule | undefined;

/** Loads the CommonJS build of @pump-fun/pump-sdk (see header). */
export function loadPumpSdk(): PumpSdkModule {
  if (!pumpModule) {
    const require = createRequire(import.meta.url);
    pumpModule = require('@pump-fun/pump-sdk') as PumpSdkModule;
    if (!pumpModule.PUMP_PROGRAM_ID.equals(PUMP_PROGRAM_ID) || !pumpModule.PUMP_AMM_PROGRAM_ID.equals(PUMP_SWAP_PROGRAM_ID)) {
      throw new Error(`@pump-fun/pump-sdk program ids changed: ${pumpModule.PUMP_PROGRAM_ID.toBase58()} / ${pumpModule.PUMP_AMM_PROGRAM_ID.toBase58()}`);
    }
  }
  return pumpModule;
}

/** PDA holding bonding-curve creator fees: ["creator-vault", creator] under the pump program. */
export function creatorVaultPda(creator: PublicKey): PublicKey {
  return loadPumpSdk().creatorVaultPda(creator);
}

/** PumpSwap coin-creator vault authority: ["creator_vault", creator] under pAMM; fees sit in its WSOL ATA. */
export function pumpSwapCreatorVaultPda(creator: PublicKey): PublicKey {
  return loadPumpSdk().ammCreatorVaultPda(creator);
}

export class PumpCreatorFeeClaimer implements CreatorFeeClaimer {
  private sdk: PumpSdkLike | undefined;

  constructor(private readonly connection: Connection) {}

  private load(): PumpSdkLike {
    if (!this.sdk) this.sdk = new (loadPumpSdk().OnlinePumpSdk)(this.connection) as unknown as PumpSdkLike;
    return this.sdk;
  }

  async pendingLamports(creator: PublicKey): Promise<bigint> {
    const bn = await this.load().getCreatorVaultBalanceBothPrograms(creator);
    return BigInt(bn.toString());
  }

  async pendingBreakdown(creator: PublicKey): Promise<CreatorFeeBreakdown> {
    const sdk = this.load();
    const [bc, total] = await Promise.all([sdk.getCreatorVaultBalance(creator), sdk.getCreatorVaultBalanceBothPrograms(creator)]);
    const bondingCurve = BigInt(bc.toString());
    const all = BigInt(total.toString());
    return { bondingCurve, pumpSwap: all > bondingCurve ? all - bondingCurve : 0n, total: all };
  }

  async buildClaimIxs(creator: PublicKey): Promise<TransactionInstruction[]> {
    const ixs = await this.load().collectCoinCreatorFeeInstructions(creator, creator);
    const programs = new Set(ixs.map((ix) => ix.programId.toBase58()));
    log.debug({ n: ixs.length, programs: [...programs] }, 'claim instructions built');
    return ixs;
  }
}

/** Test/mock implementation. */
export class StaticCreatorFeeClaimer implements CreatorFeeClaimer {
  constructor(private lamports: bigint) {}
  async pendingLamports(): Promise<bigint> {
    return this.lamports;
  }
  async pendingBreakdown(): Promise<CreatorFeeBreakdown> {
    return { bondingCurve: this.lamports, pumpSwap: 0n, total: this.lamports };
  }
  async buildClaimIxs(): Promise<TransactionInstruction[]> {
    this.lamports = 0n;
    return [];
  }
}
