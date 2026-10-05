/**
 * On-chain reference prices (auction price bounds). After every NAV snapshot the keeper, acting
 * as the fund's rebalancer, pushes `set_ref_price` for every constituent whose price moved,
 * clamped to the program's per-period move cap (`max_ref_move_bps` vs the period anchor).
 *
 * Convention (SDK `usdToRefPriceQ64`): ref price = Q64.64 nano-USD per raw base unit.
 */
import { PublicKey } from '@solana/web3.js';
import type { AssetState, ChainClient, FundState } from '../chain/types.js';
import type { TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import type { NavComputed } from '../nav/service.js';
import { childLogger } from '../util/logger.js';
import { Q64 } from '../util/math.js';

const log = childLogger('ref-prices');

export const REF_PRICE_NUMERAIRE_USD = 1e-9;

/** USD per whole token -> Q64.64 nano-USD per raw unit (bigint, exact to ~1e-15 relative). */
export function usdToRefPriceQ64(priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) throw new Error(`bad price ${priceUsd}`);
  // toPrecision(15) removes binary float noise (1.3e-3 / 1e-9 / 1e6 -> exactly 1300)
  const perRaw = Number((priceUsd / REF_PRICE_NUMERAIRE_USD / 10 ** decimals).toPrecision(15));
  // split into integer + fraction to keep precision for tiny and large values
  const intPart = Math.floor(perRaw);
  const frac = perRaw - intPart;
  return BigInt(intPart) * Q64 + BigInt(Math.round(frac * 2 ** 64));
}

export function refPriceQ64ToUsd(refPrice: bigint, decimals: number): number {
  return (Number(refPrice) / 2 ** 64) * REF_PRICE_NUMERAIRE_USD * 10 ** decimals;
}

/** ceil(|new - old| * 10_000 / old), mirrors the program's move_bps. */
export function moveBps(oldPrice: bigint, newPrice: bigint): bigint {
  if (oldPrice <= 0n) return 0n;
  const diff = newPrice >= oldPrice ? newPrice - oldPrice : oldPrice - newPrice;
  const num = diff * 10_000n;
  return num % oldPrice === 0n ? num / oldPrice : num / oldPrice + 1n;
}

/** Anchor the program will compare the next update against at `slot` (re-anchors when the period rolled). */
export function effectiveAnchor(a: Pick<AssetState, 'refPrice' | 'refPriceAnchor' | 'refPriceAnchorSlot'>, periodSlots: bigint, slot: bigint): bigint {
  if (a.refPrice === 0n) return 0n;
  return slot >= a.refPriceAnchorSlot + periodSlots ? a.refPrice : a.refPriceAnchor;
}

export interface RefPriceUpdate {
  mint: string;
  current: bigint;
  target: bigint;
  /** value that will be sent (clamped into the cap window) */
  send: bigint;
  clamped: boolean;
  /** move of `target` vs the anchor, bps */
  targetMoveBps: number;
  /** first value: only the authority may set it */
  bootstrap: boolean;
}

export interface RefPricePlan {
  updates: RefPriceUpdate[];
  /** assets skipped because the change is below minChangeBps */
  unchanged: string[];
  /** assets without a USD price */
  unpriced: string[];
  /** assets whose first ref price must be set by the authority (keeper is not authority) */
  needsAuthority: string[];
}

export interface RefPricePlanOptions {
  maxRefMoveBps: number;
  periodSlots: bigint;
  slot: bigint;
  /** skip updates smaller than this many bps vs the current value */
  minChangeBps: number;
  /** whether the signer is the fund authority (may set first values) */
  isAuthority: boolean;
}

/** Pure: decide which set_ref_price calls to make for this snapshot. */
export function planRefPriceUpdates(assets: readonly AssetState[], prices: ReadonlyMap<string, number>, o: RefPricePlanOptions): RefPricePlan {
  const plan: RefPricePlan = { updates: [], unchanged: [], unpriced: [], needsAuthority: [] };
  for (const a of assets) {
    const px = prices.get(a.mint);
    if (!(px && px > 0)) {
      plan.unpriced.push(a.mint);
      continue;
    }
    const target = usdToRefPriceQ64(px, a.decimals);
    if (a.refPrice === 0n) {
      if (!o.isAuthority) {
        plan.needsAuthority.push(a.mint);
        continue;
      }
      plan.updates.push({ mint: a.mint, current: 0n, target, send: target, clamped: false, targetMoveBps: 0, bootstrap: true });
      continue;
    }
    const change = moveBps(a.refPrice, target);
    if (change < BigInt(o.minChangeBps)) {
      plan.unchanged.push(a.mint);
      continue;
    }
    const anchor = effectiveAnchor(a, o.periodSlots, o.slot);
    const maxDelta = (anchor * BigInt(o.maxRefMoveBps)) / 10_000n;
    const lo = anchor - maxDelta;
    const hi = anchor + maxDelta;
    let send = target;
    let clamped = false;
    if (target < lo) {
      send = lo;
      clamped = true;
    } else if (target > hi) {
      send = hi;
      clamped = true;
    }
    if (send === a.refPrice) {
      // already pinned at the edge of the window; nothing more can move this period
      plan.unchanged.push(a.mint);
      continue;
    }
    plan.updates.push({ mint: a.mint, current: a.refPrice, target, send, clamped, targetMoveBps: Number(moveBps(anchor, target)), bootstrap: false });
  }
  return plan;
}

export interface RefPriceUpdaterDeps {
  chain: ChainClient;
  tx: TxSender;
  repo: Repo;
  env: Env;
}

export interface RefPriceRunResult {
  sent: number;
  clamped: string[];
  unchanged: number;
  unpriced: string[];
  needsAuthority: string[];
  sigs: string[];
}

const PER_TX = 10;

export class RefPriceUpdater {
  constructor(private readonly d: RefPriceUpdaterDeps) {}

  /** Push ref prices from a NAV computation. Call after every nav snapshot. */
  async update(nav: NavComputed, opts: { dry?: boolean } = {}): Promise<RefPriceRunResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const fund: FundState = nav.fund;
    const signer = this.d.tx.payer.toBase58();
    const isAuthority = fund.authority === signer;
    const isRebalancer = fund.rebalancer === signer;
    const result: RefPriceRunResult = { sent: 0, clamped: [], unchanged: 0, unpriced: [], needsAuthority: [], sigs: [] };
    if (!isAuthority && !isRebalancer) {
      log.warn({ signer, rebalancer: fund.rebalancer }, 'keeper is neither rebalancer nor authority; ref prices not updated');
      return result;
    }
    const slot = await this.d.chain.getCurrentSlot();
    const plan = planRefPriceUpdates(nav.assets, nav.prices, {
      maxRefMoveBps: fund.maxRefMoveBps,
      periodSlots: fund.refMovePeriodSlots,
      slot,
      minChangeBps: this.d.env.REF_PRICE_MIN_CHANGE_BPS,
      isAuthority,
    });
    result.unchanged = plan.unchanged.length;
    result.unpriced = plan.unpriced;
    result.needsAuthority = plan.needsAuthority;
    if (plan.needsAuthority.length) log.warn({ mints: plan.needsAuthority }, 'assets without a ref price; the authority must set the first value (set_ref_price / ACTION_REF_PRICE_OVERRIDE)');
    for (const u of plan.updates) {
      if (u.clamped) {
        result.clamped.push(u.mint);
        log.warn(
          { mint: u.mint, targetMoveBps: u.targetMoveBps, maxRefMoveBps: fund.maxRefMoveBps, current: u.current.toString(), target: u.target.toString(), send: u.send.toString() },
          'ref price move exceeds max_ref_move_bps; clamped to the period window (authority override needed to move further)',
        );
      }
    }
    for (let i = 0; i < plan.updates.length; i += PER_TX) {
      const batch = plan.updates.slice(i, i + PER_TX);
      const ixs = [];
      for (const u of batch) ixs.push(...(await this.d.chain.setRefPriceIx(new PublicKey(u.mint), u.send, this.d.tx.payer)));
      if (dry) {
        log.info({ n: batch.length, mints: batch.map((b) => b.mint) }, 'DRY_RUN set_ref_price batch');
        continue;
      }
      try {
        const sig = await this.d.tx.sendIxs(ixs, { label: `set_ref_price x${batch.length}` });
        result.sigs.push(sig);
        result.sent += batch.length;
      } catch (err) {
        log.error({ err: (err as Error).message, mints: batch.map((b) => b.mint) }, 'set_ref_price batch failed');
      }
    }
    if (plan.updates.length) log.info({ sent: result.sent, clamped: result.clamped.length, unchanged: result.unchanged }, 'ref prices updated');
    return result;
  }
}
