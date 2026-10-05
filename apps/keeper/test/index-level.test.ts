import { describe, expect, it } from 'vitest';
import { IndexLevelEngine, indexLevel, initialDivisor, marketValue, rebaseDivisor } from '../src/methodology/index-level.js';
import { nextLevelState, reconcileDivisor, type LevelState } from '../src/nav/level.js';

describe('divisor method', () => {
  it('starts at base 1000', () => {
    const mv = 1_250_000;
    const d = initialDivisor(mv, 1000);
    expect(indexLevel(mv, d)).toBeCloseTo(1000, 9);
  });

  it('level moves with prices only', () => {
    const holdings = [
      { priceUsd: 1, balanceUi: 1000 },
      { priceUsd: 2, balanceUi: 500 },
    ];
    const engine = IndexLevelEngine.inception(marketValue(holdings), 1000);
    const up = [
      { priceUsd: 1.1, balanceUi: 1000 },
      { priceUsd: 2.2, balanceUi: 500 },
    ];
    expect(engine.level(marketValue(up))).toBeCloseTo(1100, 9);
  });

  it('is continuous across an auction fill (sell A, buy B at a discount to mid)', () => {
    // Before: 1000 A @ $1, 500 B @ $2  -> MV 2000, level 1000
    const before = [
      { priceUsd: 1, balanceUi: 1000 },
      { priceUsd: 2, balanceUi: 500 },
    ];
    const engine = IndexLevelEngine.inception(marketValue(before), 1000);
    // Fill: sell 200 A, receive 96 B (filler got a 4% discount) -> MV = 800 + 596*2 = 1992
    const after = [
      { priceUsd: 1, balanceUi: 800 },
      { priceUsd: 2, balanceUi: 596 },
    ];
    const levelBefore = engine.level(marketValue(before));
    engine.applyCorporateAction(marketValue(before), marketValue(after));
    const levelAfter = engine.level(marketValue(after));
    expect(levelAfter).toBeCloseTo(levelBefore, 9);
    // Subsequent price moves still flow through 1:1
    const later = [
      { priceUsd: 1.05, balanceUi: 800 },
      { priceUsd: 2.1, balanceUi: 596 },
    ];
    expect(engine.level(marketValue(later))).toBeCloseTo(levelBefore * 1.05, 9);
  });

  it('rebaseDivisor is multiplicative and composable', () => {
    const d1 = rebaseDivisor(10, 100, 90);
    const d2 = rebaseDivisor(d1, 90, 120);
    expect(d2).toBeCloseTo(rebaseDivisor(10, 100, 120), 12);
  });
});

describe('reconcileDivisor (snapshot-to-snapshot)', () => {
  const state0: LevelState = {
    divisor: initialDivisor(2000, 1000),
    baseLevel: 1000,
    inceptionTs: 't0',
    lastBalances: [
      { mint: 'A', balanceUi: 1000 },
      { mint: 'B', balanceUi: 500 },
    ],
  };

  it('does not rebase when only prices changed', () => {
    const r = reconcileDivisor(state0, [
      { mint: 'A', balanceUi: 1000, priceUsd: 1.2 },
      { mint: 'B', balanceUi: 500, priceUsd: 1.8 },
    ]);
    expect(r.rebased).toBe(false);
    expect(r.divisor).toBe(state0.divisor);
    expect(r.level).toBeCloseTo(((1200 + 900) / 2000) * 1000, 9);
  });

  it('rebases when balances changed (fill + simultaneous price move) and keeps the level continuous', () => {
    // prices moved: A 1 -> 1.1, B 2 -> 1.9 ; and a fill moved 200 A out, 110 B in
    const cur = [
      { mint: 'A', balanceUi: 800, priceUsd: 1.1 },
      { mint: 'B', balanceUi: 610, priceUsd: 1.9 },
    ];
    const r = reconcileDivisor(state0, cur);
    expect(r.rebased).toBe(true);
    // level must equal what pure price performance would have produced on the OLD balances
    const perfOnly = (1000 * 1.1 + 500 * 1.9) / state0.divisor;
    expect(r.level).toBeCloseTo(perfOnly, 9);
    const state1 = nextLevelState(state0, cur, r.divisor);
    expect(state1.lastBalances).toEqual([
      { mint: 'A', balanceUi: 800 },
      { mint: 'B', balanceUi: 610 },
    ]);
  });

  it('handles creations (pro-rata balance growth) without moving the level', () => {
    const cur = [
      { mint: 'A', balanceUi: 1100, priceUsd: 1 },
      { mint: 'B', balanceUi: 550, priceUsd: 2 },
    ];
    const r = reconcileDivisor(state0, cur);
    expect(r.rebased).toBe(true);
    expect(r.level).toBeCloseTo(1000, 9);
  });

  it('handles a newly added constituent', () => {
    const cur = [
      { mint: 'A', balanceUi: 1000, priceUsd: 1 },
      { mint: 'B', balanceUi: 500, priceUsd: 2 },
      { mint: 'C', balanceUi: 100, priceUsd: 5 },
    ];
    const r = reconcileDivisor(state0, cur);
    expect(r.rebased).toBe(true);
    expect(r.level).toBeCloseTo(1000, 9);
  });
});
