/**
 * Flywheel orchestrator (ARCHITECTURE.md section 4), run every DIST_INTERVAL by the dev wallet:
 *
 *   claim creator fees ->  50% LP leg   : 25% buys $FI6900 on Jupiter, paired with 25% SOL -> Meteora
 *                      ->  50% airdrop  : buy basket -> create units -> pro-rata airdrop to $FI holders
 */
import type { PublicKey } from '@solana/web3.js';
import type { ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import { creationBasket, INDEX_DECIMALS } from '../nav/compute.js';
import type { NavService } from '../nav/service.js';
import { WSOL_MINT, type QuoteSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { uiToBigint } from '../util/math.js';
import type { AirdropRunner, AirdropRoundResult } from './airdrop-runner.js';
import type { CreatorFeeClaimer } from './creator-fees.js';
import type { LpProvider } from './lp.js';

const log = childLogger('flywheel');

export interface FlywheelDeps {
  chain: ChainClient;
  devTx: TxSender;
  devWallet: PublicKey;
  nav: NavService;
  quotes: QuoteSource;
  claimer: CreatorFeeClaimer;
  lp: LpProvider;
  airdrop: AirdropRunner;
  repo: Repo;
  env: Env;
  events: EventBus;
}

export interface FlywheelCycleResult {
  claimedLamports: bigint;
  lpSigs: string[];
  createdUnits: bigint;
  airdrop: AirdropRoundResult | null;
  skipped?: string;
}

export class Flywheel {
  constructor(private readonly d: FlywheelDeps) {}

  async runCycle(opts: { dry?: boolean; skipAirdrop?: boolean } = {}): Promise<FlywheelCycleResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    if (!this.d.env.FLYWHEEL_ENABLED) return { claimedLamports: 0n, lpSigs: [], createdUnits: 0n, airdrop: null, skipped: 'flywheel disabled' };
    const nav = await this.d.nav.get();

    // ---- 1) claim ----
    let claimed = 0n;
    const pending = await this.d.claimer.pendingLamports(this.d.devWallet).catch((e: Error) => {
      log.warn({ err: e.message }, 'could not read creator vault');
      return 0n;
    });
    const minClaim = uiToBigint(this.d.env.MIN_CLAIM_SOL, 9);
    if (pending >= minClaim && pending > 0n) {
      const ixs = await this.d.claimer.buildClaimIxs(this.d.devWallet);
      const sig = ixs.length ? await this.d.devTx.sendIxs(ixs, { label: 'collect creator fees' }) : DRY_RUN_SIG;
      claimed = pending;
      this.d.repo.insertFlywheelEvent({ kind: 'claim', sig: dry ? DRY_RUN_SIG : sig, amounts: { sol: Number(pending) / 1e9, lamports: pending }, note: 'pump.fun + PumpSwap creator fees' });
      this.d.events.emit('flywheel_event', { kind: 'claim', sol: Number(pending) / 1e9 });
      log.info({ sol: Number(pending) / 1e9, sig }, 'creator fees claimed');
    } else {
      log.info({ pendingSol: Number(pending) / 1e9, minSol: this.d.env.MIN_CLAIM_SOL }, 'creator fees below claim threshold');
    }

    const lpSigs: string[] = [];
    let createdUnits = 0n;
    if (claimed > 0n) {
      const half = claimed / 2n;
      // ---- 2a) LP leg ----
      try {
        lpSigs.push(...(await this.lpLeg(half, nav.nav.navPerUnitUsd, nav.solPriceUsd, dry)));
      } catch (err) {
        log.error({ err: (err as Error).message }, 'LP leg failed');
      }
      // ---- 2b) airdrop leg: buy basket -> create units ----
      try {
        createdUnits = await this.createUnitsFromSol(claimed - half, nav.nav.navPerUnitUsd, nav.solPriceUsd, dry);
      } catch (err) {
        log.error({ err: (err as Error).message }, 'airdrop creation leg failed');
      }
    }

    // ---- 3) distribute whatever is in the pool ----
    let airdrop: AirdropRoundResult | null = null;
    if (!opts.skipAirdrop) {
      airdrop = await this.d.airdrop.run({ solPriceUsd: nav.solPriceUsd, navPerUnitUsd: nav.nav.navPerUnitUsd, dry });
    }
    return { claimedLamports: claimed, lpSigs, createdUnits, airdrop };
  }

  /** 50% of the LP half buys $FI6900 on Jupiter; the other 50% stays SOL; both go into Meteora. */
  private async lpLeg(lamports: bigint, navPerUnit: number, solUsd: number, dry: boolean): Promise<string[]> {
    const sigs: string[] = [];
    const buySol = lamports / 2n;
    const pairSol = lamports - buySol;
    const indexMint = this.d.chain.indexMint.toBase58();
    let indexBought = uiToBigint(((Number(buySol) / 1e9) * solUsd) / Math.max(navPerUnit, 1e-9), INDEX_DECIMALS);
    if (dry) {
      this.d.repo.insertFlywheelEvent({ kind: 'buy_index', sig: DRY_RUN_SIG, amounts: { sol: Number(buySol) / 1e9, units: indexBought }, note: 'DRY_RUN LP leg buy' });
      this.d.repo.insertFlywheelEvent({ kind: 'add_lp', sig: DRY_RUN_SIG, amounts: { sol: Number(pairSol) / 1e9, units: indexBought, pool: this.d.env.METEORA_POOL ?? null }, note: 'DRY_RUN add liquidity' });
      return [DRY_RUN_SIG];
    }
    const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: indexMint, amount: buySol, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
    const buySig = await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, this.d.devWallet.toBase58()), { label: 'LP leg: buy $FI6900' });
    sigs.push(buySig);
    indexBought = q.outAmount;
    this.d.repo.insertFlywheelEvent({ kind: 'buy_index', sig: buySig, amounts: { sol: Number(buySol) / 1e9, units: indexBought }, note: 'LP leg buy on Jupiter' });

    const lp = await this.d.lp.addLiquidity({ owner: this.d.devWallet, indexAmount: indexBought, solLamports: pairSol });
    sigs.push(...lp.sigs);
    this.d.repo.insertFlywheelEvent({
      kind: 'add_lp',
      sig: lp.sigs[0] ?? 'held',
      amounts: { sol: Number(pairSol) / 1e9, units: indexBought, position: lp.position, pool: this.d.env.METEORA_POOL ?? null },
      note: this.d.lp.configured ? 'Meteora DAMM v2 liquidity added' : 'pool not configured; held in dev wallet',
    });
    this.d.events.emit('flywheel_event', { kind: 'add_lp', sol: Number(pairSol) / 1e9 });
    return sigs;
  }

  /** Buys the creation basket with SOL on Jupiter, then creates units in kind. Units go to the airdrop pool. */
  private async createUnitsFromSol(lamports: bigint, navPerUnit: number, solUsd: number, dry: boolean): Promise<bigint> {
    if (navPerUnit <= 0) throw new Error('nav per unit unknown');
    const usd = (Number(lamports) / 1e9) * solUsd;
    // 2% headroom for slippage + mint fee
    const units = uiToBigint((usd / navPerUnit) * 0.98, INDEX_DECIMALS);
    if (units <= 0n) return 0n;
    const nav = await this.d.nav.get();
    const fund = nav.fund;
    const netUnits = units - (units * BigInt(fund.mintFeeBps)) / 10_000n;
    if (dry) {
      this.d.repo.insertFlywheelEvent({ kind: 'create', sig: DRY_RUN_SIG, amounts: { units, netUnits, sol: Number(lamports) / 1e9, source: 'flywheel' }, note: 'DRY_RUN airdrop leg creation' });
      this.d.airdrop.addToPool(netUnits);
      return netUnits;
    }
    if (fund.openAuctions > 0) throw new Error('auctions open; cannot begin_mint');
    const basket = creationBasket(nav.assets, units, nav.nav.supply);
    const sigs: string[] = [];
    for (const leg of basket) {
      if (leg.amount === 0n) continue;
      const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: leg.mint, amount: leg.amount, slippageBps: this.d.env.AP_SLIPPAGE_BPS, swapMode: 'ExactOut' });
      sigs.push(await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, this.d.devWallet.toBase58()), { label: `flywheel buy ${leg.mint}` }));
    }
    const txs = await this.d.chain.buildMintTxs(units, this.d.devWallet);
    sigs.push(...(await this.d.devTx.sendMany(txs, { label: 'flywheel mint' })));
    this.d.airdrop.addToPool(netUnits);
    this.d.repo.insertFlywheelEvent({ kind: 'create', sig: sigs[sigs.length - 1] ?? DRY_RUN_SIG, amounts: { units, netUnits, sol: Number(lamports) / 1e9, legs: sigs, source: 'flywheel' }, note: 'airdrop leg: basket bought and units created' });
    this.d.events.emit('flywheel_event', { kind: 'create', units: netUnits.toString() });
    return netUnits;
  }
}
