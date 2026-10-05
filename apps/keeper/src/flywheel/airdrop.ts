/** Pure pro-rata airdrop maths with dust carry-forward and exclusion list. */

export interface HolderInput {
  owner: string;
  amount: bigint;
}

export interface AirdropInput {
  holders: readonly HolderInput[];
  /** index units available to distribute this round (raw, 6 decimals) */
  totalUnits: bigint;
  /** carried-forward units per wallet from earlier rounds */
  carry: ReadonlyMap<string, bigint>;
  /** a wallet's (share + carry) must reach this to be paid (ATA rent equivalent) */
  minUnits: bigint;
  exclude: ReadonlySet<string>;
}

export interface Payout {
  wallet: string;
  units: bigint;
}

export interface AirdropResult {
  payouts: Payout[];
  /** new carry table (wallets below threshold) */
  carry: Map<string, bigint>;
  distributedUnits: bigint;
  carriedUnits: bigint;
  /** rounding dust that goes back to the pool */
  undistributedUnits: bigint;
  eligibleHolders: number;
  skipped: number;
}

export function computeAirdrop(i: AirdropInput): AirdropResult {
  const eligible = i.holders.filter((h) => h.amount > 0n && !i.exclude.has(h.owner));
  const supply = eligible.reduce((s, h) => s + h.amount, 0n);
  const carry = new Map<string, bigint>();
  const payouts: Payout[] = [];
  let distributed = 0n;
  let allocated = 0n;
  let skipped = 0;

  if (supply === 0n || i.totalUnits === 0n) {
    for (const [w, u] of i.carry) if (u > 0n) carry.set(w, u);
    return { payouts, carry, distributedUnits: 0n, carriedUnits: [...carry.values()].reduce((a, b) => a + b, 0n), undistributedUnits: i.totalUnits, eligibleHolders: eligible.length, skipped: eligible.length };
  }

  const seen = new Set<string>();
  for (const h of eligible) {
    seen.add(h.owner);
    const share = (i.totalUnits * h.amount) / supply;
    allocated += share;
    const total = share + (i.carry.get(h.owner) ?? 0n);
    if (total >= i.minUnits && total > 0n) {
      payouts.push({ wallet: h.owner, units: total });
      distributed += total;
    } else {
      if (total > 0n) carry.set(h.owner, total);
      skipped++;
    }
  }
  // Wallets that sold everything keep their carry until they are paid or we decide to drop it.
  for (const [w, u] of i.carry) if (!seen.has(w) && u > 0n) carry.set(w, u);

  payouts.sort((a, b) => (a.units > b.units ? -1 : a.units < b.units ? 1 : a.wallet.localeCompare(b.wallet)));
  return {
    payouts,
    carry,
    distributedUnits: distributed,
    carriedUnits: [...carry.values()].reduce((a, b) => a + b, 0n),
    undistributedUnits: i.totalUnits - allocated,
    eligibleHolders: eligible.length,
    skipped,
  };
}

export function batch<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('batch size must be positive');
  const out: T[][] = [];
  for (let k = 0; k < items.length; k += size) out.push(items.slice(k, k + size));
  return out;
}

/** Index units (6 decimals) equivalent to the ATA rent in SOL at current prices. */
export function minUnitsForRent(ataRentLamports: number, solPriceUsd: number, navPerUnitUsd: number): bigint {
  if (!(navPerUnitUsd > 0) || !(solPriceUsd > 0)) return 0n;
  const rentUsd = (ataRentLamports / 1e9) * solPriceUsd;
  return BigInt(Math.ceil((rentUsd / navPerUnitUsd) * 1e6));
}
