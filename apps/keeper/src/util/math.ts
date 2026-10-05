/** Fixed-point & bigint helpers shared across the keeper. */

export const Q64 = 1n << 64n;
export const BPS = 10_000;

/** number -> Q64.64 bigint (price expressed in raw token units). */
export function toQ64(price: number): bigint {
  if (!Number.isFinite(price) || price < 0) throw new Error(`bad price ${price}`);
  const intPart = Math.floor(price);
  const frac = price - intPart;
  return BigInt(intPart) * Q64 + BigInt(Math.round(frac * 2 ** 64));
}

export function fromQ64(q: bigint): number {
  return Number(q) / 2 ** 64;
}

/** ceil(a * b / c) */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('div by zero');
  const p = a * b;
  return (p + c - 1n) / c;
}

export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('div by zero');
  return (a * b) / c;
}

export function bigintToUi(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

export function uiToBigint(ui: number, decimals: number): bigint {
  if (!Number.isFinite(ui)) throw new Error(`bad ui amount ${ui}`);
  return BigInt(Math.round(ui * 10 ** decimals));
}

export function bpsOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * BPS);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function sumBig(xs: readonly bigint[]): bigint {
  let s = 0n;
  for (const x of xs) s += x;
  return s;
}

export function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Deterministic PRNG (mulberry32) for mock data / tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
