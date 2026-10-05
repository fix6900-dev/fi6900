/**
 * Flywheel orchestrator (ARCHITECTURE.md section 4), run every DIST_INTERVAL by the dev wallet:
 *
 *   claim creator fees ->  50% LP leg   : 25% buys $FI6900 on Jupiter, paired with 25% SOL -> Meteora
 *                      ->  50% airdrop  : buy basket -> create units -> pro-rata airdrop to $FIX6900 holders
 */
import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { MintInfoSource } from '../chain/accounts.js';
import { SystemProgram } from '@solana/web3.js';
import type { BalanceSource } from '../chain/accounts.js';
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
  /** Dev-wallet token balances (PUMP reward sweep). */
  balances?: BalanceSource;
  /** Keeper wallet (arbitrage profits accrue here); excess above KEEPER_SOL_CEILING is recycled into the flywheel. */
  keeperTx?: TxSender;
  /** $FIX6900 coin mint + mint reader (burn mode). */
  coinMint?: PublicKey;
  mints?: MintInfoSource;
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
    const pumpMintKey = new PublicKey(this.d.env.PUMP_REWARD_MINT);
    const pendingPump = this.d.env.PUMP_SWEEP_ENABLED ? await this.d.claimer.pendingQuote(this.d.devWallet, pumpMintKey).catch(() => 0n) : 0n;
    const pumpReady = Number(pendingPump) / 1e6 >= this.d.env.PUMP_SWEEP_MIN && pendingPump > 0n;
    if ((pending >= minClaim && pending > 0n) || pumpReady) {
      const ixs = await this.d.claimer.buildClaimIxs(this.d.devWallet, [pumpMintKey]);
      log.info({ pendingSol: Number(pending) / 1e9, pendingPump: Number(pendingPump) / 1e6, ixs: ixs.length }, 'claiming creator fees (SOL + PUMP quotes)');
      const sig = ixs.length ? await this.d.devTx.sendIxs(ixs, { label: 'collect creator fees' }) : DRY_RUN_SIG;
      claimed = pending;
      if (pending > 0n) {
        this.d.repo.insertFlywheelEvent({ kind: 'claim', sig: dry ? DRY_RUN_SIG : sig, amounts: { sol: Number(pending) / 1e9, lamports: pending }, note: 'pump.fun + PumpSwap creator fees (SOL)' });
        this.d.events.emit('flywheel_event', { kind: 'claim', sol: Number(pending) / 1e9 });
      }
      log.info({ sol: Number(pending) / 1e9, pump: Number(pendingPump) / 1e6, sig }, 'creator fees claimed; PUMP (if any) now in the dev wallet for the sweep');
    } else {
      log.info({ pendingSol: Number(pending) / 1e9, minSol: this.d.env.MIN_CLAIM_SOL }, 'creator fees below claim threshold');
    }

    // ---- 1b) PUMP reward sweep: pump.fun now pays creator rewards in $PUMP. Whatever PUMP sits in the dev wallet
    // (claimed on pump.fun manually or by the keeper) is swapped to SOL on Jupiter and joins the claimed amount.
    if (this.d.env.PUMP_SWEEP_ENABLED && this.d.balances) {
      try {
        const pumpMint = new PublicKey(this.d.env.PUMP_REWARD_MINT);
        // $PUMP is a Token-2022 mint; read both token programs so the sweep is program-agnostic.
        const [legacyBal, t22Bal] = await Promise.all([
          this.d.balances.getTokenBalance(this.d.devWallet, pumpMint, TOKEN_PROGRAM_ID).catch(() => 0n),
          this.d.balances.getTokenBalance(this.d.devWallet, pumpMint, TOKEN_2022_PROGRAM_ID).catch(() => 0n),
        ]);
        const pumpRaw = legacyBal + t22Bal;
        const pumpUi = Number(pumpRaw) / 1e6; // $PUMP has 6 decimals
        if (pumpUi >= this.d.env.PUMP_SWEEP_MIN && pumpRaw > 0n) {
          // Chunked: one big swap routes through too many accounts and overflows the transaction size limit.
          const chunk = uiToBigint(this.d.env.PUMP_SWEEP_CHUNK, 6);
          let left = pumpRaw;
          let sweptSol = 0n;
          const sigs: string[] = [];
          while (left > 0n) {
            const amt = left > chunk ? chunk : left;
            const q = await this.d.quotes.quote({ inputMint: pumpMint.toBase58(), outputMint: WSOL_MINT, amount: amt, slippageBps: this.d.env.AP_SLIPPAGE_BPS, maxAccounts: 40 });
            const sig = dry ? DRY_RUN_SIG : await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, this.d.devWallet.toBase58()), { label: `sweep PUMP -> SOL (${Number(amt) / 1e6})` });
            sigs.push(sig);
            sweptSol += q.outAmount;
            left -= amt;
            if (dry && left > 0n) { sweptSol += (q.outAmount * left) / amt; break; }
          }
          claimed += sweptSol;
          this.d.repo.insertFlywheelEvent({ kind: 'claim', sig: sigs[0] ?? DRY_RUN_SIG, amounts: { sol: Number(sweptSol) / 1e9, lamports: sweptSol, pump: pumpUi, swaps: sigs }, note: 'pump.fun creator rewards paid in $PUMP, swept to SOL' });
          this.d.events.emit('flywheel_event', { kind: 'claim', sol: Number(sweptSol) / 1e9 });
          log.info({ pump: pumpUi, sol: Number(sweptSol) / 1e9, swaps: sigs.length }, 'PUMP creator rewards swept to SOL');
        } else if (pumpUi > 0) {
          log.info({ pump: pumpUi, min: this.d.env.PUMP_SWEEP_MIN }, 'PUMP rewards below sweep threshold');
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'PUMP sweep failed');
      }
    }

    // ---- 1c) recycle arbitrage profit: keeper SOL above the working-capital ceiling moves to the dev wallet and
    // joins the claimed amount, so it is split 50% liquidity / 50% airdrop like creator fees.
    if (this.d.keeperTx && this.d.balances) {
      try {
        const keeperSol = Number(await this.d.balances.getSolBalance(this.d.keeperTx.payer)) / 1e9;
        const excess = keeperSol - this.d.env.KEEPER_SOL_CEILING;
        if (excess >= this.d.env.KEEPER_RECYCLE_MIN_SOL) {
          const lamports = uiToBigint(excess, 9);
          const sig = dry
            ? DRY_RUN_SIG
            : await this.d.keeperTx.sendIxs([SystemProgram.transfer({ fromPubkey: this.d.keeperTx.payer, toPubkey: this.d.devWallet, lamports })], { label: 'recycle arbitrage profit' });
          claimed += lamports;
          this.d.repo.insertFlywheelEvent({ kind: 'claim', sig, amounts: { sol: excess, lamports, keeperSolBefore: keeperSol, ceiling: this.d.env.KEEPER_SOL_CEILING, source: 'arbitrage' }, note: 'arbitrage profit above the keeper ceiling recycled into the flywheel' });
          this.d.events.emit('flywheel_event', { kind: 'claim', sol: excess });
          log.info({ keeperSol, ceiling: this.d.env.KEEPER_SOL_CEILING, recycledSol: excess, sig }, 'arbitrage profit recycled');
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'profit recycle failed');
      }
    }

    const lpSigs: string[] = [];
    let createdUnits = 0n;
    if (claimed > 0n) {
      const half = claimed / 2n;
      // ---- 2a) LP leg (or buyback-and-burn of $FIX6900 when FLYWHEEL_LP_MODE=burn) ----
      try {
        if (this.d.env.FLYWHEEL_LP_MODE === 'burn') lpSigs.push(...(await this.burnLeg(half, dry)));
        else lpSigs.push(...(await this.lpLeg(half, nav.nav.navPerUnitUsd, nav.solPriceUsd, dry)));
      } catch (err) {
        log.error({ err: (err as Error).message, mode: this.d.env.FLYWHEEL_LP_MODE }, 'LP/burn leg failed');
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

  /** Burn leg: buy $FIX6900 on Jupiter with the dev wallet and burn it (provable SPL burn). */
  private async burnLeg(lamports: bigint, dry: boolean): Promise<string[]> {
    if (!this.d.coinMint || !this.d.mints || !this.d.balances) throw new Error('burn mode needs coinMint, mints and balances');
    const coin = this.d.coinMint;
    if (dry) {
      this.d.repo.insertFlywheelEvent({ kind: 'buyback', sig: DRY_RUN_SIG, amounts: { sol: Number(lamports) / 1e9, source: 'flywheel' }, note: 'DRY_RUN flywheel buyback' });
      this.d.repo.insertFlywheelEvent({ kind: 'burn', sig: DRY_RUN_SIG, amounts: { coin: 0, source: 'flywheel' }, note: 'DRY_RUN flywheel burn' });
      return [DRY_RUN_SIG];
    }
    const sigs: string[] = [];
    const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: coin.toBase58(), amount: lamports, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
    const buySig = await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, this.d.devWallet.toBase58()), { label: 'flywheel buyback $FIX6900' });
    sigs.push(buySig);
    this.d.repo.insertFlywheelEvent({ kind: 'buyback', sig: buySig, amounts: { sol: Number(lamports) / 1e9, coin: q.outAmount, source: 'flywheel' }, note: 'creator-fee buyback of $FIX6900' });
    const info = (await this.d.mints.getMintInfo([coin.toBase58()])).get(coin.toBase58());
    const decimals = info?.decimals ?? 6;
    const program = info ? new PublicKey(info.tokenProgram) : TOKEN_2022_PROGRAM_ID;
    const bal = await this.d.balances.getTokenBalance(this.d.devWallet, coin, program);
    const toBurn = bal < q.outAmount ? bal : q.outAmount;
    if (toBurn > 0n) {
      const ata = getAssociatedTokenAddressSync(coin, this.d.devWallet, false, program);
      const burnSig = await this.d.devTx.sendIxs([createBurnCheckedInstruction(ata, coin, this.d.devWallet, toBurn, decimals, [], program)], { label: 'flywheel burn $FIX6900' });
      sigs.push(burnSig);
      this.d.repo.insertFlywheelEvent({ kind: 'burn', sig: burnSig, amounts: { coin: Number(toBurn) / 10 ** decimals, coinRaw: toBurn, source: 'flywheel' }, note: 'provable SPL burn (creator fees)' });
      this.d.events.emit('flywheel_event', { kind: 'burn', coin: Number(toBurn) / 10 ** decimals, sig: burnSig });
      log.info({ sol: Number(lamports) / 1e9, burned: Number(toBurn) / 10 ** decimals, buySig, burnSig }, 'flywheel buyback and burn done');
    }
    return sigs;
  }

  /**
   * LP leg: half of the lamports CREATE index units in-kind at NAV (buying from the pool would move a shallow pool
   * against ourselves); the other half stays SOL; both go into Meteora as a permanent position.
   */
  private async lpLeg(lamports: bigint, navPerUnit: number, solUsd: number, dry: boolean): Promise<string[]> {
    const sigs: string[] = [];
    const buySol = lamports / 2n;
    const pairSol = lamports - buySol;
    const indexBought = await this.createUnitsFromSol(buySol, navPerUnit, solUsd, dry, { toAirdropPool: false, source: 'lp' });
    this.d.repo.insertFlywheelEvent({ kind: 'buy_index', sig: dry ? DRY_RUN_SIG : 'see create', amounts: { sol: Number(buySol) / 1e9, units: indexBought }, note: dry ? 'DRY_RUN LP leg creation at NAV' : 'LP leg: units created in-kind at NAV' });
    if (dry) {
      this.d.repo.insertFlywheelEvent({ kind: 'add_lp', sig: DRY_RUN_SIG, amounts: { sol: Number(pairSol) / 1e9, units: indexBought, pool: this.d.env.METEORA_POOL ?? null }, note: 'DRY_RUN add liquidity' });
      return [DRY_RUN_SIG];
    }
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
  private async createUnitsFromSol(lamports: bigint, navPerUnit: number, solUsd: number, dry: boolean, opts: { toAirdropPool?: boolean; source?: string } = {}): Promise<bigint> {
    const toPool = opts.toAirdropPool ?? true;
    const source = opts.source ?? 'flywheel';
    if (navPerUnit <= 0) throw new Error('nav per unit unknown');
    const usd = (Number(lamports) / 1e9) * solUsd;
    // 2% headroom for slippage + mint fee
    const units = uiToBigint((usd / navPerUnit) * 0.98, INDEX_DECIMALS);
    if (units <= 0n) return 0n;
    const nav = await this.d.nav.get();
    const fund = nav.fund;
    const netUnits = units - (units * BigInt(fund.mintFeeBps)) / 10_000n;
    if (dry) {
      this.d.repo.insertFlywheelEvent({ kind: 'create', sig: DRY_RUN_SIG, amounts: { units, netUnits, sol: Number(lamports) / 1e9, source }, note: `DRY_RUN ${source} leg creation` });
      if (toPool) this.d.airdrop.addToPool(netUnits);
      return netUnits;
    }
    if (fund.openAuctions > 0) throw new Error('auctions open; cannot begin_mint');
    const basket = creationBasket(nav.assets, units, nav.nav.supply);
    const sigs: string[] = [];
    const priceOf = (mint: string): number => nav.nav.holdings.find((h) => h.mint === mint)?.priceUsd ?? 0;
    const decimalsOf = (mint: string): number => nav.assets.find((a) => a.mint === mint)?.decimals ?? 6;
    const held = async (mint: string): Promise<bigint> => {
      const a = nav.assets.find((x) => x.mint === mint);
      if (!a || !this.d.balances) return 0n;
      return this.d.balances.getTokenBalance(this.d.devWallet, new PublicKey(mint), new PublicKey(a.tokenProgram)).catch(() => 0n);
    };
    const buyLeg = async (mint: string, needed: bigint, label: string): Promise<void> => {
      const pay = this.d.devWallet.toBase58();
      try {
        const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: mint, amount: needed, slippageBps: this.d.env.AP_SLIPPAGE_BPS, swapMode: 'ExactOut', maxAccounts: 40 });
        sigs.push(await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, pay), { label }));
        return;
      } catch (err) {
        log.warn({ mint, err: (err as Error).message }, 'ExactOut route unavailable; falling back to ExactIn with headroom');
      }
      // ExactIn fallback: size the SOL by price with 4% headroom (excess tokens simply stay in the dev wallet).
      const usd = (Number(needed) / 10 ** decimalsOf(mint)) * priceOf(mint);
      if (!(usd > 0) || !(solUsd > 0)) throw new Error(`no price for ${mint}; cannot size ExactIn fallback`);
      const lamports = uiToBigint((usd / solUsd) * 1.04, 9);
      const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: mint, amount: lamports, slippageBps: this.d.env.AP_SLIPPAGE_BPS, maxAccounts: 40 });
      sigs.push(await this.d.devTx.sendVersioned(await this.d.quotes.swapTx(q, pay), { label: `${label} (ExactIn)` }));
    };
    for (const leg of basket) {
      if (leg.amount === 0n) continue;
      const have = await held(leg.mint);
      if (have >= leg.amount) continue; // leftover from a previous round covers it
      await buyLeg(leg.mint, leg.amount - have, `flywheel buy ${leg.mint}`);
    }
    // Verify every leg before minting; top up any shortfall (ExactIn rounding) once.
    for (const leg of basket) {
      if (leg.amount === 0n) continue;
      const have = await held(leg.mint);
      if (have < leg.amount) {
        log.warn({ mint: leg.mint, have: have.toString(), need: leg.amount.toString() }, 'leg short after purchase; topping up');
        await buyLeg(leg.mint, ((leg.amount - have) * 110n) / 100n, `flywheel top-up ${leg.mint}`);
      }
    }
    const txs = await this.d.chain.buildMintTxs(units, this.d.devWallet);
    sigs.push(...(await this.d.devTx.sendMany(txs, { label: 'flywheel mint' })));
    if (toPool) this.d.airdrop.addToPool(netUnits);
    this.d.repo.insertFlywheelEvent({ kind: 'create', sig: sigs[sigs.length - 1] ?? DRY_RUN_SIG, amounts: { units, netUnits, sol: Number(lamports) / 1e9, legs: sigs, source }, note: `${source} leg: basket bought and units created in-kind` });
    this.d.events.emit('flywheel_event', { kind: 'create', units: netUnits.toString() });
    return netUnits;
  }
}
