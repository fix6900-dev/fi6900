/** Wire shapes for the keeper API (ARCHITECTURE.md section 5). The web app codes against these. */

export interface ApiOk<T> {
  ok: true;
  data: T;
  asOf: string;
  /** Present on paginated endpoints. */
  nextCursor?: string | null;
}

export interface ApiErr {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface FundDto {
  indexMint: string;
  fundPda: string;
  /** raw u64 as decimal string (6 decimals) */
  supply: string;
  navUsd: number;
  navPerUnitUsd: number;
  indexLevel: number;
  marketPriceUsd: number | null;
  premiumBps: number | null;
  fees: { mintBps: number; redeemBps: number; mgmtBps: number };
  assetCount: number;
  epoch: string;
  openAuctions: number;
  /** bit0 mint, bit1 redeem, bit2 auctions */
  paused: number;
}

export interface HoldingDto {
  slot: number;
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  balance: string;
  balanceUi: number;
  priceUsd: number;
  valueUsd: number;
  weightBps: number;
  targetWeightBps: number;
  driftBps: number;
  change24hPct: number;
  marketCapUsd: number;
  status: 'active' | 'removing';
  vault: string;
  verifyUrl: string;
}

export interface HistoryPointDto {
  t: string;
  navPerUnitUsd: number;
  indexLevel: number;
  marketPriceUsd: number | null;
  supply: string;
}

export interface AuctionFillDto {
  sig: string;
  filler: string;
  sellAmount: string;
  buyAmount: string;
  /** Q64.64 as decimal string */
  price: string;
  slot: number;
}

export interface AuctionDto {
  pda: string;
  sellMint: string;
  buyMint: string;
  sellSymbol: string;
  buySymbol: string;
  sellDecimals: number;
  buyDecimals: number;
  sellRemaining: string;
  sellTotal: string;
  /** Q64.64 raw as decimal strings */
  startPrice: string;
  endPrice: string;
  currentPrice: string;
  /** Same prices as buy-token per sell-token in UI units (for charts) */
  startPriceUi: number;
  endPriceUi: number;
  currentPriceUi: number;
  startSlot: string;
  endSlot: string;
  currentSlot: string;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  fills: AuctionFillDto[];
}

export interface FlywheelDto {
  coinMint: string;
  creatorFeesClaimedSol: number;
  /** Creator fees accrued but not yet claimed (pump bonding-curve vault + PumpSwap vault), read live from chain. null when the dev wallet is unknown or the read failed. */
  creatorFeesUnclaimedSol?: number | null;
  creatorFeesUnclaimed?: { bondingCurveSol: number; pumpSwapSol: number } | null;
  lpAddedSol: number;
  airdroppedUnits: number;
  airdropRounds: number;
  buybackSol: number;
  burnedCoin: number;
  treasurySol: number;
  /** Keeper arbitrage profit vs NAV (SOL) from AP create/redeem/inventory trades; accrues to the treasury wallet. */
  arbProfitSol: number;
  arbTrades: number;
  next: {
    airdropAt: string | null;
    /** next drift check (every REBALANCE_CHECK_SEC) */
    rebalanceCheckAt: string | null;
    /** next weekly scheduled rebalance (methodology/schedule.ts nextScheduledRebalance) */
    scheduledRebalanceAt: string | null;
  };
}

export type FlywheelEventKind =
  | 'claim'
  | 'buy_index'
  | 'add_lp'
  | 'airdrop'
  | 'buyback'
  | 'burn'
  | 'create'
  | 'redeem'
  | 'auction_start'
  | 'auction_fill'
  | 'fee_accrual'
  | 'treasury'
  | 'governance';

export interface FlywheelEventDto {
  id: number;
  kind: FlywheelEventKind;
  ts: string;
  sig: string;
  amounts: Record<string, unknown>;
  note: string | null;
}

export interface AirdropDto {
  roundId: number;
  ts: string;
  units: string;
  sig: string;
}

export interface MethodologyDto {
  config: unknown;
  lastRun: { ts: string; eligible: unknown[]; selected: unknown[]; weights: unknown[] } | null;
  nextReconstitution: string;
}

export interface AnnouncementDto {
  ts: string;
  title: string;
  body: string;
}

export interface VerifyDto {
  fundPda: string;
  indexMint: string;
  mintAuthority: string | null;
  vaults: { mint: string; vault: string; owner: string; amount: string }[];
  lookupTable: string | null;
  programId: string;
  idlHash: string | null;
  /** BPF upgradeable loader ProgramData account of the program */
  programDataAddress: string | null;
  /** null once the upgrade authority is burned */
  upgradeAuthority: string | null;
}

export interface PendingActionDto {
  pda: string;
  nonce: string;
  kind: number;
  kindName: string;
  payload: Record<string, unknown>;
  etaSlot: string;
  queuedSlot: string;
  proposer: string;
  queuedSig: string | null;
  due: boolean;
}

export interface GovernanceDto {
  timelockSlots: string;
  pending: PendingActionDto[];
  upgradeAuthority: string | null;
  programDataAddress: string | null;
  fundAuthority: string;
  pendingAuthority: string | null;
  rebalancer: string;
  feeRecipient: string;
  maxAuctionDiscountBps: number;
  maxRefMoveBps: number;
  refMovePeriodSlots: string;
  reconstitutionMode: 'manual' | 'auto';
  currentSlot: string;
}

export interface ProposalDto {
  id: number;
  mint: string;
  symbol: string | null;
  action: 'add' | 'remove';
  reason: Record<string, unknown>;
  status: 'proposed' | 'approved' | 'rejected' | 'queued' | 'executed';
  weightBps: number | null;
  proposedTs: string;
  decidedTs: string | null;
  queuedTs: string | null;
  executedTs: string | null;
  actionPda: string | null;
  queuedSig: string | null;
  note: string | null;
}

/** Admin (ADMIN_TOKEN-protected) mutations; absent in mock mode. */
export interface AdminActions {
  approveProposal(mint: string, opts: { weightBps?: number; immediate?: boolean }): Promise<{ proposal: ProposalDto; queued: unknown }>;
  rejectProposal(mint: string, note?: string): Promise<ProposalDto>;
  addAsset(mint: string, opts: { weightBps?: number; immediate?: boolean; force?: boolean }): Promise<{ proposal: ProposalDto; queued: unknown }>;
  removeAsset(mint: string, opts: { immediate?: boolean }): Promise<{ proposal: ProposalDto; queued: unknown }>;
}

export interface QuoteCreateDto {
  basket: { mint: string; amount: string }[];
  estCostSol: number;
  estNavUsd: number;
}

export interface QuoteRedeemDto {
  basket: { mint: string; amount: string }[];
  estValueUsd: number;
}

export type HistoryRange = '1d' | '7d' | '30d' | 'all';

/** What the HTTP layer needs; implemented by the live keeper and by the mock. */
export interface KeeperDataProvider {
  readonly mode: 'live' | 'mock';
  fund(): Promise<FundDto>;
  holdings(): Promise<HoldingDto[]>;
  history(range: HistoryRange): Promise<HistoryPointDto[]>;
  auctions(status: 'open' | 'all'): Promise<AuctionDto[]>;
  flywheel(): Promise<FlywheelDto>;
  flywheelEvents(limit: number, cursor?: number): Promise<{ items: FlywheelEventDto[]; nextCursor: string | null }>;
  airdrops(wallet: string): Promise<AirdropDto[]>;
  methodology(): Promise<MethodologyDto>;
  announcements(): Promise<AnnouncementDto[]>;
  verify(): Promise<VerifyDto>;
  governance(): Promise<GovernanceDto>;
  proposals(status?: string): Promise<ProposalDto[]>;
  readonly admin?: AdminActions;
  quoteCreate(units: bigint): Promise<QuoteCreateDto>;
  quoteRedeem(units: bigint): Promise<QuoteRedeemDto>;
  health(): Promise<Record<string, unknown>>;
}

export const solscan = {
  account: (a: string): string => `https://solscan.io/account/${a}`,
  tx: (s: string): string => `https://solscan.io/tx/${s}`,
  token: (m: string): string => `https://solscan.io/token/${m}`,
};
