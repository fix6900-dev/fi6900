/** Inputs/outputs of the pure methodology engine. */

export interface CandidateToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  fdvUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  /** 7-day average daily volume; null when fewer observations exist. */
  avgVolume7dUsd: number | null;
  /** Unix ms of first trade / pair creation; null if unknown. */
  firstTradeAt: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** Token-2022 transfer fee in bps (0 = none / plain SPL); undefined when the mint was not read. */
  transferFeeBps?: number;
  /** Token-2022 transfer hook program; null/undefined when none. */
  transferHookProgram?: string | null;
  /** Price impact (bps) of a sell of `eligibility.impactQuoteUsd`; null if quote unavailable. */
  sellImpactBps: number | null;
  tags: readonly string[];
  /** CoinGecko category rank (1 = largest market cap in "Solana Meme Coins"); null when not a member / jupiter universe. */
  cgRank?: number | null;
  /** CoinGecko coin id (e.g. `dogwifcoin`). */
  cgId?: string | null;
  /** Which universe source nominated the candidate ('incumbent' = on-chain constituent not in the universe). */
  source?: 'coingecko' | 'jupiter' | 'merged' | 'incumbent';
}

export type IneligibilityReason =
  | 'mint_authority'
  | 'freeze_authority'
  | 'transfer_fee'
  | 'transfer_hook'
  | 'too_young'
  | 'age_unknown'
  | 'fdv_too_low'
  | 'volume_24h_too_low'
  | 'volume_7d_too_low'
  | 'price_impact_too_high'
  | 'price_impact_unknown'
  | 'denylisted'
  | 'excluded_symbol'
  | 'excluded_tag'
  | 'missing_tag'
  | 'no_price';

export interface EligibilityResult {
  mint: string;
  symbol: string;
  eligible: boolean;
  reasons: IneligibilityReason[];
  marketCapUsd: number;
  cgRank?: number | null;
  source?: CandidateToken['source'];
}

export interface RankedToken {
  mint: string;
  symbol: string;
  marketCapUsd: number;
  rank: number;
  cgRank?: number | null;
  source?: CandidateToken['source'];
}

export interface SelectionResult {
  selected: RankedToken[];
  added: string[];
  removed: string[];
  /** Incumbents kept only because of the buffer rule (rank > targetCount but <= bufferRank). */
  bufferKept: string[];
}

export interface TargetWeight {
  mint: string;
  symbol: string;
  weightBps: number;
}

export interface MethodologyRunResult {
  ts: string;
  configVersion: string;
  /** Universe definition the run used. */
  universe?: { source: 'coingecko' | 'jupiter' | 'merged'; coingeckoCategory: string; maxCandidates: number };
  eligible: EligibilityResult[];
  selection: SelectionResult;
  weights: TargetWeight[];
}
