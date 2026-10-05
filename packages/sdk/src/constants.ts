import { PublicKey } from "@solana/web3.js";
import idl from "../idl/fi6900.json";

/** On-chain program id (from the IDL). */
export const PROGRAM_ID = new PublicKey(idl.address);

/** Constituent slots per fund (bitmaps are `[u64; 8]` on-chain, one 512-bit bigint in the SDK). */
export const MAX_ASSETS = 512;
export const BITMAP_WORDS = 8;
export const INDEX_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000n;
export const SECONDS_PER_YEAR = 31_557_600n;

export const PAUSE_MINT = 1 << 0;
export const PAUSE_REDEEM = 1 << 1;
export const PAUSE_AUCTIONS = 1 << 2;

export enum AssetStatus {
  Active = 0,
  Removing = 1,
}

export enum AuctionStatus {
  Open = 0,
  Filled = 1,
  Cancelled = 2,
  Expired = 3,
}

/** PendingAction.kind (programs/fi6900/src/state.rs ACTION_*). */
export enum ActionKind {
  /** values = [mintFeeBps, redeemFeeBps, mgmtFeeBps, 0] */
  SetFees = 0,
  /** key = asset mint, values[0] = target weight bps */
  SetTargetWeight = 1,
  /** key = new rebalancer */
  SetRebalancer = 2,
  /** key = new fee recipient */
  SetFeeRecipient = 3,
  /** key = asset mint, values[0] = lo64, values[1] = hi64 of the Q64.64 ref price */
  RefPriceOverride = 4,
  /** values[0] = max_auction_discount_bps */
  SetMaxAuctionDiscount = 5,
  /** values[0] = timelock_slots */
  SetTimelock = 6,
  /** key = mint, values[0] = target weight bps */
  AddAsset = 7,
  /** key = asset mint */
  BeginRemoveAsset = 8,
  /** values[0] = max_ref_move_bps, values[1] = ref_move_period_slots */
  SetRefMovePolicy = 9,
  /** key = tokenMetadataHash(name, symbol, uri); executed by `set_token_metadata` (not execute_action) */
  SetTokenMetadata = 10,
}

export const ACTION_KIND_NAMES: Record<ActionKind, string> = {
  [ActionKind.SetFees]: "set_fees",
  [ActionKind.SetTargetWeight]: "set_target_weight",
  [ActionKind.SetRebalancer]: "set_rebalancer",
  [ActionKind.SetFeeRecipient]: "set_fee_recipient",
  [ActionKind.RefPriceOverride]: "ref_price_override",
  [ActionKind.SetMaxAuctionDiscount]: "set_max_auction_discount",
  [ActionKind.SetTimelock]: "set_timelock",
  [ActionKind.AddAsset]: "add_asset",
  [ActionKind.BeginRemoveAsset]: "begin_remove_asset",
  [ActionKind.SetRefMovePolicy]: "set_ref_move_policy",
  [ActionKind.SetTokenMetadata]: "set_token_metadata",
};

/** Metaplex token-metadata program (the index mint's metadata PDA lives under it). */
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
/** mpl-token-metadata DataV2 limits (bytes). */
export const METADATA_MAX_NAME_LENGTH = 32;
export const METADATA_MAX_SYMBOL_LENGTH = 10;
export const METADATA_MAX_URI_LENGTH = 200;

/** Governance defaults set by initialize_fund. */
export const DEFAULT_MAX_AUCTION_DISCOUNT_BPS = 500;
export const DEFAULT_MAX_REF_MOVE_BPS = 2000;
export const DEFAULT_REF_MOVE_PERIOD_SLOTS = 216_000n;
/** ~48h at 400ms slots; the mainnet value (docs/launch-runbook.md). */
export const MAINNET_TIMELOCK_SLOTS = 432_000n;

/**
 * Reference prices are Q64.64 "fund numeraire per raw base unit". Off-chain convention:
 * the numeraire is 1e-9 USD (nano-USD), which keeps every memecoin price well inside the
 * fixed-point range. Only ratios of ref prices are ever used on-chain.
 */
export const REF_PRICE_NUMERAIRE_USD = 1e-9;

export const SEEDS = {
  fund: Buffer.from("fund"),
  asset: Buffer.from("asset"),
  mintSession: Buffer.from("mint_session"),
  redeemSession: Buffer.from("redeem_session"),
  auction: Buffer.from("auction"),
  pending: Buffer.from("pending"),
  metadata: Buffer.from("metadata"),
} as const;

/**
 * `begin_mint` / `begin_redeem` take `[Asset, vault]` per active slot (2 accounts each). The
 * runtime locks at most 128 accounts per transaction and the first tx also carries the fee ATA,
 * accrue ix and programs, so chunks of 50 pairs (100 accounts) leave comfortable headroom.
 * A 40-asset fund therefore begins in ONE transaction; larger funds continue with
 * `begin_*_continue` chunks (hidden by buildMintTxs / buildRedeemTxs).
 */
export const BEGIN_PAIRS_PER_TX = 50;
/**
 * `finalize_mint` must release every active slot's pending deposits atomically (1 account per
 * asset), so in-kind CREATION is capped by the 128-lock limit at ~118 active assets. Redemption
 * has no such step (withdraws are per slot) and scales to all 512 slots.
 */
export const MAX_FINALIZE_ASSETS = 118;
export const DEPOSITS_PER_TX = 6;
/** Each withdraw is preceded by an idempotent ATA create (4 inner CPIs); 8 per tx stays under the 64-call trace limit. */
export const WITHDRAWS_PER_TX = 8;
/** Address lookup tables become usable one slot after they are extended. */
export const ALT_ADDRESSES_PER_EXTEND = 28;
/** Hard cap of one address lookup table. */
export const ALT_MAX_ADDRESSES = 256;
