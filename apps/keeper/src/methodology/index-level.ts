/**
 * S&P divisor method.
 *
 *   level_t  = MV_t / divisor_t,   MV_t = sum_i price_i,t * effective_balance_i,t
 *   divisor_0 = MV_0 / baseLevel
 *
 * Any event that changes MV without being "performance" (auction fill, creation, redemption,
 * fee accrual...) re-sets the divisor so the level is unchanged at the instant of the event:
 *
 *   divisor' = divisor * MV_after / MV_before
 */

export interface IndexLevelState {
  divisor: number;
  baseLevel: number;
  inceptionTs: string;
}

export interface HoldingValue {
  priceUsd: number;
  /** effective balance in UI units */
  balanceUi: number;
}

export function marketValue(holdings: readonly HoldingValue[]): number {
  let mv = 0;
  for (const h of holdings) mv += h.priceUsd * h.balanceUi;
  return mv;
}

export function initialDivisor(mv: number, baseLevel: number): number {
  if (!(mv > 0)) throw new Error('cannot initialise divisor with zero market value');
  return mv / baseLevel;
}

export function indexLevel(mv: number, divisor: number): number {
  if (!(divisor > 0)) throw new Error('divisor must be positive');
  return mv / divisor;
}

/** New divisor keeping the level continuous when MV jumps from `mvBefore` to `mvAfter`. */
export function rebaseDivisor(divisor: number, mvBefore: number, mvAfter: number): number {
  if (!(mvBefore > 0)) return mvAfter > 0 ? divisor : divisor;
  return divisor * (mvAfter / mvBefore);
}

/**
 * Stateful helper around the pure functions. Persisted by the caller (kv table).
 */
export class IndexLevelEngine {
  private state: IndexLevelState;

  constructor(state: IndexLevelState) {
    this.state = state;
  }

  static inception(mv: number, baseLevel: number, ts = new Date().toISOString()): IndexLevelEngine {
    return new IndexLevelEngine({ divisor: initialDivisor(mv, baseLevel), baseLevel, inceptionTs: ts });
  }

  get divisor(): number {
    return this.state.divisor;
  }

  snapshot(): IndexLevelState {
    return { ...this.state };
  }

  level(mv: number): number {
    return indexLevel(mv, this.state.divisor);
  }

  /** Call with the MV immediately before and after a non-performance event (e.g. auction fill). */
  applyCorporateAction(mvBefore: number, mvAfter: number): number {
    this.state = { ...this.state, divisor: rebaseDivisor(this.state.divisor, mvBefore, mvAfter) };
    return this.state.divisor;
  }
}
