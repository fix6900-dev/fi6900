/** Authorized-participant loop: close NAV <-> market gaps with Jupiter + in-kind create/redeem. */
import type { ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
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

  /** buy basket via Jupiter (one tx per leg) -> buildMintTxs -> sell units on Jupiter */
  private async executeCreate(units: bigint, assets: Parameters<typeof creationBasket>[0], supply: bigint): Promise<string[]> {
    const payer = this.d.tx.payer.toBase58();
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
    const buyQ = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: this.d.chain.indexMint.toBase58(), amount: units, slippageBps: this.d.env.AP_SLIPPAGE_BPS, swapMode: 'ExactOut' });
    sigs.push(await this.d.tx.sendVersioned(await this.d.quotes.swapTx(buyQ, payer), { label: 'ap buy units' }));
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
