/** Dutch auction price curve helpers (pure). Prices are buy_token raw per sell_token raw. */
import { fromQ64, mulDivCeil, Q64, toQ64 } from '../util/math.js';

export interface AuctionPriceInput {
  sellPriceUsd: number;
  buyPriceUsd: number;
  sellDecimals: number;
  buyDecimals: number;
  startPremiumBps: number;
  maxDiscountBps: number;
}

export interface AuctionPrices {
  /** buy raw per sell raw at Jupiter mid */
  midRaw: number;
  startPrice: bigint;
  endPrice: bigint;
}

/** Jupiter mid expressed in raw units: (sellUsd / buyUsd) * 10^(buyDec - sellDec). */
export function midRawPrice(sellPriceUsd: number, buyPriceUsd: number, sellDecimals: number, buyDecimals: number): number {
  if (!(sellPriceUsd > 0) || !(buyPriceUsd > 0)) throw new Error('prices must be positive');
  return (sellPriceUsd / buyPriceUsd) * 10 ** (buyDecimals - sellDecimals);
}

export function auctionPrices(i: AuctionPriceInput): AuctionPrices {
  const midRaw = midRawPrice(i.sellPriceUsd, i.buyPriceUsd, i.sellDecimals, i.buyDecimals);
  const start = midRaw * (1 + i.startPremiumBps / 10_000);
  const end = midRaw * (1 - i.maxDiscountBps / 10_000);
  const startPrice = toQ64(start);
  const endPrice = toQ64(end);
  if (endPrice >= startPrice) throw new Error('end price must be below start price');
  if (endPrice === 0n) throw new Error('end price underflows Q64.64; token price ratio too small');
  return { midRaw, startPrice, endPrice };
}

/** Linear decay, mirrors on-chain `fill_auction`. */
export function priceAtSlot(startPrice: bigint, endPrice: bigint, startSlot: bigint, endSlot: bigint, slot: bigint): bigint {
  if (slot <= startSlot) return startPrice;
  if (slot >= endSlot) return endPrice;
  const duration = endSlot - startSlot;
  return startPrice - ((startPrice - endPrice) * (slot - startSlot)) / duration;
}

/** buy_amount = ceil(sell_amount * price) with price in Q64.64 */
export function buyAmountFor(sellAmount: bigint, priceQ64: bigint): bigint {
  return mulDivCeil(sellAmount, priceQ64, Q64);
}

/** Keeper fallback-fill rule: fill once current price <= mid * (1 - discountBps/1e4). */
export function shouldSelfFill(currentPriceQ64: bigint, midRaw: number, discountBps: number): boolean {
  return fromQ64(currentPriceQ64) <= midRaw * (1 - discountBps / 10_000);
}

/** Slot at which the curve crosses the self-fill threshold (for logging/ETA). */
export function selfFillSlot(startPrice: bigint, endPrice: bigint, startSlot: bigint, endSlot: bigint, midRaw: number, discountBps: number): bigint {
  const target = toQ64(midRaw * (1 - discountBps / 10_000));
  if (target >= startPrice) return startSlot;
  if (target <= endPrice) return endSlot;
  const duration = endSlot - startSlot;
  return startSlot + ((startPrice - target) * duration) / (startPrice - endPrice);
}

// ---------------------------------------------------------------------------
// On-chain price bound (ARCHITECTURE section 2: start_auction enforces
// end_price >= (ref_sell / ref_buy) * (1 - max_auction_discount_bps)).
// ---------------------------------------------------------------------------

/** fair buy-raw per sell-raw (Q64.64) from two ref prices (nano-USD per raw unit, Q64.64). */
export function fairPriceQ64(refSell: bigint, refBuy: bigint): bigint {
  if (refBuy <= 0n) throw new Error('refBuy must be > 0');
  return (refSell << 64n) / refBuy;
}

export function minEndPriceQ64(fairQ64: bigint, maxDiscountBps: number): bigint {
  return (fairQ64 * (10_000n - BigInt(Math.min(maxDiscountBps, 10_000)))) / 10_000n;
}

export interface BoundedPrices extends AuctionPrices {
  /** the program's floor for end_price */
  minEndPrice: bigint;
  /** true when the keeper's curve had to be lifted to satisfy the bound */
  bounded: boolean;
}

/**
 * Lift the keeper's Dutch curve so the program accepts it: end_price >= minEnd, start >= end.
 * Throws when either ref price is unset (the program would reject with RefPriceUnset).
 */
export function boundAuctionPrices(px: AuctionPrices, refSell: bigint, refBuy: bigint, maxDiscountBps: number, startPremiumBps: number): BoundedPrices {
  if (refSell <= 0n || refBuy <= 0n) throw new Error('ref price unset; set_ref_price before auctioning');
  const minEndPrice = minEndPriceQ64(fairPriceQ64(refSell, refBuy), maxDiscountBps);
  if (px.endPrice >= minEndPrice) return { ...px, minEndPrice, bounded: false };
  const endPrice = minEndPrice;
  // keep the original start unless it is now below the floor; then re-apply the premium above it
  const startPrice = px.startPrice > endPrice ? px.startPrice : (endPrice * BigInt(10_000 + startPremiumBps)) / 10_000n;
  return { midRaw: px.midRaw, startPrice, endPrice, minEndPrice, bounded: true };
}
