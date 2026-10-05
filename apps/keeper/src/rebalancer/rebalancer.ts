/** Rebalance orchestration: decide trigger, plan, open Dutch auctions (or log in DRY_RUN). */
import { PublicKey } from '@solana/web3.js';
import { PAUSE_AUCTIONS, type ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import { withConfigOverrides } from '../config/overrides.js';
import type { Repo } from '../db/repo.js';
import { driftTriggered, isScheduledRebalanceDue } from '../methodology/schedule.js';
import type { NavComputed, NavService } from '../nav/service.js';
import type { CompositeMarketData } from '../sources/market-data.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { auctionPrices, boundAuctionPrices } from './auction-pricing.js';
import { capQueued, planRebalance, type PlanHolding, type PlannedTrade, type RebalancePlan } from './plan.js';

const log = childLogger('rebalancer');
export const LAST_REBALANCE_KEY = 'last_rebalance_ts';

export type RebalanceReason = 'scheduled' | 'drift' | 'queued' | 'reconstitution' | 'manual';

export interface RebalancerDeps {
  chain: ChainClient;
  tx: TxSender;
  nav: NavService;
  market: CompositeMarketData;
  repo: Repo;
  cfg: MethodologyConfig;
  env: Env;
  events: EventBus;
}

export interface RebalanceCheckResult {
  reason: RebalanceReason | null;
  plan: RebalancePlan | null;
  opened: string[];
  skipped?: string;
}

export class Rebalancer {
  constructor(private readonly d: RebalancerDeps) {}

  /** Config in force: env/defaults with governance overrides (kv `cfg.*`) applied. */
  get cfg(): MethodologyConfig {
    return withConfigOverrides(this.d.cfg, this.d.repo);
  }

  async buildHoldings(nav: NavComputed): Promise<PlanHolding[]> {
    const md = await this.d.market.getMarketData(nav.assets.map((a) => a.mint));
    return nav.nav.holdings.map((h) => ({
      mint: h.mint,
      decimals: h.decimals,
      balance: h.balance,
      priceUsd: h.priceUsd,
      valueUsd: h.valueUsd,
      targetWeightBps: h.targetWeightBps,
      volume24hUsd: md.get(h.mint)?.volume24hUsd ?? 0,
      status: h.status,
    }));
  }

  /** Called by the 10-minute job and by `keeper rebalance`. */
  async check(opts: { force?: boolean; dry?: boolean } = {}): Promise<RebalanceCheckResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    // Cheap: the drift check runs every REBALANCE_CHECK_SEC off the cached NAV snapshot (NAV_SNAPSHOT_SEC cadence).
    const nav = await this.d.nav.get(opts.force ? 0 : Math.max(this.d.env.NAV_SNAPSHOT_SEC, 30) * 1000);
    if (nav.fund.paused & PAUSE_AUCTIONS) return { reason: null, plan: null, opened: [], skipped: 'auctions paused' };
    if (nav.fund.openAuctions > 0) return { reason: null, plan: null, opened: [], skipped: `${nav.fund.openAuctions} auction(s) still open` };
    if (nav.nav.navUsd <= 0) return { reason: null, plan: null, opened: [], skipped: 'nav is zero' };

    const holdings = await this.buildHoldings(nav);
    const lastTs = this.d.repo.getKv(LAST_REBALANCE_KEY);
    const lastMs = lastTs ? Date.parse(lastTs) : null;

    // 1) queued remainder from a previous capped cycle
    const queuedRows = this.d.repo.queuedTrades();
    let reason: RebalanceReason | null = null;
    let plan: RebalancePlan;
    if (queuedRows.length > 0 && !opts.force) {
      reason = 'queued';
      const byMint = new Map(holdings.map((h) => [h.mint, h]));
      const queued = queuedRows.map((q) => {
        const h = byMint.get(q.sell_mint);
        const amt = BigInt(q.sell_amount);
        const usd = h ? (Number(amt) / 10 ** h.decimals) * h.priceUsd : 0;
        return { sellMint: q.sell_mint, buyMint: q.buy_mint, sellAmount: amt, sellUsd: usd };
      });
      plan = capQueued(queued, holdings, this.cfg);
      if (!dry) {
        for (const q of queuedRows) this.d.repo.setQueuedStatus(q.id, 'opened');
        for (const q of plan.queued) this.d.repo.enqueueTrade({ ...q, reason: 'queued' });
      }
    } else {
      const drifts = driftTriggered(
        nav.nav.holdings.map((h) => ({ mint: h.mint, weightBps: h.weightBps, targetWeightBps: h.targetWeightBps, driftBps: h.driftBps })),
        this.cfg,
      );
      if (opts.force) reason = 'manual';
      else if (isScheduledRebalanceDue(new Date(), lastMs, this.cfg)) reason = 'scheduled';
      else if (drifts.length > 0) reason = 'drift';
      if (!reason) return { reason: null, plan: null, opened: [], skipped: 'within drift band and not scheduled' };
      plan = planRebalance(holdings, nav.nav.navUsd, this.cfg);
      if (!dry) for (const q of plan.queued) this.d.repo.enqueueTrade({ ...q, reason });
    }

    log.info(
      { reason, trades: plan.trades.length, queued: plan.queued.length, turnoverUsd: plan.turnoverUsd.toFixed(2), dry },
      dry ? 'DRY_RUN rebalance plan' : 'rebalance plan',
    );
    for (const t of plan.trades) {
      log.info({ sell: t.sellMint, buy: t.buyMint, sellAmount: t.sellAmount.toString(), usd: t.sellUsd.toFixed(2), capped: t.capped }, 'planned trade');
    }

    const opened: string[] = [];
    if (!dry) {
      for (const t of plan.trades) {
        try {
          opened.push(await this.openAuction(t, nav, reason));
        } catch (err) {
          log.error({ err: (err as Error).message, trade: t.sellMint }, 'failed to open auction');
        }
      }
      if (reason === 'scheduled' || reason === 'manual') this.d.repo.setKv(LAST_REBALANCE_KEY, new Date().toISOString());
    }
    return { reason, plan, opened };
  }

  async openAuction(t: PlannedTrade, nav: NavComputed, reason: RebalanceReason): Promise<string> {
    const sell = nav.assets.find((a) => a.mint === t.sellMint);
    const buy = nav.assets.find((a) => a.mint === t.buyMint);
    if (!sell || !buy) throw new Error('asset not found');
    const sellPx = nav.prices.get(t.sellMint);
    const buyPx = nav.prices.get(t.buyMint);
    if (!sellPx || !buyPx) throw new Error('missing price');
    const a = this.cfg.rebalance.auction;
    const raw = auctionPrices({
      sellPriceUsd: sellPx,
      buyPriceUsd: buyPx,
      sellDecimals: sell.decimals,
      buyDecimals: buy.decimals,
      startPremiumBps: a.startPremiumBps,
      maxDiscountBps: a.maxDiscountBps,
    });
    // The program rejects end prices below (ref_sell/ref_buy) * (1 - fund.max_auction_discount_bps).
    const px = boundAuctionPrices(raw, sell.refPrice, buy.refPrice, nav.fund.maxAuctionDiscountBps, a.startPremiumBps);
    if (px.bounded) {
      log.warn({ sell: sell.mint, buy: buy.mint, keeperEnd: raw.endPrice.toString(), minEnd: px.minEndPrice.toString(), maxAuctionDiscountBps: nav.fund.maxAuctionDiscountBps }, 'auction end price lifted to the on-chain ref-price bound');
    }
    const start = await this.d.chain.startAuction(
      { sellMint: new PublicKey(sell.mint), buyMint: new PublicKey(buy.mint), sellAmount: t.sellAmount, startPrice: px.startPrice, endPrice: px.endPrice, durationSlots: a.durationSlots },
      this.d.tx.payer,
    );
    const sig = await this.d.tx.sendIxs(start.ixs, { label: `start_auction ${sell.mint}->${buy.mint}` });

    // Record locally; the monitor reconciles slots/remaining from chain on its next tick.
    const pda = sig === DRY_RUN_SIG ? `dry-${start.auctionPda}` : start.auctionPda;
    const onchain = sig === DRY_RUN_SIG ? undefined : (await this.d.chain.readAuctions('open')).find((x) => x.pda === start.auctionPda);
    this.d.repo.upsertAuction({
      pda,
      nonce: start.nonce.toString(),
      sell_mint: sell.mint,
      buy_mint: buy.mint,
      sell_total: t.sellAmount.toString(),
      sell_remaining: (onchain?.sellRemaining ?? t.sellAmount).toString(),
      start_price: px.startPrice.toString(),
      end_price: px.endPrice.toString(),
      start_slot: (onchain?.startSlot ?? 0n).toString(),
      end_slot: (onchain?.endSlot ?? 0n).toString(),
      status: 'open',
      mid_price: px.midRaw,
      reason,
      start_sig: sig,
    });
    this.d.repo.insertFlywheelEvent({
      kind: 'auction_start',
      sig,
      amounts: { sellMint: sell.mint, buyMint: buy.mint, sellAmount: t.sellAmount, sellUsd: t.sellUsd, startPrice: px.startPrice, endPrice: px.endPrice },
      note: `${reason} rebalance`,
    });
    this.d.events.emit('auction', { pda, status: 'open', sellMint: sell.mint, buyMint: buy.mint });
    log.info({ pda, sig, sell: sell.mint, buy: buy.mint, usd: t.sellUsd.toFixed(2) }, 'auction opened');
    return pda;
  }
}
