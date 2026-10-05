/** Executes an airdrop round: holder snapshot -> shares -> batched SPL transfers -> bookkeeping. */
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import { INDEX_DECIMALS } from '../nav/compute.js';
import type { HolderSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { batch, computeAirdrop, minUnitsForRent, type Payout } from './airdrop.js';
import { buildHolderExclusions } from './exclusions.js';

const log = childLogger('flywheel.airdrop');
export const AIRDROP_POOL_KEY = 'airdrop_pool_units';

export interface AirdropRunnerDeps {
  connection: Connection;
  tx: TxSender; // dev wallet
  holders: HolderSource;
  repo: Repo;
  env: Env;
  events: EventBus;
  indexMint: PublicKey;
  coinMint: PublicKey;
}

export interface AirdropRoundResult {
  roundId: number | null;
  holders: number;
  paid: number;
  skipped: number;
  distributedUnits: bigint;
  carriedUnits: bigint;
  txCount: number;
  sigs: string[];
}

export class AirdropRunner {
  constructor(private readonly d: AirdropRunnerDeps) {}

  /** Wallets that must never receive airdrops: LP pools / PDAs (off-curve), program accounts, denylist, our own wallets. */
  async buildExclusions(owners: readonly string[]): Promise<Set<string>> {
    return buildHolderExclusions({ connection: this.d.connection, env: this.d.env, own: [this.d.tx.payer.toBase58()] }, owners);
  }

  poolUnits(): bigint {
    return BigInt(this.d.repo.getKv(AIRDROP_POOL_KEY) ?? '0');
  }

  addToPool(units: bigint): void {
    this.d.repo.setKv(AIRDROP_POOL_KEY, (this.poolUnits() + units).toString());
  }

  async run(p: { solPriceUsd: number; navPerUnitUsd: number; dry?: boolean }): Promise<AirdropRoundResult> {
    const dry = p.dry ?? this.d.tx.dryRun;
    const total = this.poolUnits();
    const empty: AirdropRoundResult = { roundId: null, holders: 0, paid: 0, skipped: 0, distributedUnits: 0n, carriedUnits: 0n, txCount: 0, sigs: [] };
    if (total <= 0n) {
      log.info('airdrop pool empty; nothing to distribute');
      return empty;
    }
    const holders = await this.d.holders.getHolders(this.d.coinMint.toBase58());
    const exclude = await this.buildExclusions(holders.map((h) => h.owner));
    const minUnits = minUnitsForRent(this.d.env.ATA_RENT_LAMPORTS, p.solPriceUsd, p.navPerUnitUsd);
    const result = computeAirdrop({ holders, totalUnits: total, carry: this.d.repo.getCarry(), minUnits, exclude });
    log.info(
      { holders: holders.length, eligible: result.eligibleHolders, paid: result.payouts.length, skipped: result.skipped, units: result.distributedUnits.toString(), minUnits: minUnits.toString(), dry },
      'airdrop computed',
    );
    if (result.payouts.length === 0) {
      if (!dry) this.d.repo.setCarry(result.carry);
      return { ...empty, holders: holders.length, skipped: result.skipped, carriedUnits: result.carriedUnits };
    }

    const sigs = await this.transfer(result.payouts, dry);
    const status = dry ? 'dry-run' : sigs.length === Math.ceil(result.payouts.length / this.d.env.AIRDROP_BATCH_SIZE) ? 'complete' : 'partial';
    const roundId = this.d.repo.insertAirdropRound({
      totalUnits: total,
      holders: holders.length,
      paid: result.payouts.length,
      skipped: result.skipped,
      carriedUnits: result.carriedUnits,
      txCount: sigs.length,
      status,
    });
    const batches = batch(result.payouts, this.d.env.AIRDROP_BATCH_SIZE);
    const payoutRows = batches.flatMap((b, idx) => b.map((pp) => ({ wallet: pp.wallet, units: pp.units, sig: sigs[idx] ?? 'failed' })));
    this.d.repo.insertPayouts(roundId, payoutRows.filter((r) => r.sig !== 'failed'));
    if (!dry) {
      this.d.repo.setCarry(result.carry);
      // Pool keeps rounding dust + anything whose batch failed.
      const failedUnits = payoutRows.filter((r) => r.sig === 'failed').reduce((s, r) => s + r.units, 0n);
      this.d.repo.setKv(AIRDROP_POOL_KEY, (result.undistributedUnits + failedUnits).toString());
    }
    this.d.repo.insertFlywheelEvent({
      kind: 'airdrop',
      sig: sigs[0] ?? DRY_RUN_SIG,
      amounts: { roundId, units: result.distributedUnits, wallets: result.payouts.length, skipped: result.skipped, carried: result.carriedUnits, txs: sigs },
      note: dry ? 'DRY_RUN airdrop round' : `airdrop round ${roundId}`,
    });
    this.d.events.emit('flywheel_event', { kind: 'airdrop', roundId, units: result.distributedUnits.toString(), wallets: result.payouts.length });
    return { roundId, holders: holders.length, paid: result.payouts.length, skipped: result.skipped, distributedUnits: result.distributedUnits, carriedUnits: result.carriedUnits, txCount: sigs.length, sigs };
  }

  /** 18 transfers per tx; recipients lacking an ATA get an idempotent create in the same tx. */
  private async transfer(payouts: readonly Payout[], dry: boolean): Promise<string[]> {
    const from = getAssociatedTokenAddressSync(this.d.indexMint, this.d.tx.payer, false, TOKEN_PROGRAM_ID);
    const sigs: string[] = [];
    for (const group of batch(payouts, this.d.env.AIRDROP_BATCH_SIZE)) {
      const atas = group.map((p) => getAssociatedTokenAddressSync(this.d.indexMint, new PublicKey(p.wallet), true, TOKEN_PROGRAM_ID));
      const infos = dry ? atas.map(() => null) : await this.d.connection.getMultipleAccountsInfo(atas);
      const ixs: TransactionInstruction[] = [];
      group.forEach((p, idx) => {
        const ata = atas[idx];
        if (!ata) return;
        if (!infos[idx]) ixs.push(createAssociatedTokenAccountIdempotentInstruction(this.d.tx.payer, ata, new PublicKey(p.wallet), this.d.indexMint));
        ixs.push(createTransferCheckedInstruction(from, this.d.indexMint, ata, this.d.tx.payer, p.units, INDEX_DECIMALS));
      });
      try {
        if (dry) {
          log.info({ recipients: group.length, ixs: ixs.length }, 'DRY_RUN airdrop batch');
          sigs.push(DRY_RUN_SIG);
        } else {
          sigs.push(await this.d.tx.sendIxs(ixs, { label: `airdrop batch ${sigs.length + 1}`, computeUnits: 400_000 }));
        }
      } catch (err) {
        log.error({ err: (err as Error).message, batch: sigs.length + 1 }, 'airdrop batch failed');
        sigs.push('failed');
      }
    }
    return sigs.map((s) => s);
  }
}
