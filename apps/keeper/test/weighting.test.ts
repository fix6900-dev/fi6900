import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG, withMethodologyOverrides } from '../src/config/methodology.config.js';
import { capAndFloor, computeTargetWeights, normalizeToBps } from '../src/methodology/weighting.js';

const caps = [5_000, 2_000, 1_000, 800, 500, 300, 200, 100, 50, 25].map((m, i) => ({ mint: `M${i}`, symbol: `S${i}`, marketCapUsd: m * 1e6 }));

describe('normalizeToBps', () => {
  it('sums to exactly 10_000 with largest-remainder rounding', () => {
    const w = normalizeToBps([1, 1, 1]);
    expect(w.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(w.sort()).toEqual([3333, 3333, 3334]);
  });
  it('handles 40 equal weights', () => {
    const w = normalizeToBps(Array(40).fill(1));
    expect(w.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(Math.max(...w) - Math.min(...w)).toBe(0);
  });
  it('respects rounding granularity', () => {
    const w = normalizeToBps([1, 2, 3], 5);
    expect(w.reduce((a, b) => a + b, 0)).toBe(10_000);
    for (const x of w) expect(x % 5).toBe(0);
  });
});

describe('equal weighting (default)', () => {
  it('gives every constituent 1/N', () => {
    const w = computeTargetWeights(caps, DEFAULT_METHODOLOGY_CONFIG);
    expect(DEFAULT_METHODOLOGY_CONFIG.weighting.scheme).toBe('equal');
    expect(w.every((x) => x.weightBps === 1000)).toBe(true);
  });
});

describe('capAndFloor', () => {
  it('converges and respects cap and floor', () => {
    const raw = caps.map((c) => Math.sqrt(c.marketCapUsd));
    const { weights, iterations } = capAndFloor(raw, 1200, 50);
    expect(iterations).toBeLessThan(20);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const w of weights) {
      expect(w).toBeLessThanOrEqual(0.12 + 1e-9);
      expect(w).toBeGreaterThanOrEqual(0.005 - 1e-9);
    }
    // the largest name hits the cap exactly
    expect(weights[0]).toBeCloseTo(0.12, 9);
  });

  it('is a fixed point: re-capping the output changes nothing', () => {
    const raw = caps.map((c) => c.marketCapUsd);
    const first = capAndFloor(raw, 2000, 0).weights;
    const second = capAndFloor(first, 2000, 0).weights;
    first.forEach((w, i) => expect(second[i]).toBeCloseTo(w, 12));
  });

  it('caps cascade: capping the top pushes the next over the cap, which is capped too', () => {
    const raw = [100, 90, 1, 1, 1, 1, 1, 1, 1, 1];
    const { weights } = capAndFloor(raw, 2000, 0);
    expect(weights[0]).toBeCloseTo(0.2, 9);
    expect(weights[1]).toBeCloseTo(0.2, 9);
    expect(weights.slice(2).reduce((a, b) => a + b, 0)).toBeCloseTo(0.6, 9);
  });

  it('throws when the cap cannot reach 100%', () => {
    expect(() => capAndFloor([1, 1, 1], 2000, 0)).toThrow();
  });
});

describe('sqrt-cap and capped-cap schemes', () => {
  it('sqrt-cap integer bps sum to 10_000 and no weight exceeds cap', () => {
    const cfg = withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { scheme: 'sqrt-cap' });
    const w = computeTargetWeights(caps, cfg);
    expect(w.reduce((a, b) => a + b.weightBps, 0)).toBe(10_000);
    expect(Math.max(...w.map((x) => x.weightBps))).toBeLessThanOrEqual(1201);
    expect(Math.min(...w.map((x) => x.weightBps))).toBeGreaterThanOrEqual(50);
  });
  it('capped-cap caps at 20%', () => {
    const cfg = withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { scheme: 'capped-cap' });
    const w = computeTargetWeights(caps, cfg);
    expect(w.reduce((a, b) => a + b.weightBps, 0)).toBe(10_000);
    // Cascade: 5000, 2000 and 1000 (of ~9975) each breach 20% as the others are capped -> three names at the cap;
    // the 4th gets 800/1975 * 40% = 16.2%.
    expect(w[0]?.weightBps).toBe(2000);
    expect(w[1]?.weightBps).toBe(2000);
    expect(w[2]?.weightBps).toBe(2000);
    expect(w[3]?.weightBps).toBeCloseTo(1620, -1);
    expect(w[3]?.weightBps).toBeGreaterThan(w[4]?.weightBps ?? 0);
  });
});
