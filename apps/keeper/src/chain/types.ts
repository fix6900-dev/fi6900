/**
 * Local, SDK-independent view of on-chain state (ARCHITECTURE.md section 2).
 * Only `chain/sdk.ts` knows about @fi6900/sdk; everything else codes against these.
 */
import type { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

export type AuctionStatus = 'open' | 'filled' | 'cancelled' | 'expired';
export type AssetStatus = 'active' | 'removing';

export const PAUSE_MINT = 1;
export const PAUSE_REDEEM = 2;
export const PAUSE_AUCTIONS = 4;

/** PendingAction.kind (mirrors the program's ACTION_* constants / SDK ActionKind). */
export enum ActionKind {
  SetFees = 0,
  SetTargetWeight = 1,
  SetRebalancer = 2,
  SetFeeRecipient = 3,
  RefPriceOverride = 4,
  SetMaxAuctionDiscount = 5,
  SetTimelock = 6,
  AddAsset = 7,
  BeginRemoveAsset = 8,
  SetRefMovePolicy = 9,
  /** key = sha256 commitment to (name, symbol, uri); executed by `set_token_metadata` */
  SetTokenMetadata = 10,
}

export const ACTION_KIND_NAMES: Record<number, string> = {
  0: 'set_fees',
  1: 'set_target_weight',
  2: 'set_rebalancer',
  3: 'set_fee_recipient',
  4: 'ref_price_override',
  5: 'set_max_auction_discount',
  6: 'set_timelock',
  7: 'add_asset',
  8: 'begin_remove_asset',
  9: 'set_ref_move_policy',
  10: 'set_token_metadata',
};

export interface FundState {
  pda: string;
  authority: string;
  pendingAuthority: string;
  rebalancer: string;
  feeRecipient: string;
  indexMint: string;
  bump: number;
  assetCount: number;
  /** 512-bit bitmap */
  activeBitmap: bigint;
  mintFeeBps: number;
  redeemFeeBps: number;
  mgmtFeeBps: number;
  lastFeeAccrualTs: number;
  epoch: bigint;
  openAuctions: number;
  paused: number;
  auctionNonce: bigint;
  maxAuctionDiscountBps: number;
  maxRefMoveBps: number;
  refMovePeriodSlots: bigint;
  timelockSlots: bigint;
  actionNonce: bigint;
}

export interface AssetState {
  pda: string;
  fund: string;
  mint: string;
  vault: string;
  tokenProgram: string;
  index: number;
  status: AssetStatus;
  decimals: number;
  targetWeightBps: number;
  pendingDeposits: bigint;
  pendingWithdrawals: bigint;
  /** Raw vault token-account amount (read alongside the Asset account). */
  vaultAmount: bigint;
  /** Q64.64 nano-USD per raw unit; 0n = unset (asset cannot be auctioned). */
  refPrice: bigint;
  refPriceUpdatedSlot: bigint;
  refPriceAnchor: bigint;
  refPriceAnchorSlot: bigint;
}

export function effectiveBalance(a: AssetState): bigint {
  const eff = a.vaultAmount - a.pendingDeposits - a.pendingWithdrawals;
  return eff < 0n ? 0n : eff;
}

export interface AuctionState {
  pda: string;
  fund: string;
  sellAsset: string;
  buyAsset: string;
  sellMint: string;
  buyMint: string;
  sellRemaining: bigint;
  sellTotal: bigint;
  /** Q64.64 buy_token per sell_token (raw units). */
  startPrice: bigint;
  endPrice: bigint;
  startSlot: bigint;
  endSlot: bigint;
  boughtTotal: bigint;
  status: AuctionStatus;
  nonce: bigint;
}

export interface AuctionFillEvent {
  sig: string;
  auctionPda: string;
  filler: string;
  sellAmount: bigint;
  buyAmount: bigint;
  price: bigint;
  slot: number;
}

export interface StartAuctionParams {
  sellMint: PublicKey;
  buyMint: PublicKey;
  sellAmount: bigint;
  startPrice: bigint;
  endPrice: bigint;
  durationSlots: number;
}

export interface StartAuctionResult {
  ixs: TransactionInstruction[];
  /** PDA the auction will live at (derived from fund.auction_nonce at build time). */
  auctionPda: string;
  nonce: bigint;
}

export interface LookupTableCreation {
  address: PublicKey;
  /** Every table (one per 256 addresses). */
  addresses: number;
  lookupTables: PublicKey[];
  /** Instructions grouped per transaction, in order (create+extend, then extends). */
  instructionGroups: TransactionInstruction[][];
}

/** Payload of a timelocked admin action. */
export interface ActionPayload {
  kind: ActionKind;
  /** base58 pubkey (mint / new rebalancer / new fee recipient) or the default pubkey */
  key: string;
  values: [bigint, bigint, bigint, bigint];
}

export interface PendingActionState {
  pda: string;
  fund: string;
  nonce: bigint;
  kind: ActionKind;
  kindName: string;
  proposer: string;
  queuedSlot: bigint;
  etaSlot: bigint;
  key: string;
  values: [bigint, bigint, bigint, bigint];
}

export interface QueueActionResult {
  ixs: TransactionInstruction[];
  actionPda: string;
  nonce: bigint;
}

export interface ProgramUpgradeInfo {
  programId: string;
  programDataAddress: string | null;
  /** null when burned (or the program is not an upgradeable-loader program). */
  upgradeAuthority: string | null;
}

/** The surface the keeper needs from the on-chain program SDK. */
export interface ChainClient {
  readonly programId: string;
  readonly indexMint: PublicKey;
  readonly fundPda: PublicKey;

  readFund(): Promise<FundState>;
  readAssets(): Promise<AssetState[]>;
  readAuctions(status?: 'open' | 'all'): Promise<AuctionState[]>;
  getAuctionFills(auctionPda: string, limit?: number): Promise<AuctionFillEvent[]>;
  getIndexSupply(): Promise<bigint>;
  getLookupTable(): Promise<string | null>;
  getCurrentSlot(): Promise<bigint>;
  getProgramUpgradeInfo(): Promise<ProgramUpgradeInfo>;

  /** Ordered transactions for in-kind creation/redemption (unsigned, owner = payer). */
  buildMintTxs(units: bigint, owner: PublicKey, opts?: { nonce?: bigint }): Promise<VersionedTransaction[]>;
  buildRedeemTxs(units: bigint, owner: PublicKey, opts?: { nonce?: bigint }): Promise<VersionedTransaction[]>;

  startAuction(p: StartAuctionParams, rebalancer: PublicKey): Promise<StartAuctionResult>;
  /**
   * `grossBuyAmount` is what the filler sends; the program credits what the buy vault receives and requires
   * it to be >= the price-implied buy amount. Omit it for ordinary buy tokens; for a Token-2022 fee mint pass
   * `await fillGrossFor(buyMint, buyAmount)`.
   */
  fillAuctionIx(auctionPda: PublicKey, sellAmount: bigint, filler: PublicKey, grossBuyAmount?: bigint | null): Promise<TransactionInstruction[]>;
  /** Gross amount to send so a vault of `mint` receives `net` (== net unless the mint has a Token-2022 transfer fee). */
  fillGrossFor(mint: PublicKey, net: bigint): Promise<bigint>;
  cancelAuctionIx(auctionPda: PublicKey, signer: PublicKey): Promise<TransactionInstruction[]>;
  accrueManagementFeeIx(payer: PublicKey): Promise<TransactionInstruction[]>;

  // governance: reference prices + timelock
  setRefPriceIx(mint: PublicKey, refPriceQ64: bigint, signer: PublicKey): Promise<TransactionInstruction[]>;
  readPendingActions(): Promise<PendingActionState[]>;
  queueActionIx(payload: ActionPayload, authority: PublicKey): Promise<QueueActionResult>;
  executeActionIx(actionPda: PublicKey, executor: PublicKey): Promise<TransactionInstruction[]>;
  cancelActionIx(actionPda: PublicKey, authority: PublicKey): Promise<TransactionInstruction[]>;

  // admin / launch (direct ixs; only valid while fund.timelock_slots == 0)
  initializeFundIx(
    authority: PublicKey,
    fees: { mintFeeBps: number; redeemFeeBps: number; mgmtFeeBps: number },
    timelockSlots?: bigint,
  ): Promise<TransactionInstruction[]>;
  addAssetIx(mint: PublicKey, targetWeightBps: number, authority: PublicKey): Promise<TransactionInstruction[]>;
  setTargetWeightIx(mint: PublicKey, bps: number, authority: PublicKey): Promise<TransactionInstruction[]>;
  beginRemoveAssetIx(mint: PublicKey, authority: PublicKey): Promise<TransactionInstruction[]>;
  bootstrapMintIx(units: bigint, authority: PublicKey): Promise<TransactionInstruction[]>;
  createFundLookupTable(payer: PublicKey): Promise<LookupTableCreation>;

  // token metadata (Metaplex) of the index mint
  readTokenMetadata(): Promise<TokenMetadataState | null>;
  /** Direct while timelock == 0; with the timelock armed pass the due SetTokenMetadata action PDA. */
  setTokenMetadataIx(args: { name: string; symbol: string; uri: string }, authority: PublicKey, actionPda?: PublicKey | null): Promise<TransactionInstruction[]>;
  /** Plain mpl `UpdateMetadataAccountV2` handing existing metadata to the fund PDA, signed by its current update authority. */
  transferTokenMetadataAuthorityIx(currentUpdateAuthority: PublicKey): TransactionInstruction[];
  /** `key` for a queued SetTokenMetadata action (sha256 commitment to the payload). */
  tokenMetadataHash(args: { name: string; symbol: string; uri: string }): Promise<string>;
}

export interface TokenMetadataState {
  address: string;
  updateAuthority: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  isMutable: boolean;
}

export interface MintInfo {
  mint: string;
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  tokenProgram: string;
  /** Token-2022 TransferFeeConfig basis points (newer fee); 0 when absent. */
  transferFeeBps: number;
  /** Token-2022 TransferFeeConfig maximum fee in raw units (newer fee); 0n when absent. */
  transferFeeMaxFee: bigint;
  /** Token-2022 TransferHook program id; null when absent or unset. */
  transferHookProgram: string | null;
}
