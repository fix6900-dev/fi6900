import type { VersionedTransaction } from '@solana/web3.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export interface TokenMarketData {
  mint: string;
  priceUsd: number;
  volume24hUsd: number;
  liquidityUsd: number;
  fdvUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  /** Unix ms of the earliest known pair creation (proxy for first trade). null if unknown. */
  pairCreatedAt: number | null;
  symbol?: string;
  name?: string;
  /** Image URL when the source provides one (DexScreener `info.imageUrl`, Jupiter `icon`). */
  logo?: string | null;
  source: 'jupiter' | 'dexscreener' | 'mixed' | 'mock' | 'coingecko';
}

/** Jupiter tokens/v2 `audit` block. */
export interface TokenAudit {
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  /** % of supply held by the top holders as reported by Jupiter. */
  topHoldersPercentage: number | null;
  devBalancePercentage: number | null;
}

/** Aggregated market stats a token-list source may carry (Jupiter tokens/v2). All optional. */
export interface TokenListStats {
  usdPrice: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  /** buy + sell volume over the last 24h across every venue Jupiter indexes. */
  volume24hUsd: number | null;
  holderCount: number | null;
  /** Unix ms of the first pool Jupiter knows about. */
  firstPoolCreatedAt: number | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
  isVerified: boolean | null;
  audit: TokenAudit | null;
  tokenProgram: string | null;
}

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  tags: string[];
  /** Jupiter's reported daily volume (USD), when available. */
  dailyVolumeUsd: number | null;
  /** Extra aggregated stats when the source has them (Jupiter tokens/v2). */
  stats?: TokenListStats;
  /** CoinGecko category membership (set when the token is in the configured CoinGecko category). */
  cg?: CoinGeckoMembership;
}

/** Where a candidate entered the universe from. */
export type UniverseSourceName = 'coingecko' | 'jupiter' | 'merged';

export interface CoinGeckoMembership {
  id: string;
  /** 1-based position in the category ordered by market cap. */
  rank: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
}

/** A universe member: token info plus which source(s) nominated it. */
export interface TokenUniverseCandidate extends TokenInfo {
  /** 'merged' = nominated by both CoinGecko and the Jupiter verified list. */
  universeSource: UniverseSourceName;
}

export interface PriceSource {
  /** USD prices keyed by mint. Missing mints are simply absent. */
  getPrices(mints: readonly string[]): Promise<Map<string, number>>;
}

export interface MarketDataSource {
  getMarketData(mints: readonly string[]): Promise<Map<string, TokenMarketData>>;
}

export interface TokenInfoSource {
  getTokenInfo(mints: readonly string[]): Promise<Map<string, TokenInfo>>;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  otherAmountThreshold: bigint;
  /** 0.0123 == 1.23% */
  priceImpactPct: number;
  slippageBps: number;
  routeLabels: string[];
  /** Opaque provider payload needed to build the swap tx. */
  raw: unknown;
}

export interface QuoteSource {
  quote(p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; swapMode?: 'ExactIn' | 'ExactOut'; maxAccounts?: number }): Promise<SwapQuote>;
  /** Builds an unsigned swap transaction for `user`. */
  swapTx(quote: SwapQuote, user: string): Promise<VersionedTransaction>;
}

export interface HolderBalance {
  owner: string;
  tokenAccount: string;
  amount: bigint;
}

export interface HolderSource {
  getHolders(mint: string): Promise<HolderBalance[]>;
}
