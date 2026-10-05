/**
 * Pure pricing helpers. Everything here mirrors programs/fi6900/src/math.rs
 * exactly (integer math, same rounding) so the SDK can predict on-chain results.
 */

import type { AuctionAccount } from "./accounts.js";

export const Q64 = 1n << 64n;
const U64_MAX = (1n << 64n) - 1n;

/**
 * Convert a decimal number/string ratio (buy per sell) to Q64.64.
 * Accepts numbers (double precision) or decimal strings like "0.000123".
 */
export function toQ64(value: number | string | bigint): bigint {
  if (typeof value === "bigint") return value * Q64;
  const str = typeof value === "number" ? value.toString() : value.trim();
  if (!/^\d*(\.\d*)?([eE][+-]?\d+)?$/.test(str) || str === "" || str === ".") {
    throw new Error(`toQ64: invalid decimal "${value}"`);
  }
  // expand scientific notation
  let mantissa = str;
  let exp = 0;
  const e = str.search(/[eE]/);
  if (e >= 0) {
    mantissa = str.slice(0, e);
    exp = parseInt(str.slice(e + 1), 10);
  }
  const [intPartRaw, fracPartRaw = ""] = mantissa.split(".");
  let digits = (intPartRaw || "0") + fracPartRaw;
  let scale = fracPartRaw.length - exp; // value = digits / 10^scale
  if (scale < 0) {
    digits = digits + "0".repeat(-scale);
    scale = 0;
  }
  const num = BigInt(digits);
  const den = 10n ** BigInt(scale);
  // floor(num * 2^64 / den)
  return (num * Q64) / den;
}

/** Q64.64 -> JS number (lossy, for display). */
export function fromQ64(q: bigint): number {
  const intPart = q >> 64n;
  const frac = q & U64_MAX;
  return Number(intPart) + Number(frac) / 2 ** 64;
}

/** Q64.64 -> decimal string with `precision` fractional digits (exact, truncated). */
export function q64ToDecimalString(q: bigint, precision = 18): string {
  const intPart = q >> 64n;
  const frac = q & U64_MAX;
  const scaled = (frac * 10n ** BigInt(precision)) / Q64;
  const fracStr = scaled.toString().padStart(precision, "0").replace(/0+$/, "");
  return fracStr.length ? `${intPart}.${fracStr}` : intPart.toString();
}

/**
 * Linear Dutch auction price at `elapsed` of `duration` slots.
 * Identical to math::linear_price in the program.
 */
export function linearPrice(start: bigint, end: bigint, elapsed: bigint, duration: bigint): bigint {
  if (duration <= 0n) throw new Error("duration must be > 0");
  if (start < end) throw new Error("start must be >= end");
  const el = elapsed < 0n ? 0n : elapsed > duration ? duration : elapsed;
  const diff = start - end;
  const q = diff / duration;
  const r = diff % duration;
  const decay = q * el + (r * el) / duration;
  return start - decay;
}

export interface AuctionPriceInput {
  startPrice: bigint;
  endPrice: bigint;
  startSlot: bigint;
  endSlot: bigint;
}

function toBig(v: bigint | number | { toString(): string }): bigint {
  return typeof v === "bigint" ? v : BigInt(v.toString());
}

/** Price (Q64.64) an open auction will clear at if filled in `slot`. */
export function auctionPriceAt(
  auction: AuctionPriceInput | AuctionAccount,
  slot: bigint | number,
): bigint {
  const start = toBig(auction.startPrice);
  const end = toBig(auction.endPrice);
  const startSlot = toBig(auction.startSlot);
  const endSlot = toBig(auction.endSlot);
  const s = toBig(slot);
  const duration = endSlot - startSlot;
  const elapsed = s > startSlot ? s - startSlot : 0n;
  return linearPrice(start, end, elapsed, duration);
}

/** buy_amount = ceil(sell_amount * price / 2^64). Identical to math::buy_amount_for. */
export function buyAmountFor(sellAmount: bigint | number, priceQ64: bigint): bigint {
  const sell = toBig(sellAmount);
  const hi = priceQ64 >> 64n;
  const lo = priceQ64 & U64_MAX;
  const intPart = sell * hi;
  const fracNum = sell * lo;
  const fracPart = fracNum >> 64n;
  const rem = fracNum & U64_MAX;
  const total = intPart + fracPart + (rem !== 0n ? 1n : 0n);
  if (total > U64_MAX) throw new Error("buyAmountFor: overflow");
  return total;
}

/** ceil(a*b/c) — the per-slot `required` deposit formula. */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("division by zero");
  const num = a * b;
  return num % c === 0n ? num / c : num / c + 1n;
}

/** floor(a*b/c) — the per-slot `entitled` withdrawal formula. */
export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error("division by zero");
  return (a * b) / c;
}

/** fee = units * bps / 10_000 (floor). */
export function feeAmount(units: bigint, bps: number): bigint {
  return (units * BigInt(bps)) / 10_000n;
}

/** Management fee units for a time delta: supply * bps * dt / (10_000 * 31_557_600). */
export function mgmtFeeUnits(supply: bigint, bps: number, dtSeconds: bigint): bigint {
  if (dtSeconds <= 0n || supply === 0n || bps === 0) return 0n;
  return (supply * BigInt(bps) * dtSeconds) / (10_000n * 31_557_600n);
}

/** Convert a (buy_decimals, sell_decimals, human price) triple into Q64.64 base-unit ratio. */
export function humanPriceToQ64(
  humanBuyPerSell: number | string,
  sellDecimals: number,
  buyDecimals: number,
): bigint {
  // base_buy / base_sell = human * 10^buy / 10^sell
  const q = toQ64(humanBuyPerSell);
  const shift = buyDecimals - sellDecimals;
  return shift >= 0 ? q * 10n ** BigInt(shift) : q / 10n ** BigInt(-shift);
}

// ---------------------------------------------------------------------------
// Reference prices / auction price bounds (mirrors governance.rs + math.rs)
// ---------------------------------------------------------------------------

import { REF_PRICE_NUMERAIRE_USD } from "./constants.js";

/**
 * USD price of one whole token -> on-chain ref price (Q64.64 nano-USD per raw base unit).
 * `usdToRefPriceQ64(1.25, 6)` == toQ64(1.25e9 / 1e6) == 1250 << 64.
 */
export function usdToRefPriceQ64(priceUsd: number, decimals: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error(`usdToRefPriceQ64: invalid price ${priceUsd}`);
  const perRaw = priceUsd / REF_PRICE_NUMERAIRE_USD / 10 ** decimals;
  return toQ64(perRaw.toPrecision(17));
}

/** Inverse of usdToRefPriceQ64 (lossy, display only). */
export function refPriceQ64ToUsd(refPrice: bigint, decimals: number): number {
  return fromQ64(refPrice) * REF_PRICE_NUMERAIRE_USD * 10 ** decimals;
}

/** fair auction price (buy raw per sell raw, Q64.64) = refSell / refBuy. Mirrors math::ratio_q64. */
export function fairPriceQ64(refSell: bigint, refBuy: bigint): bigint {
  if (refBuy <= 0n) throw new Error("fairPriceQ64: refBuy must be > 0");
  const q = (refSell << 64n) / refBuy;
  if (q > (1n << 128n) - 1n) throw new Error("fairPriceQ64: overflow");
  return q;
}

/** Lowest acceptable `end_price` = fair * (10_000 - maxDiscountBps) / 10_000. Mirrors math::min_end_price. */
export function minEndPriceQ64(fairQ64: bigint, maxDiscountBps: number): bigint {
  const keep = 10_000n - BigInt(Math.min(maxDiscountBps, 10_000));
  return (fairQ64 * keep) / 10_000n;
}

/** ceil(|new - old| * 10_000 / old). Mirrors math::move_bps. */
export function moveBps(oldPrice: bigint, newPrice: bigint): bigint {
  if (oldPrice <= 0n) throw new Error("moveBps: old must be > 0");
  const diff = newPrice >= oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
  const num = diff * 10_000n;
  return num % oldPrice === 0n ? num / oldPrice : num / oldPrice + 1n;
}

/** Largest |delta| the program accepts against `anchor` for `maxBps` (move_bps(anchor, anchor±d) <= maxBps). */
export function maxRefPriceDelta(anchor: bigint, maxBps: number): bigint {
  return (anchor * BigInt(maxBps)) / 10_000n;
}

export interface RefPriceClamp {
  /** value to send (== target when within the cap) */
  price: bigint;
  clamped: boolean;
  /** move of `target` vs anchor in bps (ceil) */
  targetMoveBps: bigint;
}

/**
 * Clamp a desired ref price into the window the program accepts from the rebalancer:
 * [anchor - maxDelta, anchor + maxDelta]. `anchor` is `Asset.ref_price_anchor` if the period
 * has not rolled, otherwise the current `Asset.ref_price` (the program re-anchors on roll).
 */
export function clampRefPrice(anchor: bigint, target: bigint, maxBps: number): RefPriceClamp {
  if (anchor <= 0n) return { price: target, clamped: false, targetMoveBps: 0n };
  const d = maxRefPriceDelta(anchor, maxBps);
  const lo = anchor - d;
  const hi = anchor + d;
  const move = moveBps(anchor, target);
  if (target < lo) return { price: lo, clamped: true, targetMoveBps: move };
  if (target > hi) return { price: hi, clamped: true, targetMoveBps: move };
  return { price: target, clamped: false, targetMoveBps: move };
}

/** The anchor the program will measure the next set_ref_price against at `slot`. */
export function effectiveRefAnchor(
  asset: { refPrice: bigint; refPriceAnchor: bigint; refPriceAnchorSlot: bigint },
  periodSlots: bigint,
  slot: bigint,
): bigint {
  if (asset.refPrice === 0n) return 0n;
  return slot >= asset.refPriceAnchorSlot + periodSlots ? asset.refPrice : asset.refPriceAnchor;
}

// ---------------------------------------------------------------------------
// Token-2022 fee-on-transfer (deposit / fill gross amounts)
// ---------------------------------------------------------------------------

/** Transfer fee withheld on a `gross` transfer: min(ceil(gross * bps / 10_000), maxFee). Mirrors spl-token-2022 `TransferFee::calculate_fee`. */
export function transferFeeFor(gross: bigint, feeBps: number, maxFee: bigint): bigint {
  if (feeBps <= 0 || gross <= 0n) return 0n;
  const num = gross * BigInt(feeBps);
  const fee = num % 10_000n === 0n ? num / 10_000n : num / 10_000n + 1n;
  return fee > maxFee ? maxFee : fee;
}

/**
 * Smallest gross `g` such that `g - transferFeeFor(g) >= net`: what a depositor / auction filler
 * has to send into a vault of a Token-2022 mint with a TransferFeeConfig so the program's
 * `received >= required` check passes. Equals `net` when the mint has no fee.
 */
export function grossForNet(net: bigint, feeBps: number, maxFee: bigint): bigint {
  if (net <= 0n || feeBps <= 0 || maxFee <= 0n) return net;
  if (feeBps >= 10_000 && maxFee >= net) {
    // 100% fee: only the max-fee cap can let anything through
    return net + maxFee;
  }
  // net(g) = g - fee(g) is non-decreasing in g; the answer lies in [net, net + maxFee].
  let lo = net;
  let hi = net + maxFee;
  while (lo < hi) {
    const mid = (lo + hi) >> 1n;
    if (mid - transferFeeFor(mid, feeBps, maxFee) >= net) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}
