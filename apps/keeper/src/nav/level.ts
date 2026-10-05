/**
 * Divisor reconciliation between snapshots.
 *
 * Only price moves are "performance". Any balance change (auction fill, creation, redemption,
 * asset add/remove) is a corporate action: re-set the divisor so the level is continuous.
 *
 *   MV_prevBalances@now = sum_i prevBalance_i * price_i,now
 *   MV_now              = sum_i curBalance_i  * price_i,now
 *   divisor'            = divisor * MV_now / MV_prevBalances@now
 */
import { rebaseDivisor } from '../methodology/index-level.js';

export interface BalanceAtPrice {
  mint: string;
  balanceUi: number;
  priceUsd: number;
}

export interface LevelState {
  divisor: number;
  baseLevel: number;
  inceptionTs: string;
  lastBalances: { mint: string; balanceUi: number }[];
}

export interface ReconcileResult {
  divisor: number;
  level: number;
  marketValue: number;
  rebased: boolean;
}

export function reconcileDivisor(state: LevelState, current: readonly BalanceAtPrice[]): ReconcileResult {
  const mvNow = current.reduce((s, h) => s + h.balanceUi * h.priceUsd, 0);
  const prev = new Map(state.lastBalances.map((b) => [b.mint, b.balanceUi]));
  let changed = prev.size !== current.length;
  let mvPrevAtNow = 0;
  for (const h of current) {
    const pb = prev.get(h.mint) ?? 0;
    if (Math.abs(pb - h.balanceUi) > 1e-12 * Math.max(1, Math.abs(h.balanceUi))) changed = true;
    mvPrevAtNow += pb * h.priceUsd;
  }
  let divisor = state.divisor;
  if (changed && mvPrevAtNow > 0 && mvNow > 0) divisor = rebaseDivisor(state.divisor, mvPrevAtNow, mvNow);
  return { divisor, level: divisor > 0 ? mvNow / divisor : 0, marketValue: mvNow, rebased: changed && divisor !== state.divisor };
}

export function nextLevelState(state: LevelState, current: readonly BalanceAtPrice[], divisor: number): LevelState {
  return { ...state, divisor, lastBalances: current.map((c) => ({ mint: c.mint, balanceUi: c.balanceUi })) };
}
