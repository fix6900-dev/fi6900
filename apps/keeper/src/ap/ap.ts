/** Authorized-participant loop: close NAV <-> market gaps with Jupiter + in-kind create/redeem. */
import type { ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import type { BalanceSource } from '../chain/accounts.js';
import { creationBasket, INDEX_DECIMALS, redemptionBasket } from '../nav/compute.js';
import type { NavService } from '../nav/service.js';
import type { CompositeMarketData } from '../sources/market-data.js';
import { WSOL_MINT, type QuoteSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { uiToBigint } from '../util/math.js';
import { decideArb, type ArbDecision } from './arb.js';

const log = childLogger('ap');

export interface ApDeps {
  chain: ChainClient;
  tx: TxSender;
  nav: NavService;
  quotes: QuoteSource;
  market: CompositeMarketData;
  repo: Repo;
  env: Env;
  events: EventBus;
  /** Optional: lets the premium leg sell units the keeper already holds instead of buying basket first. */
  balances?: BalanceSource;
}

export interface ApCycleResult {
  decision: ArbDecision;
  executed: boolean;
  sigs: string[];
  realizedProfitSol?: number;
}

export class ApArbitrageur {
  private notionalUsedThisCycleSol = 0;

  constructor(private readonly d: ApDeps) {}

  resetCycleBudget(): void {
    this.notionalUsedThisCycleSol = 0;
  }

  async check(opts: { dry?: boolean } = {}): Promise<ApCycleResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const env = this.d.env;
    const skip = (reason: string): ApCycleResult => ({ decision: { action: 'none', premiumBps: 0, discountBps: 0, expectedProfitUsd: 0, units: 0, reason }, executed: false, sigs: [] });
    if (env.KILL_SWITCH) return skip('kill switch engaged');
    if (!env.AP_ENABLED) return skip('AP disabled');

    const nav = await this.d.nav.get();
    if (nav.fund.openAuctions > 0) return skip('auctions open; begin_mint would fail');
    if (nav.nav.navPerUnitUsd <= 0) return skip('nav unavailable');
    if (this.notionalUsedThisCycleSol + env.AP_NOTIONAL_SOL > env.AP_MAX_NOTIONAL_SOL_PER_CYCLE) return skip('cycle notional budget exhausted');

    const indexMint = this.d.chain.indexMint.toBase58();
    const sol = nav.solPriceUsd;
    const notionalUsd = env.AP_NOTIONAL_SOL * sol;
    const units = uiToBigint(notionalUsd / nav.nav.navPerUnitUsd, INDEX_DECIMALS);

    const [buyQ, sellQ] = await Promise.all([
      this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: indexMint, amount: uiToBigint(env.AP_NOTIONAL_SOL, 9), slippageBps: env.AP_SLIPPAGE_BPS }).catch(() => null),
      this.d.quotes.quote({ inputMint: indexMint, outputMint: WSOL_MINT, amount: units, slippageBps: env.AP_SLIPPAGE_BPS }).catch(() => null),
    ]);
    const buyPriceUsd = buyQ ? (Number(buyQ.inAmount) / 1e9) * sol / (Number(buyQ.outAmount) / 10 ** INDEX_DECIMALS) : null;
    const sellPriceUsd = sellQ ? (Number(sellQ.outAmount) / 1e9) * sol / (Number(sellQ.inAmount) / 10 ** INDEX_DECIMALS) : null;

    const decision = decideArb({
      navPerUnitUsd: nav.nav.navPerUnitUsd,
      buyPriceUsd,
      sellPriceUsd,
      thresholdBps: env.AP_THRESHOLD_BPS,
      mintFeeBps: nav.fund.mintFeeBps,
      redeemFeeBps: nav.fund.redeemFeeBps,
      basketSlippageBps: Math.min(300, nav.assets.length * 5 + env.AP_SLIPPAGE_BPS / 2),
      fixedCostUsd: 0.02 * sol * (nav.assets.length / 10 + 1),
      notionalUsd,
    });
    log.info({ action: decision.action, premiumBps: decision.premiumBps, discountBps: decision.discountBps, profitUsd: decision.expectedProfitUsd.toFixed(2), reason: decision.reason }, 'ap check');

    // Inventory leg for discounts: on a shallow pool the 14-leg redeem never pays its fixed costs, but buying units
    // below NAV and holding them is profitable on its own (the premium leg later sells that inventory). Enabled when
    // the keeper has SOL to spare; the buy quote already includes the pool's price impact.
    if (decision.action === 'none' && buyPriceUsd !== null && decision.discountBps > env.AP_THRESHOLD_BPS && this.d.balances && env.AP_INVENTORY_BUY) {
      const solBal = Number(await this.d.balances.getSolBalance(this.d.tx.payer).catch(() => 0n)) / 1e9;
      if (solBal - env.AP_NOTIONAL_SOL >= env.AP_MIN_SOL_RESERVE) {
        const effDiscountBps = Math.round((1 - buyPriceUsd / nav.nav.navPerUnitUsd) * 10_000);
        if (effDiscountBps > env.AP_THRESHOLD_BPS) {
          if (dry) {
            this.d.repo.insertFlywheelEvent({ kind: 'redeem', sig: DRY_RUN_SIG, amounts: { notionalSol: env.AP_NOTIONAL_SOL, effDiscountBps, inventory: true }, note: 'DRY_RUN inventory buy below NAV' });
            return { decision: { ...decision, action: 'redeem', reason: `inventory buy at ${effDiscountBps} bps below NAV (dry)` }, executed: false, sigs: [DRY_RUN_SIG] };
          }
          this.notionalUsedThisCycleSol += env.AP_NOTIONAL_SOL;
          const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: indexMint, amount: uiToBigint(env.AP_NOTIONAL_SOL, 9), slippageBps: env.AP_SLIPPAGE_BPS });
          const sig = await this.d.tx.sendVersioned(await this.d.quotes.swapTx(q, this.d.tx.payer.toBase58()), { label: 'ap buy inventory units' });
          const unitsUi = Number(q.outAmount) / 10 ** INDEX_DECIMALS;
          const profitUsd = unitsUi * nav.nav.navPerUnitUsd - env.AP_NOTIONAL_SOL * sol;
          this.d.repo.insertFlywheelEvent({ kind: 'redeem', sig, amounts: { units: q.outAmount, solSpent: q.inAmount, effDiscountBps, profitUsd, inventory: true }, note: 'AP bought units below NAV and holds them as inventory' });
          this.d.events.emit('flywheel_event', { kind: 'redeem', profitUsd });
          log.info({ units: q.outAmount.toString(), solSpent: q.inAmount.toString(), effDiscountBps, profitUsd }, 'discount arb executed: inventory buy');
          return { decision: { ...decision, action: 'redeem', reason: `inventory buy at ${effDiscountBps} bps below NAV` }, executed: true, sigs: [sig] };
        }
      }
    }
    if (decision.action === 'none') return { decision, executed: false, sigs: [] };

    if (dry) {
      this.d.repo.insertFlywheelEvent({
        kind: decision.action,
        sig: DRY_RUN_SIG,
        amounts: { units, notionalSol: env.AP_NOTIONAL_SOL, expectedProfitUsd: decision.expectedProfitUsd, premiumBps: decision.premiumBps, discountBps: decision.discountBps },
        note: `DRY_RUN ${decision.reason}`,
      });
      return { decision, executed: false, sigs: [DRY_RUN_SIG] };
    }

    this.notionalUsedThisCycleSol += env.AP_NOTIONAL_SOL;
    const sigs = decision.action === 'create' ? await this.executeCreate(units, nav.assets, nav.nav.supply) : await this.executeRedeem(units, nav.assets, nav.nav.supply, nav.fund.redeemFeeBps);
    return { decision, executed: true, sigs };
  }

  /**
   * Premium leg. Inventory-first: if the keeper already holds enough units (e.g. the bootstrap seed), sell those
   * directly — same effect on the peg, no basket purchase, and it replenishes operating SOL. Otherwise:
   * buy basket via Jupiter (one tx per leg) -> buildMintTxs -> sell units on Jupiter.
   */
  private async executeCreate(units: bigint, assets: Parameters<typeof creationBasket>[0], supply: bigint): Promise<string[]> {
    const payer = this.d.tx.payer.toBase58();
    const indexMint = this.d.chain.indexMint.toBase58();
    const held = this.d.balances ? await this.d.balances.getTokenBalance(this.d.tx.payer, this.d.chain.indexMint).catch(() => 0n) : 0n;
    if (held >= units) {
      const sellQ = await this.d.quotes.quote({ inputMint: indexMint, outputMint: WSOL_MINT, amount: units, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
      const sellTx = await this.d.quotes.swapTx(sellQ, payer);
      const sig = await this.d.tx.sendVersioned(sellTx, { label: 'ap sell inventory units' });
      const nav = await this.d.nav.get();
      const navSol = nav.solPriceUsd > 0 ? ((Number(units) / 10 ** INDEX_DECIMALS) * nav.nav.navPerUnitUsd) / nav.solPriceUsd : 0;
      const profitSol = Number(sellQ.outAmount) / 1e9 - navSol;
      this.d.repo.insertFlywheelEvent({ kind: 'create', sig, amounts: { units, solReceived: sellQ.outAmount, navSol, profitSol, inventory: true }, note: 'AP sold inventory units at a premium to NAV' });
      this.d.events.emit('flywheel_event', { kind: 'create', profitSol });
      log.info({ units: units.toString(), solReceived: sellQ.outAmount.toString(), profitSol }, 'premium arb executed from inventory');
      return [sig];
    }
    const basket = creationBasket(assets, units, supply);
    const sigs: string[] = [];
    let solSpent = 0n;
    for (const leg of basket) {
      if (leg.amount === 0n) continue;
      const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: leg.mint, amount: leg.amount, slippageBps: this.d.env.AP_SLIPPAGE_BPS, swapMode: 'ExactOut' });
      solSpent += q.inAmount;
      const tx = await this.d.quotes.swapTx(q, payer);
      sigs.push(await this.d.tx.sendVersioned(tx, { label: `ap buy ${leg.mint}` }));
    }
    const mintTxs = await this.d.chain.buildMintTxs(units, this.d.tx.payer);
    sigs.push(...(await this.d.tx.sendMany(mintTxs, { label: 'ap mint' })));
    const fund = await this.d.chain.readFund();
    const netUnits = units - (units * BigInt(fund.mintFeeBps)) / 10_000n;
    const sellQ = await this.d.quotes.quote({ inputMint: this.d.chain.indexMint.toBase58(), outputMint: WSOL_MINT, amount: netUnits, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
    const sellTx = await this.d.quotes.swapTx(sellQ, payer);
    sigs.push(await this.d.tx.sendVersioned(sellTx, { label: 'ap sell units' }));
    const profitSol = Number(sellQ.outAmount - solSpent) / 1e9;
    this.d.repo.insertFlywheelEvent({ kind: 'create', sig: sigs[sigs.length - 1] ?? DRY_RUN_SIG, amounts: { units, netUnits, solSpent, solReceived: sellQ.outAmount, profitSol, legs: sigs }, note: 'AP creation arbitrage' });
    this.d.events.emit('flywheel_event', { kind: 'create', profitSol });
    log.info({ profitSol, legs: sigs.length }, 'creation arb executed');
    return sigs;
  }

  /** buy units on Jupiter -> buildRedeemTxs -> sell basket */
  private async executeRedeem(units: bigint, assets: Parameters<typeof redemptionBasket>[0], supply: bigint, redeemFeeBps: number): Promise<string[]> {
    const payer = this.d.tx.payer.toBase58();
    const sigs: string[] = [];
    // ExactIn: Jupiter has no ExactOut route for the Meteora DAMM v2 index pool. Spend the cycle notional and redeem
    // exactly the units it bought.
    const buyQ = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: this.d.chain.indexMint.toBase58(), amount: uiToBigint(this.d.env.AP_NOTIONAL_SOL, 9), slippageBps: this.d.env.AP_SLIPPAGE_BPS, maxAccounts: 40 });
    sigs.push(await this.d.tx.sendVersioned(await this.d.quotes.swapTx(buyQ, payer), { label: 'ap buy units' }));
    units = buyQ.outAmount;
    const redeemTxs = await this.d.chain.buildRedeemTxs(units, this.d.tx.payer);
    sigs.push(...(await this.d.tx.sendMany(redeemTxs, { label: 'ap redeem' })));
    let solReceived = 0n;
    for (const leg of redemptionBasket(assets, units, supply, redeemFeeBps)) {
      if (leg.amount === 0n) continue;
      const q = await this.d.quotes.quote({ inputMint: leg.mint, outputMint: WSOL_MINT, amount: leg.amount, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
      solReceived += q.outAmount;
      sigs.push(await this.d.tx.sendVersioned(await this.d.quotes.swapTx(q, payer), { label: `ap sell ${leg.mint}` }));
    }
    const profitSol = Number(solReceived - buyQ.inAmount) / 1e9;
    this.d.repo.insertFlywheelEvent({ kind: 'redeem', sig: sigs[sigs.length - 1] ?? DRY_RUN_SIG, amounts: { units, solSpent: buyQ.inAmount, solReceived, profitSol, legs: sigs }, note: 'AP redemption arbitrage' });
    this.d.events.emit('flywheel_event', { kind: 'redeem', profitSol });
    log.info({ profitSol, legs: sigs.length }, 'redemption arb executed');
    return sigs;
  }
}
