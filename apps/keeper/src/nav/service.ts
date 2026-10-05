/** Reads chain + prices, computes NAV/level, persists a snapshot, emits SSE events. */
import type { ChainClient, AssetState, FundState } from '../chain/types.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import { initialDivisor } from '../methodology/index-level.js';
import type { CompositeMarketData } from '../sources/market-data.js';
import { midPriceFromQuotes } from '../sources/jupiter-quote.js';
import { WSOL_MINT, type QuoteSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { uiToBigint } from '../util/math.js';
import { computeNav, INDEX_DECIMALS, premiumBps, type NavResult } from './compute.js';
import { nextLevelState, reconcileDivisor, type LevelState } from './level.js';

const log = childLogger('nav');
const LEVEL_KEY = 'index_level_state';

export interface NavComputed {
  ts: string;
  fund: FundState;
  assets: AssetState[];
  nav: NavResult;
  prices: Map<string, number>;
  divisor: number;
  indexLevel: number;
  marketPriceUsd: number | null;
  premiumBps: number | null;
  solPriceUsd: number;
}

export interface NavServiceDeps {
  chain: ChainClient;
  market: CompositeMarketData;
  quotes: QuoteSource;
  repo: Repo;
  cfg: MethodologyConfig;
  env: Env;
  events: EventBus;
}

export class NavService {
  latest: NavComputed | undefined;

  constructor(private readonly d: NavServiceDeps) {}

  /** Returns a fresh computation if the last one is older than maxAgeMs. */
  async get(maxAgeMs = 30_000): Promise<NavComputed> {
    if (this.latest && Date.now() - Date.parse(this.latest.ts) < maxAgeMs) return this.latest;
    return this.snapshot(false);
  }

  async snapshot(persist = true): Promise<NavComputed> {
    const { chain, market, repo } = this.d;
    const [fund, assets, supply] = await Promise.all([chain.readFund(), chain.readAssets(), chain.getIndexSupply()]);
    const mints = assets.map((a) => a.mint);
    const [prices, solPriceUsd] = await Promise.all([market.getPrices(mints), market.getSolPrice()]);
    const nav = computeNav(assets, prices, supply);
    if (nav.unpriced.length) log.warn({ unpriced: nav.unpriced }, 'assets without price excluded from NAV');

    // ---- index level (divisor method) ----
    const current = nav.holdings.filter((h) => h.priceUsd > 0).map((h) => ({ mint: h.mint, balanceUi: h.balanceUi, priceUsd: h.priceUsd }));
    const mv = current.reduce((s, h) => s + h.balanceUi * h.priceUsd, 0);
    let state = repo.getKvJson<LevelState | null>(LEVEL_KEY, null);
    if (!state) {
      if (mv <= 0) {
        log.warn('market value is zero; index level not initialised yet');
      } else {
        state = { divisor: initialDivisor(mv, this.d.cfg.baseLevel), baseLevel: this.d.cfg.baseLevel, inceptionTs: new Date().toISOString(), lastBalances: [] };
        state.lastBalances = current.map((c) => ({ mint: c.mint, balanceUi: c.balanceUi }));
        repo.setKvJson(LEVEL_KEY, state);
        log.info({ divisor: state.divisor, mv }, 'index level initialised at base');
      }
    }
    let divisor = state?.divisor ?? 0;
    let indexLevel = 0;
    if (state) {
      const rec = reconcileDivisor(state, current);
      if (rec.rebased) log.info({ from: state.divisor, to: rec.divisor }, 'divisor re-set (balance change)');
      divisor = rec.divisor;
      indexLevel = rec.level;
      if (persist) repo.setKvJson(LEVEL_KEY, nextLevelState(state, current, divisor));
    }

    // ---- market price of the index unit ----
    const marketPriceUsd = await this.readMarketPrice(solPriceUsd).catch((e: Error) => {
      log.debug({ err: e.message }, 'market price unavailable');
      return null;
    });
    const prem = marketPriceUsd !== null && nav.navPerUnitUsd > 0 ? premiumBps(marketPriceUsd, nav.navPerUnitUsd) : null;

    const computed: NavComputed = {
      ts: new Date().toISOString(),
      fund,
      assets,
      nav,
      prices,
      divisor,
      indexLevel,
      marketPriceUsd,
      premiumBps: prem,
      solPriceUsd,
    };
    this.latest = computed;

    if (persist) {
      repo.insertNavSnapshot({
        ts: computed.ts,
        navUsd: nav.navUsd,
        navPerUnitUsd: nav.navPerUnitUsd,
        indexLevel,
        divisor,
        marketPriceUsd,
        premiumBps: prem,
        supply,
        epoch: fund.epoch,
        solPriceUsd,
        holdings: nav.holdings.map((h) => ({
          slot: h.slot,
          mint: h.mint,
          balance: h.balance,
          priceUsd: h.priceUsd,
          valueUsd: h.valueUsd,
          weightBps: h.weightBps,
          targetWeightBps: h.targetWeightBps,
        })),
      });
      this.d.events.emit('fund', {
        navUsd: nav.navUsd,
        navPerUnitUsd: nav.navPerUnitUsd,
        indexLevel,
        marketPriceUsd,
        premiumBps: prem,
        supply: supply.toString(),
        epoch: fund.epoch.toString(),
        openAuctions: fund.openAuctions,
      });
      this.d.events.emit(
        'holdings',
        nav.holdings.map((h) => ({ mint: h.mint, priceUsd: h.priceUsd, valueUsd: h.valueUsd, weightBps: h.weightBps, driftBps: h.driftBps })),
      );
    }
    log.debug({ navUsd: nav.navUsd, navPerUnit: nav.navPerUnitUsd, level: indexLevel, premiumBps: prem }, 'nav computed');
    return computed;
  }

  /** Index unit USD price from Jupiter: price API first, then two-sided quote mid. */
  async readMarketPrice(solPriceUsd: number): Promise<number | null> {
    const indexMint = this.d.chain.indexMint.toBase58();
    const p = (await this.d.market.getPrices([indexMint])).get(indexMint);
    if (p) return p;
    // Spot-ish probe: a tiny two-sided quote (0.01 SOL) so the displayed market price is the pool price, not the
    // price impact of a trade the size of the AP notional on a shallow pool.
    const PROBE_SOL = 0.01;
    const notionalSol = uiToBigint(PROBE_SOL, 9);
    const navPerUnit = this.latest?.nav.navPerUnitUsd ?? 0;
    if (navPerUnit <= 0) return null;
    const unitsForNotional = uiToBigint((PROBE_SOL * solPriceUsd) / navPerUnit, INDEX_DECIMALS);
    const [buy, sell] = await Promise.all([
      this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: indexMint, amount: notionalSol, slippageBps: 50 }),
      this.d.quotes.quote({ inputMint: indexMint, outputMint: WSOL_MINT, amount: unitsForNotional, slippageBps: 50 }),
    ]);
    const { mid } = midPriceFromQuotes(buy, sell, 9, INDEX_DECIMALS);
    return mid * solPriceUsd;
  }
}
