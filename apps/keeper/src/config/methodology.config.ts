/**
 * FI6900 index methodology parameters (ARCHITECTURE.md section 3).
 * Everything the methodology engine needs is here; the engine itself is pure.
 */

export type WeightingScheme = 'equal' | 'sqrt-cap' | 'capped-cap';
export type UniverseSource = 'coingecko' | 'jupiter' | 'merged';

export interface MethodologyConfig {
  name: string;
  version: string;
  baseLevel: number;
  universe: {
    /**
     * coingecko = CoinGecko category members ranked by market cap (membership is the memecoin classification);
     * jupiter = Jupiter `verified` list ranked by 24h volume; merged = union of both.
     */
    source: UniverseSource;
    /** CoinGecko category slug. */
    coingeckoCategory: string;
    /** Upper bound on candidates pulled from the universe source (incumbents are always added). */
    maxCandidates: number;
  };
  eligibility: {
    /** Both mint and freeze authority must be revoked. */
    requireAuthoritiesRevoked: boolean;
    minAgeDays: number;
    minFdvUsd: number;
    minVolume24hUsd: number;
    minAvgVolume7dUsd: number;
    /** Jupiter sell quote of this notional... */
    impactQuoteUsd: number;
    /** ...must have price impact <= this. */
    maxPriceImpactBps: number;
    /** Mints that are never eligible (stables, LSTs, wrapped, manual exclusions). */
    denylist: readonly string[];
    /** Symbol heuristics for stable / LST / wrapped detection. */
    excludedSymbolPatterns: readonly string[];
    /** Token-list tags (Jupiter tokens/v2 taxonomy) that exclude a token: stables, LSTs, wrapped/bridged, tokenised stocks/RWA. */
    excludedTags: readonly string[];
    /**
     * When set, a token must carry at least one of these Jupiter token-list tags (e.g. ['meme']). Off by default; only
     * meaningful with universe.source=jupiter/merged (CoinGecko category membership already is the meme classification).
     */
    requireAnyTag?: readonly string[];
  };
  selection: {
    targetCount: number;
    /** Incumbents keep their seat until their rank exceeds this. */
    bufferRank: number;
  };
  weighting: {
    scheme: WeightingScheme;
    sqrtCap: { capBps: number; floorBps: number };
    cappedCap: { capBps: number };
    /** Weights are rounded to this granularity and forced to sum to 10_000. */
    roundingBps: number;
  };
  rebalance: {
    intervalDays: number;
    /**
     * Relative drift band: an asset triggers an interim rebalance when |actual - target| / target
     * exceeds this many bps (5000 = the weight is more than 50% above or below its target).
     */
    driftRelativeBps: number;
    maxTradePctOfDailyVolume: number;
    /** Dutch auction curve. */
    auction: {
      startPremiumBps: number;
      maxDiscountBps: number;
      durationSlots: number;
      /** Keeper self-fills once price <= mid * (1 - fallbackFillDiscountBps/1e4). */
      fallbackFillDiscountBps: number;
      /** Smallest trade worth an auction (USD). */
      minTradeUsd: number;
    };
  };
  reconstitution: {
    /** Day of month (UTC) on which reconstitution becomes effective. */
    dayOfMonth: number;
    hourUtc: number;
    announceHoursAhead: number;
    /** manual = index committee approves proposals (CLI/API); auto = keeper queues timelocked actions itself. */
    mode: 'manual' | 'auto';
    /** Rejected proposals are not re-proposed for this many days. */
    rejectCooldownDays: number;
  };
}

/** Stablecoins / LSTs / wrapped majors that must never enter a memecoin index. */
export const DEFAULT_DENYLIST: readonly string[] = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112', // wSOL
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP (governance token, not a memecoin)
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // WBTC (wormhole)
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WETH (wormhole)
];

export const DEFAULT_EXCLUDED_SYMBOL_PATTERNS: readonly string[] = [
  '^USD', 'USD$', '^USDC', '^USDT', '^PYUSD', '^UXD', '^DAI$', '^EUR', // stables
  'SOL$', '^SOL', '^JITO', '^MSOL', '^BSOL', '^INF$', '^JUPSOL', '^BNSOL', // LSTs / SOL variants
  '^W(BTC|ETH|BNB|AVAX|MATIC)', '^(C|SO|WH)?(BTC|ETH)$', '^CB(BTC|ETH)', // wrapped majors
];

/**
 * Jupiter tokens/v2 tags observed live (2026-10-03): meme, community, strict, verified, major, stable, lst, defi,
 * stocks, rwa, equities, xstocks, token-2022, launchpad, birdeye-trending, moonshot-verified, community-assist, unknown.
 * Tokenised equities (xStocks) and RWA are excluded here as "wrapped/bridged assets" in the sense of methodology 2.5.
 */
export const DEFAULT_EXCLUDED_TAGS: readonly string[] = ['stablecoin', 'stable', 'lst', 'liquid-staking', 'wrapped', 'bridged', 'wormhole', 'stocks', 'equities', 'xstocks', 'rwa', 'major'];

export const DEFAULT_METHODOLOGY_CONFIG: MethodologyConfig = {
  name: 'FI6900 Solana Memecoin Equal Weight Index',
  version: '1.1.0',
  baseLevel: 1000,
  universe: {
    source: 'coingecko',
    coingeckoCategory: 'solana-meme-coins',
    maxCandidates: 150,
  },
  eligibility: {
    requireAuthoritiesRevoked: true,
    minAgeDays: 14,
    minFdvUsd: 2_000_000,
    minVolume24hUsd: 250_000,
    minAvgVolume7dUsd: 100_000,
    impactQuoteUsd: 10_000,
    maxPriceImpactBps: 200,
    denylist: DEFAULT_DENYLIST,
    excludedSymbolPatterns: DEFAULT_EXCLUDED_SYMBOL_PATTERNS,
    excludedTags: DEFAULT_EXCLUDED_TAGS,
  },
  selection: {
    targetCount: 40,
    bufferRank: 50,
  },
  weighting: {
    scheme: 'equal',
    sqrtCap: { capBps: 1200, floorBps: 50 },
    cappedCap: { capBps: 2000 },
    roundingBps: 1,
  },
  rebalance: {
    intervalDays: 7,
    driftRelativeBps: 5000,
    maxTradePctOfDailyVolume: 5,
    auction: {
      startPremiumBps: 300,
      maxDiscountBps: 400,
      durationSlots: 150,
      fallbackFillDiscountBps: 50,
      minTradeUsd: 25,
    },
  },
  reconstitution: {
    dayOfMonth: 1,
    hourUtc: 0,
    announceHoursAhead: 48,
    mode: 'manual',
    rejectCooldownDays: 90,
  },
};

/** Shallow override helper for tests / env tweaks. */
export function withMethodologyOverrides(
  base: MethodologyConfig,
  o: {
    scheme?: WeightingScheme;
    intervalDays?: number;
    driftRelativeBps?: number;
    reconstitutionMode?: 'manual' | 'auto';
    rejectCooldownDays?: number;
    maxTradePctOfDailyVolume?: number;
    targetCount?: number;
    bufferRank?: number;
    universeSource?: UniverseSource;
    coingeckoCategory?: string;
    maxCandidates?: number;
    minVolume24hUsd?: number;
  },
): MethodologyConfig {
  return {
    ...base,
    universe: {
      source: o.universeSource ?? base.universe.source,
      coingeckoCategory: o.coingeckoCategory ?? base.universe.coingeckoCategory,
      maxCandidates: o.maxCandidates ?? base.universe.maxCandidates,
    },
    eligibility: o.minVolume24hUsd !== undefined ? { ...base.eligibility, minVolume24hUsd: o.minVolume24hUsd } : base.eligibility,
    selection: {
      targetCount: o.targetCount ?? base.selection.targetCount,
      bufferRank: o.bufferRank ?? base.selection.bufferRank,
    },
    weighting: { ...base.weighting, scheme: o.scheme ?? base.weighting.scheme },
    rebalance: {
      ...base.rebalance,
      intervalDays: o.intervalDays ?? base.rebalance.intervalDays,
      driftRelativeBps: o.driftRelativeBps ?? base.rebalance.driftRelativeBps,
      maxTradePctOfDailyVolume: o.maxTradePctOfDailyVolume ?? base.rebalance.maxTradePctOfDailyVolume,
    },
    reconstitution: {
      ...base.reconstitution,
      mode: o.reconstitutionMode ?? base.reconstitution.mode,
      rejectCooldownDays: o.rejectCooldownDays ?? base.reconstitution.rejectCooldownDays,
    },
  };
}

/** Build the effective config from env (WEIGHTING_SCHEME etc. are optional overrides). */
export function methodologyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MethodologyConfig {
  const scheme = env.WEIGHTING_SCHEME as WeightingScheme | undefined;
  return withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, {
    scheme: scheme && ['equal', 'sqrt-cap', 'capped-cap'].includes(scheme) ? scheme : undefined,
    intervalDays: env.REBALANCE_INTERVAL_DAYS ? Number(env.REBALANCE_INTERVAL_DAYS) : undefined,
    driftRelativeBps: env.DRIFT_RELATIVE_BPS ? Number(env.DRIFT_RELATIVE_BPS) : undefined,
    reconstitutionMode: env.RECONSTITUTION_MODE === 'auto' ? 'auto' : env.RECONSTITUTION_MODE === 'manual' ? 'manual' : undefined,
    rejectCooldownDays: env.RECON_REJECT_COOLDOWN_DAYS ? Number(env.RECON_REJECT_COOLDOWN_DAYS) : undefined,
    maxTradePctOfDailyVolume: env.MAX_TRADE_PCT_DAILY_VOLUME ? Number(env.MAX_TRADE_PCT_DAILY_VOLUME) : undefined,
    universeSource: env.UNIVERSE_SOURCE === 'coingecko' || env.UNIVERSE_SOURCE === 'jupiter' || env.UNIVERSE_SOURCE === 'merged' ? env.UNIVERSE_SOURCE : undefined,
    coingeckoCategory: env.COINGECKO_CATEGORY?.trim() || undefined,
    maxCandidates: env.UNIVERSE_MAX_CANDIDATES ? Number(env.UNIVERSE_MAX_CANDIDATES) : undefined,
  });
}
