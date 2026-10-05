/** Pure NAV / weight / drift computation from on-chain balances + prices. */
import { effectiveBalance, type AssetState } from '../chain/types.js';
import { bigintToUi, bpsOf } from '../util/math.js';

export interface HoldingNav {
  slot: number;
  mint: string;
  decimals: number;
  /** effective balance (raw) */
  balance: bigint;
  balanceUi: number;
  priceUsd: number;
  valueUsd: number;
  weightBps: number;
  targetWeightBps: number;
  /** weight - target, in bps (positive = overweight) */
  driftBps: number;
  status: AssetState['status'];
  vault: string;
}

export interface NavResult {
  navUsd: number;
  /** USD per index unit (6 decimals). 0 when supply is 0. */
  navPerUnitUsd: number;
  supply: bigint;
  holdings: HoldingNav[];
  /** Mints for which no price was available (excluded from NAV; flagged). */
  unpriced: string[];
}

export const INDEX_DECIMALS = 6;

export function computeNav(assets: readonly AssetState[], prices: ReadonlyMap<string, number>, supply: bigint): NavResult {
  const unpriced: string[] = [];
  const rows = assets.map((a) => {
    const bal = effectiveBalance(a);
    const price = prices.get(a.mint);
    if (price === undefined) unpriced.push(a.mint);
    const balanceUi = bigintToUi(bal, a.decimals);
    return { a, bal, balanceUi, price: price ?? 0, valueUsd: balanceUi * (price ?? 0) };
  });
  const navUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
  const holdings: HoldingNav[] = rows.map((r) => {
    const weightBps = bpsOf(r.valueUsd, navUsd);
    return {
      slot: r.a.index,
      mint: r.a.mint,
      decimals: r.a.decimals,
      balance: r.bal,
      balanceUi: r.balanceUi,
      priceUsd: r.price,
      valueUsd: r.valueUsd,
      weightBps,
      targetWeightBps: r.a.targetWeightBps,
      driftBps: weightBps - r.a.targetWeightBps,
      status: r.a.status,
      vault: r.a.vault,
    };
  });
  const navPerUnitUsd = supply > 0n ? navUsd / bigintToUi(supply, INDEX_DECIMALS) : 0;
  return { navUsd, navPerUnitUsd, supply, holdings, unpriced };
}

/** Basket required to create `units` (mirrors on-chain ceil(effective * units / supply)). */
export function creationBasket(assets: readonly AssetState[], units: bigint, supply: bigint): { mint: string; amount: bigint }[] {
  if (supply === 0n) throw new Error('supply is zero; use bootstrap');
  return assets
    .filter((a) => a.status === 'active')
    .map((a) => {
      const eff = effectiveBalance(a);
      return { mint: a.mint, amount: (eff * units + supply - 1n) / supply };
    });
}

/** Basket received when redeeming `units` (net of fee): floor(effective * netUnits / supply). */
export function redemptionBasket(assets: readonly AssetState[], units: bigint, supply: bigint, redeemFeeBps: number): { mint: string; amount: bigint }[] {
  if (supply === 0n) return [];
  const fee = (units * BigInt(redeemFeeBps)) / 10_000n;
  const net = units - fee;
  return assets
    .filter((a) => a.status === 'active')
    .map((a) => ({ mint: a.mint, amount: (effectiveBalance(a) * net) / supply }));
}

export function premiumBps(marketPriceUsd: number, navPerUnitUsd: number): number {
  if (!(navPerUnitUsd > 0) || !(marketPriceUsd > 0)) return 0;
  return Math.round(((marketPriceUsd - navPerUnitUsd) / navPerUnitUsd) * 10_000);
}
