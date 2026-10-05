import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, type GetProgramAccountsFilter } from "@solana/web3.js";
import BN from "bn.js";
import idl from "../idl/fi6900.json";
import { MAX_ASSETS, PROGRAM_ID } from "./constants.js";

const coder = new BorshAccountsCoder(idl as Idl);

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
/** The raw coder returns the IDL's snake_case field names; normalise to camelCase (non-recursive: no nested structs). */
function decode(name: string, data: Buffer): any {
  const raw = coder.decode(name, data) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[camel(k)] = v;
  return out;
}

const bnToBig = (v: BN | number | bigint): bigint => (typeof v === "bigint" ? v : BigInt(v.toString()));

/** `[u64; 8]` on-chain bitmap -> one 512-bit bigint (bit i = slot i). */
export function bitmapFromWords(words: readonly (BN | number | bigint)[]): bigint {
  let out = 0n;
  words.forEach((w, i) => {
    out |= bnToBig(w) << BigInt(64 * i);
  });
  return out;
}

/** 512-bit bigint -> `[u64; 8]` words (for building instruction args / tests). */
export function bitmapToWords(bitmap: bigint): bigint[] {
  const mask = (1n << 64n) - 1n;
  const out: bigint[] = [];
  for (let i = 0; i < 8; i++) out.push((bitmap >> BigInt(64 * i)) & mask);
  return out;
}

// ---------------------------------------------------------------------------
// Decoded account shapes (bigint everywhere instead of BN)
// ---------------------------------------------------------------------------

export interface FundAccount {
  address: PublicKey;
  authority: PublicKey;
  pendingAuthority: PublicKey;
  rebalancer: PublicKey;
  feeRecipient: PublicKey;
  indexMint: PublicKey;
  bump: number;
  assetCount: number;
  /** 512-bit bitmap */
  activeBitmap: bigint;
  mintFeeBps: number;
  redeemFeeBps: number;
  mgmtFeeBps: number;
  lastFeeAccrualTs: bigint;
  epoch: bigint;
  openAuctions: number;
  paused: number;
  auctionNonce: bigint;
  /** 512-bit bitmap */
  occupiedBitmap: bigint;
  maxAuctionDiscountBps: number;
  maxRefMoveBps: number;
  refMovePeriodSlots: bigint;
  timelockSlots: bigint;
  actionNonce: bigint;
}

export interface AssetAccount {
  address: PublicKey;
  fund: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  tokenProgram: PublicKey;
  index: number;
  status: number;
  decimals: number;
  targetWeightBps: number;
  pendingDeposits: bigint;
  pendingWithdrawals: bigint;
  bump: number;
  /** Q64.64 numeraire per raw base unit; 0n = unset */
  refPrice: bigint;
  refPriceUpdatedSlot: bigint;
  refPriceAnchor: bigint;
  refPriceAnchorSlot: bigint;
}

export interface MintSessionAccount {
  address: PublicKey;
  fund: PublicKey;
  owner: PublicKey;
  nonce: bigint;
  units: bigint;
  epoch: bigint;
  createdSlot: bigint;
  /** next active slot the begin chunks will process */
  nextSlot: number;
  /** every active slot computed; deposits/finalize allowed */
  ready: boolean;
  depositedBitmap: bigint;
  required: bigint[];
}

export interface RedeemSessionAccount {
  address: PublicKey;
  fund: PublicKey;
  owner: PublicKey;
  nonce: bigint;
  units: bigint;
  createdSlot: bigint;
  nextSlot: number;
  ready: boolean;
  withdrawnBitmap: bigint;
  entitled: bigint[];
}

export interface AuctionAccount {
  address: PublicKey;
  fund: PublicKey;
  sellAsset: PublicKey;
  buyAsset: PublicKey;
  sellRemaining: bigint;
  sellTotal: bigint;
  startPrice: bigint;
  endPrice: bigint;
  startSlot: bigint;
  endSlot: bigint;
  boughtTotal: bigint;
  status: number;
  nonce: bigint;
}

export interface PendingActionAccount {
  address: PublicKey;
  fund: PublicKey;
  nonce: bigint;
  kind: number;
  proposer: PublicKey;
  queuedSlot: bigint;
  etaSlot: bigint;
  key: PublicKey;
  values: [bigint, bigint, bigint, bigint];
  bump: number;
}

// ---------------------------------------------------------------------------
// Decoders (raw bytes -> typed)
// ---------------------------------------------------------------------------

export function decodeFund(address: PublicKey, data: Buffer): FundAccount {
  const d = decode("Fund", data);
  return {
    address,
    authority: d.authority,
    pendingAuthority: d.pendingAuthority,
    rebalancer: d.rebalancer,
    feeRecipient: d.feeRecipient,
    indexMint: d.indexMint,
    bump: d.bump,
    assetCount: d.assetCount,
    activeBitmap: bitmapFromWords(d.activeBitmap as BN[]),
    mintFeeBps: d.mintFeeBps,
    redeemFeeBps: d.redeemFeeBps,
    mgmtFeeBps: d.mgmtFeeBps,
    lastFeeAccrualTs: bnToBig(d.lastFeeAccrualTs),
    epoch: bnToBig(d.epoch),
    openAuctions: d.openAuctions,
    paused: d.paused,
    auctionNonce: bnToBig(d.auctionNonce),
    occupiedBitmap: bitmapFromWords(d.occupiedBitmap as BN[]),
    maxAuctionDiscountBps: d.maxAuctionDiscountBps,
    maxRefMoveBps: d.maxRefMoveBps,
    refMovePeriodSlots: bnToBig(d.refMovePeriodSlots),
    timelockSlots: bnToBig(d.timelockSlots),
    actionNonce: bnToBig(d.actionNonce),
  };
}

export function decodeAsset(address: PublicKey, data: Buffer): AssetAccount {
  const d = decode("Asset", data);
  return {
    address,
    fund: d.fund,
    mint: d.mint,
    vault: d.vault,
    tokenProgram: d.tokenProgram,
    index: d.index,
    status: d.status,
    decimals: d.decimals,
    targetWeightBps: d.targetWeightBps,
    pendingDeposits: bnToBig(d.pendingDeposits),
    pendingWithdrawals: bnToBig(d.pendingWithdrawals),
    bump: d.bump,
    refPrice: bnToBig(d.refPrice),
    refPriceUpdatedSlot: bnToBig(d.refPriceUpdatedSlot),
    refPriceAnchor: bnToBig(d.refPriceAnchor),
    refPriceAnchorSlot: bnToBig(d.refPriceAnchorSlot),
  };
}

export function decodeMintSession(address: PublicKey, data: Buffer): MintSessionAccount {
  const d = decode("MintSession", data);
  return {
    address,
    fund: d.fund,
    owner: d.owner,
    nonce: bnToBig(d.nonce),
    units: bnToBig(d.units),
    epoch: bnToBig(d.epoch),
    createdSlot: bnToBig(d.createdSlot),
    nextSlot: Number(d.nextSlot),
    ready: Number(d.ready) === 1,
    depositedBitmap: bitmapFromWords(d.depositedBitmap as BN[]),
    required: (d.required as BN[]).map(bnToBig),
  };
}

export function decodeRedeemSession(address: PublicKey, data: Buffer): RedeemSessionAccount {
  const d = decode("RedeemSession", data);
  return {
    address,
    fund: d.fund,
    owner: d.owner,
    nonce: bnToBig(d.nonce),
    units: bnToBig(d.units),
    createdSlot: bnToBig(d.createdSlot),
    nextSlot: Number(d.nextSlot),
    ready: Number(d.ready) === 1,
    withdrawnBitmap: bitmapFromWords(d.withdrawnBitmap as BN[]),
    entitled: (d.entitled as BN[]).map(bnToBig),
  };
}

export function decodeAuction(address: PublicKey, data: Buffer): AuctionAccount {
  const d = decode("Auction", data);
  return {
    address,
    fund: d.fund,
    sellAsset: d.sellAsset,
    buyAsset: d.buyAsset,
    sellRemaining: bnToBig(d.sellRemaining),
    sellTotal: bnToBig(d.sellTotal),
    startPrice: bnToBig(d.startPrice),
    endPrice: bnToBig(d.endPrice),
    startSlot: bnToBig(d.startSlot),
    endSlot: bnToBig(d.endSlot),
    boughtTotal: bnToBig(d.boughtTotal),
    status: d.status,
    nonce: bnToBig(d.nonce),
  };
}

export function decodePendingAction(address: PublicKey, data: Buffer): PendingActionAccount {
  const d = decode("PendingAction", data);
  const values = (d.values as BN[]).map(bnToBig);
  return {
    address,
    fund: d.fund,
    nonce: bnToBig(d.nonce),
    kind: d.kind,
    proposer: d.proposer,
    queuedSlot: bnToBig(d.queuedSlot),
    etaSlot: bnToBig(d.etaSlot),
    key: d.key,
    values: [values[0] ?? 0n, values[1] ?? 0n, values[2] ?? 0n, values[3] ?? 0n],
    bump: d.bump,
  };
}

/** The Q64.64 ref price carried by a RefPriceOverride action (values[0] = lo, values[1] = hi). */
export function actionRefPrice(a: Pick<PendingActionAccount, "values">): bigint {
  return a.values[0] | (a.values[1] << 64n);
}

// ---------------------------------------------------------------------------
// Readers (RPC)
// ---------------------------------------------------------------------------

export async function readFund(connection: Connection, fund: PublicKey): Promise<FundAccount> {
  const info = await connection.getAccountInfo(fund);
  if (!info) throw new Error(`Fund ${fund.toBase58()} not found`);
  return decodeFund(fund, info.data);
}

export async function readFundNullable(connection: Connection, fund: PublicKey): Promise<FundAccount | null> {
  const info = await connection.getAccountInfo(fund);
  return info ? decodeFund(fund, info.data) : null;
}

function discriminatorFilter(name: string): GetProgramAccountsFilter {
  const disc = coder.accountDiscriminator(name);
  return { memcmp: { offset: 0, bytes: bs58Encode(disc) } };
}

function fundFilter(fund: PublicKey): GetProgramAccountsFilter {
  return { memcmp: { offset: 8, bytes: fund.toBase58() } };
}

/** All Asset accounts for a fund, sorted by slot index. Includes Removing assets. */
export async function readAssets(
  connection: Connection,
  fund: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<AssetAccount[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [discriminatorFilter("Asset"), fundFilter(fund)],
  });
  return accounts.map((a) => decodeAsset(a.pubkey, a.account.data)).sort((a, b) => a.index - b.index);
}

/** Only Active assets (participate in mint/redeem), sorted by slot. */
export async function readActiveAssets(
  connection: Connection,
  fund: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<AssetAccount[]> {
  const fundAcc = await readFund(connection, fund);
  const all = await readAssets(connection, fund, programId);
  return all.filter((a) => (fundAcc.activeBitmap >> BigInt(a.index)) & 1n);
}

export async function readAsset(connection: Connection, asset: PublicKey): Promise<AssetAccount> {
  const info = await connection.getAccountInfo(asset);
  if (!info) throw new Error(`Asset ${asset.toBase58()} not found`);
  return decodeAsset(asset, info.data);
}

/** Auctions for a fund; optionally filtered by status (0 open, 1 filled, 2 cancelled, 3 expired). */
export async function readAuctions(
  connection: Connection,
  fund: PublicKey,
  status?: number,
  programId: PublicKey = PROGRAM_ID,
): Promise<AuctionAccount[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [discriminatorFilter("Auction"), fundFilter(fund)],
  });
  let out = accounts.map((a) => decodeAuction(a.pubkey, a.account.data));
  if (status !== undefined) out = out.filter((a) => a.status === status);
  return out.sort((a, b) => Number(a.nonce - b.nonce));
}

export async function readAuction(connection: Connection, auction: PublicKey): Promise<AuctionAccount> {
  const info = await connection.getAccountInfo(auction);
  if (!info) throw new Error(`Auction ${auction.toBase58()} not found`);
  return decodeAuction(auction, info.data);
}

export async function readMintSession(
  connection: Connection,
  session: PublicKey,
): Promise<MintSessionAccount | null> {
  const info = await connection.getAccountInfo(session);
  return info ? decodeMintSession(session, info.data) : null;
}

export async function readRedeemSession(
  connection: Connection,
  session: PublicKey,
): Promise<RedeemSessionAccount | null> {
  const info = await connection.getAccountInfo(session);
  return info ? decodeRedeemSession(session, info.data) : null;
}

/** All open mint sessions for an owner (or every owner when omitted). */
export async function readMintSessions(
  connection: Connection,
  fund: PublicKey,
  owner?: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<MintSessionAccount[]> {
  const filters: GetProgramAccountsFilter[] = [discriminatorFilter("MintSession"), fundFilter(fund)];
  if (owner) filters.push({ memcmp: { offset: 40, bytes: owner.toBase58() } });
  const accounts = await connection.getProgramAccounts(programId, { filters });
  return accounts.map((a) => decodeMintSession(a.pubkey, a.account.data));
}

export async function readRedeemSessions(
  connection: Connection,
  fund: PublicKey,
  owner?: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<RedeemSessionAccount[]> {
  const filters: GetProgramAccountsFilter[] = [discriminatorFilter("RedeemSession"), fundFilter(fund)];
  if (owner) filters.push({ memcmp: { offset: 40, bytes: owner.toBase58() } });
  const accounts = await connection.getProgramAccounts(programId, { filters });
  return accounts.map((a) => decodeRedeemSession(a.pubkey, a.account.data));
}

/** Every queued (not yet executed/cancelled) PendingAction of a fund, by nonce. */
export async function readPendingActions(
  connection: Connection,
  fund: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<PendingActionAccount[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [discriminatorFilter("PendingAction"), fundFilter(fund)],
  });
  return accounts.map((a) => decodePendingAction(a.pubkey, a.account.data)).sort((a, b) => Number(a.nonce - b.nonce));
}

export async function readPendingAction(connection: Connection, action: PublicKey): Promise<PendingActionAccount | null> {
  const info = await connection.getAccountInfo(action);
  return info ? decodePendingAction(action, info.data) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slots set in a (512-bit) bitmap, ascending. */
export function bitmapSlots(bitmap: bigint, max = MAX_ASSETS): number[] {
  const out: number[] = [];
  for (let i = 0; i < max; i++) if ((bitmap >> BigInt(i)) & 1n) out.push(i);
  return out;
}

// Minimal base58 (avoid pulling in bs58 just for discriminators).
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes: Uint8Array | Buffer): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = "1" + s;
    else break;
  }
  return s;
}
