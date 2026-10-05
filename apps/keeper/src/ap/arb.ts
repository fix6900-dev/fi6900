/** Pure AP arbitrage decision. */

export interface ArbInput {
  navPerUnitUsd: number;
  /** USD cost per unit when buying units on Jupiter for the configured notional. */
  buyPriceUsd: number | null;
  /** USD received per unit when selling units on Jupiter. */
  sellPriceUsd: number | null;
  thresholdBps: number;
  mintFeeBps: number;
  redeemFeeBps: number;
  /** Expected round-trip Jupiter cost on the basket legs (bps of notional). */
  basketSlippageBps: number;
  /** Fixed gas / rent estimate in USD per cycle. */
  fixedCostUsd: number;
  notionalUsd: number;
}

export type ArbAction = 'create' | 'redeem' | 'none';

export interface ArbDecision {
  action: ArbAction;
  premiumBps: number;
  discountBps: number;
  expectedProfitUsd: number;
  units: number;
  reason: string;
}

export function decideArb(i: ArbInput): ArbDecision {
  const none = (reason: string, premiumBps = 0, discountBps = 0): ArbDecision => ({ action: 'none', premiumBps, discountBps, expectedProfitUsd: 0, units: 0, reason });
  if (!(i.navPerUnitUsd > 0)) return none('nav unavailable');
  const units = i.notionalUsd / i.navPerUnitUsd;

  const premiumBps = i.sellPriceUsd ? Math.round(((i.sellPriceUsd - i.navPerUnitUsd) / i.navPerUnitUsd) * 10_000) : 0;
  const discountBps = i.buyPriceUsd ? Math.round(((i.navPerUnitUsd - i.buyPriceUsd) / i.navPerUnitUsd) * 10_000) : 0;

  // Creation arb: buy basket (nav * (1 + slippage)), mint (fee in units), sell units at sellPrice.
  if (i.sellPriceUsd && premiumBps > i.thresholdBps) {
    const cost = units * i.navPerUnitUsd * (1 + i.basketSlippageBps / 10_000) + i.fixedCostUsd;
    const proceeds = units * (1 - i.mintFeeBps / 10_000) * i.sellPriceUsd;
    const profit = proceeds - cost;
    if (profit > 0) return { action: 'create', premiumBps, discountBps, expectedProfitUsd: profit, units, reason: `premium ${premiumBps}bps > ${i.thresholdBps}bps` };
    return none(`premium ${premiumBps}bps but unprofitable after fees (${profit.toFixed(2)} USD)`, premiumBps, discountBps);
  }

  // Redemption arb: buy units at buyPrice, redeem (fee in units), sell basket at nav*(1 - slippage).
  if (i.buyPriceUsd && discountBps > i.thresholdBps) {
    const cost = units * i.buyPriceUsd + i.fixedCostUsd;
    const proceeds = units * (1 - i.redeemFeeBps / 10_000) * i.navPerUnitUsd * (1 - i.basketSlippageBps / 10_000);
    const profit = proceeds - cost;
    if (profit > 0) return { action: 'redeem', premiumBps, discountBps, expectedProfitUsd: profit, units, reason: `discount ${discountBps}bps > ${i.thresholdBps}bps` };
    return none(`discount ${discountBps}bps but unprofitable after fees (${profit.toFixed(2)} USD)`, premiumBps, discountBps);
  }

  return none('within threshold', premiumBps, discountBps);
}
