import { describe, expect, it } from 'vitest';
import { createMockState, mockHoldings, tickMockState } from '../src/mock/generator.js';
import { seededRandom } from '../src/util/math.js';

describe('mock generator', () => {
  it('is deterministic for a seed', () => {
    const a = createMockState(1, 1_700_000_000_000);
    const b = createMockState(1, 1_700_000_000_000);
    expect(a.fundPda).toBe(b.fundPda);
    expect(a.history.map((h) => h.indexLevel)).toEqual(b.history.map((h) => h.indexLevel));
  });
  it('builds a coherent fund: 40 holdings, 90d history ending at the live NAV, level consistent with divisor', () => {
    const s = createMockState(7);
    expect(s.tokens).toHaveLength(40);
    expect(s.history.length).toBe(90 * 24 + 1);
    const h = mockHoldings(s);
    const nav = h.reduce((x, r) => x + r.valueUsd, 0);
    const last = s.history[s.history.length - 1]!;
    expect(nav / (Number(s.supply) / 1e6)).toBeCloseTo(last.navPerUnitUsd, 6);
    expect(nav / s.divisor).toBeCloseTo(last.indexLevel, 6);
    expect(h.reduce((x, r) => x + r.targetWeightBps, 0)).toBe(10_000);
  });
  it('ticks: prices move, auctions decay monotonically', () => {
    const s = createMockState(3);
    const open = s.auctions.find((a) => a.status === 'open')!;
    const before = BigInt(open.currentPrice);
    tickMockState(s, seededRandom(1));
    expect(BigInt(open.currentPrice)).toBeLessThanOrEqual(before);
    expect(s.currentSlot).toBeGreaterThan(0n);
  });
});
