import type { MethodologyConfig, WeightingScheme } from '../config/methodology.config.js';
import { BPS } from '../util/math.js';
import type { TargetWeight } from './types.js';

export interface WeightInput {
  mint: string;
  symbol: string;
  marketCapUsd: number;
}

/** Largest-remainder rounding so integer bps sum to exactly 10_000. */
export function normalizeToBps(raw: readonly number[], roundingBps = 1): number[] {
  const total = raw.reduce((a, b) => a + b, 0);
  if (raw.length === 0 || total <= 0) return raw.map(() => 0);
  const unit = Math.max(1, roundingBps);
  const scaled = raw.map((w) => (w / total) * BPS);
  const floored = scaled.map((w) => Math.floor(w / unit) * unit);
  let remainder = BPS - floored.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((w, i) => ({ i, frac: w - (floored[i] ?? 0) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && order.length > 0; k = (k + 1) % order.length) {
    const idx = order[k]?.i;
    if (idx === undefined) break;
    floored[idx] = (floored[idx] ?? 0) + unit;
    remainder -= unit;
  }
  return floored;
}

export function equalWeights(n: number): number[] {
  return Array.from({ length: n }, () => 1);
}

/**
 * Iterative capping/flooring (the standard "capped index" algorithm):
 * fix weights that breach the cap/floor at the bound, renormalize the rest, repeat until stable.
 */
export function capAndFloor(raw: readonly number[], capBps: number, floorBps: number, maxIter = 100): { weights: number[]; iterations: number } {
  const n = raw.length;
  if (n === 0) return { weights: [], iterations: 0 };
  const cap = capBps / BPS;
  const floor = floorBps / BPS;
  if (cap * n < 1 - 1e-12) throw new Error(`cap ${capBps}bps x ${n} assets cannot reach 100%`);
  if (floor * n > 1 + 1e-12) throw new Error(`floor ${floorBps}bps x ${n} assets exceeds 100%`);

  const fixed = new Map<number, number>();
  let weights: number[] = [];
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const freeIdx = raw.map((_, i) => i).filter((i) => !fixed.has(i));
    const fixedSum = [...fixed.values()].reduce((a, b) => a + b, 0);
    const freeRaw = freeIdx.reduce((a, i) => a + (raw[i] ?? 0), 0);
    const budget = 1 - fixedSum;
    weights = raw.map((r, i) => fixed.get(i) ?? (freeRaw > 0 ? (r / freeRaw) * budget : budget / Math.max(1, freeIdx.length)));
    let changed = false;
    for (const i of freeIdx) {
      const w = weights[i] ?? 0;
      if (w > cap + 1e-12) {
        fixed.set(i, cap);
        changed = true;
      } else if (w < floor - 1e-12) {
        fixed.set(i, floor);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { weights, iterations: iterations + 1 };
}

export function computeRawWeights(inputs: readonly WeightInput[], scheme: WeightingScheme, cfg: MethodologyConfig['weighting']): number[] {
  switch (scheme) {
    case 'equal':
      return equalWeights(inputs.length);
    case 'sqrt-cap': {
      const raw = inputs.map((i) => Math.sqrt(Math.max(0, i.marketCapUsd)));
      return capAndFloor(raw, cfg.sqrtCap.capBps, cfg.sqrtCap.floorBps).weights;
    }
    case 'capped-cap': {
      const raw = inputs.map((i) => Math.max(0, i.marketCapUsd));
      return capAndFloor(raw, cfg.cappedCap.capBps, 0).weights;
    }
    default: {
      const never: never = scheme;
      throw new Error(`unknown weighting scheme ${String(never)}`);
    }
  }
}

export function computeTargetWeights(inputs: readonly WeightInput[], cfg: MethodologyConfig): TargetWeight[] {
  if (inputs.length === 0) return [];
  const raw = computeRawWeights(inputs, cfg.weighting.scheme, cfg.weighting);
  const bps = normalizeToBps(raw, cfg.weighting.roundingBps);
  return inputs.map((i, k) => ({ mint: i.mint, symbol: i.symbol, weightBps: bps[k] ?? 0 }));
}
