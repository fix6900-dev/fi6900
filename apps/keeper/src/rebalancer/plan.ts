/** Pure rebalance planning: effective vs target weights -> paired sell/buy trades with volume caps. */
import type { MethodologyConfig } from '../config/methodology.config.js';
import { uiToBigint } from '../util/math.js';

export interface PlanHolding {
  mint: string;
  symbol?: string;
  decimals: number;
  /** effective balance, raw */
  balance: bigint;
  priceUsd: number;
  valueUsd: number;
  targetWeightBps: number;
  volume24hUsd: number;
  status: 'active' | 'removing';
}

export interface PlannedTrade {
  sellMint: string;
  buyMint: string;
  /** raw sell units to auction now */
  sellAmount: bigint;
  sellUsd: number;
  /** estimated raw buy units at mid */
  buyAmountEst: bigint;
  /** USD deferred because of the volume cap */
  queuedUsd: number;
  capped: boolean;
}

export interface QueuedTrade {
  sellMint: string;
  buyMint: string;
  sellAmount: bigint;
  sellUsd: number;
}

export interface RebalancePlan {
  trades: PlannedTrade[];
  queued: QueuedTrade[];
  turnoverUsd: number;
  deltas: { mint: string; deltaUsd: number }[];
}

export function usdToRaw(usd: number, priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0)) return 0n;
  return uiToBigint(usd / priceUsd, decimals);
}

/**
 * Greedy pairing: largest overweight sells into largest underweight, two-pointer style,
 * then per-sell-asset volume cap with the remainder queued.
 */
export function planRebalance(holdings: readonly PlanHolding[], navUsd: number, cfg: MethodologyConfig): RebalancePlan {
  const minTradeUsd = cfg.rebalance.auction.minTradeUsd;
  const byMint = new Map(holdings.map((h) => [h.mint, h]));

  const deltas = holdings.map((h) => {
    const target = h.status === 'removing' ? 0 : (h.targetWeightBps / 10_000) * navUsd;
    return { mint: h.mint, deltaUsd: h.valueUsd - target };
  });

  const overs = deltas.filter((d) => d.deltaUsd > 0).sort((a, b) => b.deltaUsd - a.deltaUsd).map((d) => ({ ...d }));
  const unders = deltas.filter((d) => d.deltaUsd < 0).sort((a, b) => a.deltaUsd - b.deltaUsd).map((d) => ({ mint: d.mint, needUsd: -d.deltaUsd }));

  const rawPairs: { sellMint: string; buyMint: string; usd: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < overs.length && j < unders.length) {
    const o = overs[i];
    const u = unders[j];
    if (!o || !u) break;
    const amt = Math.min(o.deltaUsd, u.needUsd);
    if (amt > 0) rawPairs.push({ sellMint: o.mint, buyMint: u.mint, usd: amt });
    o.deltaUsd -= amt;
    u.needUsd -= amt;
    if (o.deltaUsd <= 1e-9) i++;
    if (u.needUsd <= 1e-9) j++;
  }

  // Volume cap per sell asset.
  const capUsdFor = (mint: string): number => {
    const h = byMint.get(mint);
    if (!h) return 0;
    const cap = (h.volume24hUsd * cfg.rebalance.maxTradePctOfDailyVolume) / 100;
    return h.volume24hUsd > 0 ? cap : Number.POSITIVE_INFINITY; // unknown volume -> no cap (logged by caller)
  };
  const totalSellBy = new Map<string, number>();
  for (const p of rawPairs) totalSellBy.set(p.sellMint, (totalSellBy.get(p.sellMint) ?? 0) + p.usd);

  const trades: PlannedTrade[] = [];
  const queued: QueuedTrade[] = [];
  let turnover = 0;
  for (const p of rawPairs) {
    const sell = byMint.get(p.sellMint);
    const buy = byMint.get(p.buyMint);
    if (!sell || !buy) continue;
    const total = totalSellBy.get(p.sellMint) ?? p.usd;
    const cap = capUsdFor(p.sellMint);
    const scale = total > cap ? cap / total : 1;
    const nowUsd = p.usd * scale;
    const laterUsd = p.usd - nowUsd;

    if (laterUsd >= minTradeUsd) {
      queued.push({ sellMint: p.sellMint, buyMint: p.buyMint, sellAmount: usdToRaw(laterUsd, sell.priceUsd, sell.decimals), sellUsd: laterUsd });
    }
    if (nowUsd < minTradeUsd) continue;
    let sellAmount = usdToRaw(nowUsd, sell.priceUsd, sell.decimals);
    if (sellAmount > sell.balance) sellAmount = sell.balance;
    if (sellAmount <= 0n) continue;
    trades.push({
      sellMint: p.sellMint,
      buyMint: p.buyMint,
      sellAmount,
      sellUsd: nowUsd,
      buyAmountEst: usdToRaw(nowUsd, buy.priceUsd, buy.decimals),
      queuedUsd: laterUsd,
      capped: scale < 1,
    });
    turnover += nowUsd;
  }
  return { trades, queued, turnoverUsd: turnover, deltas };
}

/** Re-applies the volume cap to previously queued trades (next cycle). */
export function capQueued(queued: readonly QueuedTrade[], holdings: readonly PlanHolding[], cfg: MethodologyConfig): RebalancePlan {
  const byMint = new Map(holdings.map((h) => [h.mint, h]));
  const totals = new Map<string, number>();
  for (const q of queued) totals.set(q.sellMint, (totals.get(q.sellMint) ?? 0) + q.sellUsd);
  const trades: PlannedTrade[] = [];
  const stillQueued: QueuedTrade[] = [];
  let turnover = 0;
  for (const q of queued) {
    const sell = byMint.get(q.sellMint);
    const buy = byMint.get(q.buyMint);
    if (!sell || !buy) continue;
    const cap = sell.volume24hUsd > 0 ? (sell.volume24hUsd * cfg.rebalance.maxTradePctOfDailyVolume) / 100 : Number.POSITIVE_INFINITY;
    const total = totals.get(q.sellMint) ?? q.sellUsd;
    const scale = total > cap ? cap / total : 1;
    const nowUsd = q.sellUsd * scale;
    const laterUsd = q.sellUsd - nowUsd;
    if (laterUsd >= cfg.rebalance.auction.minTradeUsd) {
      stillQueued.push({ ...q, sellUsd: laterUsd, sellAmount: usdToRaw(laterUsd, sell.priceUsd, sell.decimals) });
    }
    if (nowUsd < cfg.rebalance.auction.minTradeUsd) continue;
    let sellAmount = usdToRaw(nowUsd, sell.priceUsd, sell.decimals);
    if (sellAmount > sell.balance) sellAmount = sell.balance;
    if (sellAmount <= 0n) continue;
    trades.push({ sellMint: q.sellMint, buyMint: q.buyMint, sellAmount, sellUsd: nowUsd, buyAmountEst: usdToRaw(nowUsd, buy.priceUsd, buy.decimals), queuedUsd: laterUsd, capped: scale < 1 });
    turnover += nowUsd;
  }
  return { trades, queued: stillQueued, turnoverUsd: turnover, deltas: [] };
}
