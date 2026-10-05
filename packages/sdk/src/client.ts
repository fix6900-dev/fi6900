import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getEpochFee,
  getMint,
  getTransferFeeConfig,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
} from "@solana/web3.js";
import idl from "../idl/fi6900.json";
import {
  bitmapSlots,
  readActiveAssets,
  readAssets,
  readAuction,
  readAuctions,
  readFund,
  readMintSession,
  readPendingAction,
  readPendingActions,
  readRedeemSession,
  readTokenMetadata,
  type AssetAccount,
  type AuctionAccount,
  type FundAccount,
  type PendingActionAccount,
  type TokenMetadataAccount,
} from "./accounts.js";
import {
  ActionKind,
  BEGIN_PAIRS_PER_TX,
  DEPOSITS_PER_TX,
  METADATA_MAX_NAME_LENGTH,
  METADATA_MAX_SYMBOL_LENGTH,
  METADATA_MAX_URI_LENGTH,
  PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  WITHDRAWS_PER_TX,
} from "./constants.js";
import {
  createFundLookupTable,
  extendFundLookupTable,
  extendFundLookupTables,
  type LookupTableGrowth,
  type LookupTablePlan,
} from "./lookupTable.js";
import { grossForNet } from "./pricing.js";
import {
  assetPda,
  auctionPda,
  fundPda,
  mintSessionPda,
  pendingActionPda,
  randomNonce,
  redeemSessionPda,
  tokenMetadataPda,
  type NonceLike,
} from "./pda.js";
import type { Fi6900 } from "./types/fi6900.js";

export type Amount = bigint | number | BN;

const toBN = (v: Amount): BN => (BN.isBN(v) ? (v as BN) : new BN(v.toString()));

/** Read-only wallet so a Program can be constructed from a bare Connection. */
class NoopWallet implements Wallet {
  readonly payer = Keypair.generate();
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T>(tx: T): Promise<T> {
    return tx;
  }
  async signAllTransactions<T>(txs: T[]): Promise<T[]> {
    return txs;
  }
}

export interface Fi6900ClientOptions {
  /** Override the program id baked into the IDL. */
  programId?: PublicKey;
  /** Address lookup table created with `createFundLookupTable`. Used by buildMintTxs / buildRedeemTxs. */
  lookupTable?: PublicKey;
  /** Several tables (funds with > ~80 assets need more than one 256-entry table). */
  lookupTables?: PublicKey[];
  /** Compute-unit limit requested on multi-asset transactions. Default 1_000_000. */
  computeUnitLimit?: number;
  /** `[Asset, vault]` pairs per begin_* transaction. Default BEGIN_PAIRS_PER_TX (50). */
  beginPairsPerTx?: number;
}

export interface BuildTxOptions {
  nonce?: NonceLike;
  lookupTable?: PublicKey;
  lookupTables?: PublicKey[];
  /** Skip the accrue_management_fee prelude. */
  skipAccrue?: boolean;
  /** Fee payer for the transactions (defaults to owner). */
  payer?: PublicKey;
}

/** Active Token-2022 transfer fee of a mint (null = no TransferFeeConfig or zero fee). */
export interface TransferFeeInfo {
  feeBps: number;
  maxFee: bigint;
}

/** Metaplex `DataV2` subset the index mint carries (`set_token_metadata`). */
export interface TokenMetadataArgs {
  /** <= 32 bytes */
  name: string;
  /** <= 10 bytes */
  symbol: string;
  /** <= 200 bytes; the off-chain JSON (image, description, ...) */
  uri: string;
}

const utf8 = new TextEncoder();

function assertTokenMetadataArgs(m: TokenMetadataArgs): void {
  const n = utf8.encode(m.name).length;
  const s = utf8.encode(m.symbol).length;
  const u = utf8.encode(m.uri).length;
  if (n === 0 || n > METADATA_MAX_NAME_LENGTH) throw new Error(`metadata name must be 1..${METADATA_MAX_NAME_LENGTH} bytes`);
  if (s === 0 || s > METADATA_MAX_SYMBOL_LENGTH) throw new Error(`metadata symbol must be 1..${METADATA_MAX_SYMBOL_LENGTH} bytes`);
  if (u > METADATA_MAX_URI_LENGTH) throw new Error(`metadata uri must be <= ${METADATA_MAX_URI_LENGTH} bytes`);
}

/**
 * Payload commitment for `ActionKind.SetTokenMetadata`: sha256 over name, symbol and uri, each
 * prefixed with its u32-LE byte length (programs/fi6900 `token_metadata_hash`). Uses Web Crypto,
 * so it is async and works in browsers and Node >= 19.
 */
export async function tokenMetadataHash(m: TokenMetadataArgs): Promise<PublicKey> {
  const parts = [m.name, m.symbol, m.uri].flatMap((v) => {
    const bytes = utf8.encode(v);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    return [len, bytes];
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return new PublicKey(new Uint8Array(digest));
}

/** Payload of a timelocked admin action (`queue_action(kind, key, values)`). */
export interface ActionPayload {
  kind: ActionKind;
  key: PublicKey;
  values: [bigint, bigint, bigint, bigint];
}

const V0 = (a: bigint | number, b: bigint | number = 0n, c: bigint | number = 0n, d: bigint | number = 0n): [bigint, bigint, bigint, bigint] => [
  BigInt(a),
  BigInt(b),
  BigInt(c),
  BigInt(d),
];

/** Builders for every PendingAction kind. */
export const ActionPayloads = {
  setFees: (mintFeeBps: number, redeemFeeBps: number, mgmtFeeBps: number): ActionPayload => ({
    kind: ActionKind.SetFees,
    key: PublicKey.default,
    values: V0(mintFeeBps, redeemFeeBps, mgmtFeeBps),
  }),
  setTargetWeight: (mint: PublicKey, bps: number): ActionPayload => ({ kind: ActionKind.SetTargetWeight, key: mint, values: V0(bps) }),
  setRebalancer: (rebalancer: PublicKey): ActionPayload => ({ kind: ActionKind.SetRebalancer, key: rebalancer, values: V0(0) }),
  setFeeRecipient: (recipient: PublicKey): ActionPayload => ({ kind: ActionKind.SetFeeRecipient, key: recipient, values: V0(0) }),
  refPriceOverride: (mint: PublicKey, refPriceQ64: bigint): ActionPayload => ({
    kind: ActionKind.RefPriceOverride,
    key: mint,
    values: V0(refPriceQ64 & ((1n << 64n) - 1n), refPriceQ64 >> 64n),
  }),
  setMaxAuctionDiscount: (bps: number): ActionPayload => ({ kind: ActionKind.SetMaxAuctionDiscount, key: PublicKey.default, values: V0(bps) }),
  setTimelock: (slots: bigint | number): ActionPayload => ({ kind: ActionKind.SetTimelock, key: PublicKey.default, values: V0(slots) }),
  addAsset: (mint: PublicKey, targetWeightBps: number): ActionPayload => ({ kind: ActionKind.AddAsset, key: mint, values: V0(targetWeightBps) }),
  beginRemoveAsset: (mint: PublicKey): ActionPayload => ({ kind: ActionKind.BeginRemoveAsset, key: mint, values: V0(0) }),
  setRefMovePolicy: (maxRefMoveBps: number, periodSlots: bigint | number): ActionPayload => ({
    kind: ActionKind.SetRefMovePolicy,
    key: PublicKey.default,
    values: V0(maxRefMoveBps, periodSlots),
  }),
  /** `key` = `await tokenMetadataHash(args)`; executed with `setTokenMetadataIx(authority, args, action)`. */
  setTokenMetadata: (payloadHash: PublicKey): ActionPayload => ({ kind: ActionKind.SetTokenMetadata, key: payloadHash, values: V0(0) }),
};

/**
 * High-level client for the FI6900 program. Every `*Ix` method returns a
 * `TransactionInstruction` (or an array) without sending anything, so callers
 * can compose and sign however they like (wallet-adapter, keypair, multisig).
 */
export class Fi6900Client {
  readonly connection: Connection;
  readonly program: Program<Fi6900>;
  readonly programId: PublicKey;
  readonly indexMint: PublicKey;
  readonly fund: PublicKey;
  readonly fundBump: number;
  lookupTables: PublicKey[];
  computeUnitLimit: number;
  beginPairsPerTx: number;

  constructor(connection: Connection, indexMint: PublicKey, opts: Fi6900ClientOptions = {}) {
    this.connection = connection;
    this.programId = opts.programId ?? PROGRAM_ID;
    const idlWithAddress = { ...(idl as Idl), address: this.programId.toBase58() } as unknown as Fi6900;
    const provider = new AnchorProvider(connection, new NoopWallet(), { commitment: connection.commitment ?? "confirmed" });
    this.program = new Program<Fi6900>(idlWithAddress, provider);
    this.indexMint = indexMint;
    [this.fund, this.fundBump] = fundPda(indexMint, this.programId);
    this.lookupTables = [...(opts.lookupTables ?? []), ...(opts.lookupTable ? [opts.lookupTable] : [])];
    this.computeUnitLimit = opts.computeUnitLimit ?? 1_000_000;
    this.beginPairsPerTx = opts.beginPairsPerTx ?? BEGIN_PAIRS_PER_TX;
  }

  /** Build a client from an existing AnchorProvider (uses its connection). */
  static fromProvider(provider: AnchorProvider, indexMint: PublicKey, opts: Fi6900ClientOptions = {}): Fi6900Client {
    return new Fi6900Client(provider.connection, indexMint, opts);
  }

  /** First lookup table (back-compat accessor). */
  get lookupTable(): PublicKey | undefined {
    return this.lookupTables[0];
  }
  set lookupTable(v: PublicKey | undefined) {
    this.lookupTables = v ? [v] : [];
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  readFund(): Promise<FundAccount> {
    return readFund(this.connection, this.fund);
  }
  readAssets(): Promise<AssetAccount[]> {
    return readAssets(this.connection, this.fund, this.programId);
  }
  readActiveAssets(): Promise<AssetAccount[]> {
    return readActiveAssets(this.connection, this.fund, this.programId);
  }
  readAuctions(status?: number): Promise<AuctionAccount[]> {
    return readAuctions(this.connection, this.fund, status, this.programId);
  }
  readAuction(auction: PublicKey): Promise<AuctionAccount> {
    return readAuction(this.connection, auction);
  }
  readMintSession(owner: PublicKey, nonce: NonceLike) {
    return readMintSession(this.connection, this.mintSessionPda(owner, nonce));
  }
  readRedeemSession(owner: PublicKey, nonce: NonceLike) {
    return readRedeemSession(this.connection, this.redeemSessionPda(owner, nonce));
  }
  readPendingActions(): Promise<PendingActionAccount[]> {
    return readPendingActions(this.connection, this.fund, this.programId);
  }
  readPendingAction(action: PublicKey): Promise<PendingActionAccount | null> {
    return readPendingAction(this.connection, action);
  }

  // -------------------------------------------------------------------------
  // PDAs / addresses
  // -------------------------------------------------------------------------

  assetPda(mint: PublicKey): PublicKey {
    return assetPda(this.fund, mint, this.programId)[0];
  }
  mintSessionPda(owner: PublicKey, nonce: NonceLike): PublicKey {
    return mintSessionPda(this.fund, owner, nonce, this.programId)[0];
  }
  redeemSessionPda(owner: PublicKey, nonce: NonceLike): PublicKey {
    return redeemSessionPda(this.fund, owner, nonce, this.programId)[0];
  }
  auctionPda(nonce: NonceLike): PublicKey {
    return auctionPda(this.fund, nonce, this.programId)[0];
  }
  pendingActionPda(nonce: NonceLike): PublicKey {
    return pendingActionPda(this.fund, nonce, this.programId)[0];
  }
  /** Metaplex metadata PDA of the index mint. */
  tokenMetadataPda(): PublicKey {
    return tokenMetadataPda(this.indexMint)[0];
  }
  /** Metaplex metadata of the index mint (null until `set_token_metadata` has run). */
  readTokenMetadata(): Promise<TokenMetadataAccount | null> {
    return readTokenMetadata(this.connection, this.indexMint);
  }
  /** ATA holding index units for `owner` (index mint is a classic SPL Token mint). */
  indexAta(owner: PublicKey, indexTokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
    return getAssociatedTokenAddressSync(this.indexMint, owner, true, indexTokenProgram);
  }
  /** ATA for `owner` of an asset's mint, under the asset's token program. */
  assetAta(owner: PublicKey, asset: AssetAccount): PublicKey {
    return getAssociatedTokenAddressSync(asset.mint, owner, true, asset.tokenProgram);
  }

  /** Remaining accounts for begin_mint / begin_redeem / bootstrap_mint: [Asset, vault] per active slot. */
  assetVaultMetas(assets: AssetAccount[], assetWritable: boolean): AccountMeta[] {
    return assets.flatMap((a) => [
      { pubkey: a.address, isSigner: false, isWritable: assetWritable },
      { pubkey: a.vault, isSigner: false, isWritable: false },
    ]);
  }
  /** Remaining accounts for finalize_mint: [Asset (writable)] per active slot. */
  assetMetas(assets: AssetAccount[]): AccountMeta[] {
    return assets.map((a) => ({ pubkey: a.address, isSigner: false, isWritable: true }));
  }

  private async resolveIndexTokenProgram(): Promise<PublicKey> {
    const info = await this.connection.getAccountInfo(this.indexMint);
    if (!info) throw new Error("index mint not found");
    return info.owner;
  }

  private async resolveTokenProgram(mint: PublicKey): Promise<PublicKey> {
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
    return info.owner;
  }

  // -------------------------------------------------------------------------
  // Admin instructions (direct setters require fund.timelock_slots == 0)
  // -------------------------------------------------------------------------

  async initializeFundIx(
    authority: PublicKey,
    mintFeeBps: number,
    redeemFeeBps: number,
    mgmtFeeBps: number,
    timelockSlots: bigint | number = 0,
    indexTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .initializeFund(mintFeeBps, redeemFeeBps, mgmtFeeBps, toBN(timelockSlots))
      .accountsStrict({
        authority,
        fund: this.fund,
        indexMint: this.indexMint,
        tokenProgram: indexTokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async addAssetIx(
    authority: PublicKey,
    mint: PublicKey,
    targetWeightBps: number,
    tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    const asset = this.assetPda(mint);
    const vault = getAssociatedTokenAddressSync(mint, this.fund, true, tokenProgram);
    return this.program.methods
      .addAsset(targetWeightBps)
      .accountsStrict({
        authority,
        fund: this.fund,
        mint,
        asset,
        vault,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async setTargetWeightIx(authority: PublicKey, mint: PublicKey, targetWeightBps: number): Promise<TransactionInstruction> {
    return this.program.methods
      .setTargetWeight(targetWeightBps)
      .accountsStrict({ authority, fund: this.fund, asset: this.assetPda(mint) })
      .instruction();
  }

  async setFeesIx(authority: PublicKey, mintFeeBps: number, redeemFeeBps: number, mgmtFeeBps: number) {
    return this.program.methods
      .setFees(mintFeeBps, redeemFeeBps, mgmtFeeBps)
      .accountsStrict({ authority, fund: this.fund })
      .instruction();
  }

  async setRebalancerIx(authority: PublicKey, newRebalancer: PublicKey) {
    return this.program.methods.setRebalancer(newRebalancer).accountsStrict({ authority, fund: this.fund }).instruction();
  }

  async setFeeRecipientIx(authority: PublicKey, newFeeRecipient: PublicKey) {
    return this.program.methods
      .setFeeRecipient(newFeeRecipient)
      .accountsStrict({ authority, fund: this.fund })
      .instruction();
  }

  /** Never timelocked. */
  async setPausedIx(authority: PublicKey, mask: number) {
    return this.program.methods.setPaused(mask).accountsStrict({ authority, fund: this.fund }).instruction();
  }

  /** Enables the timelock (only while it is 0). */
  async setTimelockIx(authority: PublicKey, timelockSlots: bigint | number) {
    return this.program.methods.setTimelock(toBN(timelockSlots)).accountsStrict({ authority, fund: this.fund }).instruction();
  }

  /** Direct (timelock 0): max_auction_discount_bps, max_ref_move_bps, ref_move_period_slots. */
  async setAuctionParamsIx(authority: PublicKey, maxAuctionDiscountBps: number, maxRefMoveBps: number, refMovePeriodSlots: bigint | number) {
    return this.program.methods
      .setAuctionParams(maxAuctionDiscountBps, maxRefMoveBps, toBN(refMovePeriodSlots))
      .accountsStrict({ authority, fund: this.fund })
      .instruction();
  }

  async beginRemoveAssetIx(authority: PublicKey, mint: PublicKey) {
    return this.program.methods
      .beginRemoveAsset()
      .accountsStrict({ authority, fund: this.fund, asset: this.assetPda(mint) })
      .instruction();
  }

  async finalizeRemoveAssetIx(authority: PublicKey, asset: AssetAccount) {
    return this.program.methods
      .finalizeRemoveAsset()
      .accountsStrict({
        authority,
        fund: this.fund,
        asset: asset.address,
        vault: asset.vault,
        tokenProgram: asset.tokenProgram,
      })
      .instruction();
  }

  /**
   * Create (first call) or update the index mint's Metaplex metadata through the fund PDA. Direct
   * while `fund.timelockSlots == 0n`; once the timelock is armed queue
   * `ActionPayloads.setTokenMetadata(await tokenMetadataHash(args))` first and pass the due
   * PendingAction here (its proposer receives the rent).
   */
  async setTokenMetadataIx(authority: PublicKey, args: TokenMetadataArgs, action?: PendingActionAccount | null): Promise<TransactionInstruction> {
    assertTokenMetadataArgs(args);
    return this.program.methods
      .setTokenMetadata(args.name, args.symbol, args.uri)
      .accountsStrict({
        authority,
        fund: this.fund,
        indexMint: this.indexMint,
        metadata: this.tokenMetadataPda(),
        action: action?.address ?? null,
        proposer: action?.proposer ?? null,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
  }

  /**
   * Hand the index mint's existing metadata to the fund PDA: a plain mpl-token-metadata
   * `UpdateMetadataAccountV2 { new_update_authority: fund }` signed by the CURRENT update authority
   * (no program involvement). Needed once when the metadata was created before `initialize_fund`
   * by a key other than the fund PDA (devnet fund-setup); afterwards `setTokenMetadataIx` updates it.
   */
  transferTokenMetadataAuthorityIx(currentUpdateAuthority: PublicKey, newUpdateAuthority: PublicKey = this.fund): TransactionInstruction {
    // discriminator 15, data: None, new_update_authority: Some(pubkey), primary_sale_happened: None, is_mutable: None
    const data = Buffer.concat([Buffer.from([15, 0, 1]), newUpdateAuthority.toBuffer(), Buffer.from([0, 0])]);
    return new TransactionInstruction({
      programId: TOKEN_METADATA_PROGRAM_ID,
      keys: [
        { pubkey: this.tokenMetadataPda(), isSigner: false, isWritable: true },
        { pubkey: currentUpdateAuthority, isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  async proposeAuthorityIx(authority: PublicKey, newAuthority: PublicKey) {
    return this.program.methods.proposeAuthority(newAuthority).accountsStrict({ authority, fund: this.fund }).instruction();
  }

  async acceptAuthorityIx(pendingAuthority: PublicKey) {
    return this.program.methods.acceptAuthority().accountsStrict({ pendingAuthority, fund: this.fund }).instruction();
  }

  /** `recipientAta` defaults to the authority's index ATA. */
  async bootstrapMintIx(
    authority: PublicKey,
    units: Amount,
    recipientAta?: PublicKey,
    assets?: AssetAccount[],
  ): Promise<TransactionInstruction> {
    const active = assets ?? (await this.readActiveAssets());
    const indexTokenProgram = await this.resolveIndexTokenProgram();
    return this.program.methods
      .bootstrapMint(toBN(units))
      .accountsStrict({
        authority,
        fund: this.fund,
        indexMint: this.indexMint,
        recipientAta: recipientAta ?? this.indexAta(authority, indexTokenProgram),
        tokenProgram: indexTokenProgram,
      })
      .remainingAccounts(this.assetVaultMetas(active, false))
      .instruction();
  }

  // -------------------------------------------------------------------------
  // Governance: reference prices + timelock
  // -------------------------------------------------------------------------

  /** Rebalancer or authority. `refPriceQ64` = usdToRefPriceQ64(priceUsd, decimals). */
  async setRefPriceIx(signer: PublicKey, mint: PublicKey, refPriceQ64: bigint): Promise<TransactionInstruction> {
    return this.program.methods
      .setRefPrice(toBN(refPriceQ64))
      .accountsStrict({ signer, fund: this.fund, asset: this.assetPda(mint) })
      .instruction();
  }

  /** Authority. Returns the instruction and the PendingAction PDA it creates. */
  async queueActionIx(
    authority: PublicKey,
    payload: ActionPayload,
    fund?: FundAccount,
  ): Promise<{ instruction: TransactionInstruction; action: PublicKey; nonce: bigint }> {
    const f = fund ?? (await this.readFund());
    const action = this.pendingActionPda(f.actionNonce);
    const instruction = await this.program.methods
      .queueAction(payload.kind, payload.key, payload.values.map((v) => toBN(v)) as [BN, BN, BN, BN])
      .accountsStrict({ authority, fund: this.fund, action, systemProgram: SystemProgram.programId })
      .instruction();
    return { instruction, action, nonce: f.actionNonce };
  }

  /**
   * Anyone, once `etaSlot` has passed. Picks `execute_action` or `execute_action_add_asset`
   * from the action kind and resolves the asset / mint accounts it needs.
   */
  async executeActionIx(executor: PublicKey, action: PendingActionAccount): Promise<TransactionInstruction> {
    if (action.kind === ActionKind.AddAsset) {
      const tokenProgram = await this.resolveTokenProgram(action.key);
      return this.program.methods
        .executeActionAddAsset()
        .accountsStrict({
          executor,
          fund: this.fund,
          action: action.address,
          proposer: action.proposer,
          mint: action.key,
          asset: this.assetPda(action.key),
          vault: getAssociatedTokenAddressSync(action.key, this.fund, true, tokenProgram),
          tokenProgram,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    }
    const needsAsset =
      action.kind === ActionKind.SetTargetWeight || action.kind === ActionKind.RefPriceOverride || action.kind === ActionKind.BeginRemoveAsset;
    return this.program.methods
      .executeAction()
      .accountsStrict({
        executor,
        fund: this.fund,
        action: action.address,
        proposer: action.proposer,
        asset: needsAsset ? this.assetPda(action.key) : null,
      })
      .instruction();
  }

  async cancelActionIx(authority: PublicKey, action: PendingActionAccount): Promise<TransactionInstruction> {
    return this.program.methods
      .cancelAction()
      .accountsStrict({ authority, fund: this.fund, action: action.address, proposer: action.proposer })
      .instruction();
  }

  /** Pending actions whose eta has passed at `slot` (defaults to the current slot). */
  async readDueActions(slot?: bigint | number): Promise<PendingActionAccount[]> {
    const s = BigInt(slot ?? (await this.connection.getSlot()));
    return (await this.readPendingActions()).filter((a) => a.etaSlot <= s);
  }

  // -------------------------------------------------------------------------
  // Fees
  // -------------------------------------------------------------------------

  async accrueManagementFeeIx(fund?: FundAccount): Promise<TransactionInstruction> {
    const f = fund ?? (await this.readFund());
    const indexTokenProgram = await this.resolveIndexTokenProgram();
    return this.program.methods
      .accrueManagementFee()
      .accountsStrict({
        fund: this.fund,
        indexMint: this.indexMint,
        feeRecipientAta: this.indexAta(f.feeRecipient, indexTokenProgram),
        tokenProgram: indexTokenProgram,
      })
      .instruction();
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  /**
   * `begin_mint` with the first chunk of `[Asset, vault]` pairs. Pass every active asset to
   * begin in one transaction (fine up to beginPairsPerTx assets); the session is `ready`
   * once every active slot has been covered (see `beginMintContinueIx`).
   */
  async beginMintIx(owner: PublicKey, units: Amount, nonce: NonceLike, assets?: AssetAccount[]) {
    const active = assets ?? (await this.readActiveAssets());
    return this.program.methods
      .beginMint(toBN(units), toBN(nonce))
      .accountsStrict({
        owner,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.mintSessionPda(owner, nonce),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.assetVaultMetas(active, false))
      .instruction();
  }

  /** `begin_mint_continue` with the next chunk of active assets (slot order, after the previous chunk). */
  async beginMintContinueIx(owner: PublicKey, nonce: NonceLike, chunk: AssetAccount[]) {
    return this.program.methods
      .beginMintContinue()
      .accountsStrict({ owner, fund: this.fund, indexMint: this.indexMint, session: this.mintSessionPda(owner, nonce) })
      .remainingAccounts(this.assetVaultMetas(chunk, false))
      .instruction();
  }

  /** `[begin_mint(chunk0), begin_mint_continue(chunk1), ...]` — one ix per transaction. */
  async beginMintIxs(owner: PublicKey, units: Amount, nonce: NonceLike, assets: AssetAccount[]): Promise<TransactionInstruction[]> {
    const chunks = Fi6900Client.chunk(assets, this.beginPairsPerTx);
    const out: TransactionInstruction[] = [await this.beginMintIx(owner, units, nonce, chunks[0] ?? [])];
    for (const c of chunks.slice(1)) out.push(await this.beginMintContinueIx(owner, nonce, c));
    return out;
  }

  /**
   * `deposit(slot, gross_amount?)`. `grossAmount` is what the owner sends; the program credits what
   * the vault receives and requires it to be >= `required[slot]`. Leave it undefined for ordinary
   * mints (the program then transfers exactly `required`); for a Token-2022 mint with a transfer fee
   * pass `await client.depositGross(asset, required)` (buildMintTxs does this automatically).
   */
  async depositIx(owner: PublicKey, nonce: NonceLike, asset: AssetAccount, ownerToken?: PublicKey, grossAmount?: Amount | null) {
    return this.program.methods
      .deposit(asset.index, grossAmount == null ? null : toBN(grossAmount))
      .accountsStrict({
        owner,
        fund: this.fund,
        session: this.mintSessionPda(owner, nonce),
        asset: asset.address,
        vault: asset.vault,
        mint: asset.mint,
        ownerToken: ownerToken ?? this.assetAta(owner, asset),
        tokenProgram: asset.tokenProgram,
      })
      .instruction();
  }

  async finalizeMintIx(owner: PublicKey, nonce: NonceLike, fund?: FundAccount, assets?: AssetAccount[]) {
    const f = fund ?? (await this.readFund());
    const active = assets ?? (await this.readActiveAssets());
    const indexTokenProgram = await this.resolveIndexTokenProgram();
    return this.program.methods
      .finalizeMint()
      .accountsStrict({
        owner,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.mintSessionPda(owner, nonce),
        ownerIndexAta: this.indexAta(owner, indexTokenProgram),
        feeRecipientAta: this.indexAta(f.feeRecipient, indexTokenProgram),
        tokenProgram: indexTokenProgram,
      })
      .remainingAccounts(this.assetMetas(active))
      .instruction();
  }

  async cancelMintRefundIx(owner: PublicKey, nonce: NonceLike, asset: AssetAccount, ownerToken?: PublicKey) {
    return this.program.methods
      .cancelMintRefund(asset.index)
      .accountsStrict({
        owner,
        fund: this.fund,
        session: this.mintSessionPda(owner, nonce),
        asset: asset.address,
        vault: asset.vault,
        mint: asset.mint,
        ownerToken: ownerToken ?? this.assetAta(owner, asset),
        tokenProgram: asset.tokenProgram,
      })
      .instruction();
  }

  async cancelMintCloseIx(owner: PublicKey, nonce: NonceLike) {
    return this.program.methods
      .cancelMintClose()
      .accountsStrict({ owner, session: this.mintSessionPda(owner, nonce) })
      .instruction();
  }

  // -------------------------------------------------------------------------
  // Redemption
  // -------------------------------------------------------------------------

  /** `begin_redeem` with the first chunk of `[Asset (writable), vault]` pairs (burns + pays the fee now). */
  async beginRedeemIx(owner: PublicKey, units: Amount, nonce: NonceLike, fund?: FundAccount, assets?: AssetAccount[]) {
    const f = fund ?? (await this.readFund());
    const active = assets ?? (await this.readActiveAssets());
    const indexTokenProgram = await this.resolveIndexTokenProgram();
    return this.program.methods
      .beginRedeem(toBN(units), toBN(nonce))
      .accountsStrict({
        owner,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.redeemSessionPda(owner, nonce),
        ownerIndexAta: this.indexAta(owner, indexTokenProgram),
        feeRecipientAta: this.indexAta(f.feeRecipient, indexTokenProgram),
        tokenProgram: indexTokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.assetVaultMetas(active, true))
      .instruction();
  }

  async beginRedeemContinueIx(owner: PublicKey, nonce: NonceLike, chunk: AssetAccount[]) {
    return this.program.methods
      .beginRedeemContinue()
      .accountsStrict({ owner, fund: this.fund, indexMint: this.indexMint, session: this.redeemSessionPda(owner, nonce) })
      .remainingAccounts(this.assetVaultMetas(chunk, true))
      .instruction();
  }

  async beginRedeemIxs(owner: PublicKey, units: Amount, nonce: NonceLike, fund: FundAccount, assets: AssetAccount[]): Promise<TransactionInstruction[]> {
    const chunks = Fi6900Client.chunk(assets, this.beginPairsPerTx);
    const out: TransactionInstruction[] = [await this.beginRedeemIx(owner, units, nonce, fund, chunks[0] ?? [])];
    for (const c of chunks.slice(1)) out.push(await this.beginRedeemContinueIx(owner, nonce, c));
    return out;
  }

  async withdrawIx(owner: PublicKey, nonce: NonceLike, asset: AssetAccount, ownerToken?: PublicKey) {
    return this.program.methods
      .withdraw(asset.index)
      .accountsStrict({
        owner,
        fund: this.fund,
        session: this.redeemSessionPda(owner, nonce),
        asset: asset.address,
        vault: asset.vault,
        mint: asset.mint,
        ownerToken: ownerToken ?? this.assetAta(owner, asset),
        tokenProgram: asset.tokenProgram,
      })
      .instruction();
  }

  async closeRedeemIx(owner: PublicKey, nonce: NonceLike) {
    return this.program.methods
      .closeRedeem()
      .accountsStrict({ owner, session: this.redeemSessionPda(owner, nonce) })
      .instruction();
  }

  // -------------------------------------------------------------------------
  // Auctions
  // -------------------------------------------------------------------------

  /** Returns the instruction and the auction PDA it will create. */
  async startAuctionIx(
    rebalancer: PublicKey,
    sellAsset: AssetAccount,
    buyAsset: AssetAccount,
    sellAmount: Amount,
    startPriceQ64: bigint | BN,
    endPriceQ64: bigint | BN,
    durationSlots: Amount,
    fund?: FundAccount,
  ): Promise<{ instruction: TransactionInstruction; auction: PublicKey; nonce: bigint }> {
    const f = fund ?? (await this.readFund());
    const auction = this.auctionPda(f.auctionNonce);
    const instruction = await this.program.methods
      .startAuction(toBN(sellAmount), toBN(startPriceQ64), toBN(endPriceQ64), toBN(durationSlots))
      .accountsStrict({
        rebalancer,
        fund: this.fund,
        sellAsset: sellAsset.address,
        buyAsset: buyAsset.address,
        vault: sellAsset.vault,
        auction,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return { instruction, auction, nonce: f.auctionNonce };
  }

  /**
   * `fill_auction(sell_amount, gross_buy_amount?)`. The program computes the price-implied
   * `buy_amount` at the fill slot and requires the buy vault to RECEIVE at least that much.
   * `opts.grossBuyAmount` is what the filler sends (default: exactly `buy_amount`); for a buy token
   * with a Token-2022 transfer fee compute it with `fillGrossFor(buyAsset, buyAmount)` where
   * `buyAmount` is `buyAmountFor(sellAmount, auctionPriceAt(auction, currentSlot))` — the price
   * only decays, so a gross sized at the current slot still clears when the tx lands later.
   */
  async fillAuctionIx(
    filler: PublicKey,
    auction: AuctionAccount,
    sellAmount: Amount,
    opts: {
      sellAsset?: AssetAccount;
      buyAsset?: AssetAccount;
      fillerSellToken?: PublicKey;
      fillerBuyToken?: PublicKey;
      grossBuyAmount?: Amount | null;
    } = {},
  ): Promise<TransactionInstruction> {
    let { sellAsset, buyAsset } = opts;
    if (!sellAsset || !buyAsset) {
      const all = await this.readAssets();
      sellAsset ??= all.find((a) => a.address.equals(auction.sellAsset));
      buyAsset ??= all.find((a) => a.address.equals(auction.buyAsset));
    }
    if (!sellAsset || !buyAsset) throw new Error("auction assets not found");
    return this.program.methods
      .fillAuction(toBN(sellAmount), opts.grossBuyAmount == null ? null : toBN(opts.grossBuyAmount))
      .accountsStrict({
        filler,
        fund: this.fund,
        auction: auction.address,
        sellAsset: sellAsset.address,
        buyAsset: buyAsset.address,
        sellVault: sellAsset.vault,
        buyVault: buyAsset.vault,
        fillerSellToken: opts.fillerSellToken ?? this.assetAta(filler, sellAsset),
        fillerBuyToken: opts.fillerBuyToken ?? this.assetAta(filler, buyAsset),
        sellMint: sellAsset.mint,
        buyMint: buyAsset.mint,
        sellTokenProgram: sellAsset.tokenProgram,
        buyTokenProgram: buyAsset.tokenProgram,
      })
      .instruction();
  }

  async cancelAuctionIx(signer: PublicKey, auction: PublicKey) {
    return this.program.methods.cancelAuction().accountsStrict({ signer, fund: this.fund, auction }).instruction();
  }

  // -------------------------------------------------------------------------
  // Lookup tables
  // -------------------------------------------------------------------------

  createFundLookupTable(payer: PublicKey, authority: PublicKey = payer): Promise<LookupTablePlan> {
    return createFundLookupTable(this.connection, this.fund, payer, authority, this.programId);
  }

  /** Single-table extend (throws when full); prefer `extendFundLookupTables`. */
  extendFundLookupTable(lookupTable: PublicKey, payer: PublicKey, authority: PublicKey = payer) {
    return extendFundLookupTable(this.connection, this.fund, lookupTable, payer, authority, this.programId);
  }

  /** Grow the configured (or given) tables, creating new ones when they are full. */
  extendFundLookupTables(payer: PublicKey, authority: PublicKey = payer, lookupTables?: PublicKey[]): Promise<LookupTableGrowth> {
    return extendFundLookupTables(this.connection, this.fund, lookupTables ?? this.lookupTables, payer, authority, this.programId);
  }

  private async loadLookupTables(opts: BuildTxOptions): Promise<AddressLookupTableAccount[]> {
    const keys = opts.lookupTables ?? (opts.lookupTable ? [opts.lookupTable] : this.lookupTables);
    const out: AddressLookupTableAccount[] = [];
    for (const key of keys) {
      const res = await this.connection.getAddressLookupTable(key);
      if (!res.value) throw new Error(`lookup table ${key.toBase58()} not found`);
      out.push(res.value);
    }
    return out;
  }

  private async compile(
    payer: PublicKey,
    groups: TransactionInstruction[][],
    tables: AddressLookupTableAccount[],
  ): Promise<VersionedTransaction[]> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    return groups.map((instructions) => {
      const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(
        tables,
      );
      return new VersionedTransaction(msg);
    });
  }

  private cuIx(): TransactionInstruction {
    return ComputeBudgetProgram.setComputeUnitLimit({ units: this.computeUnitLimit });
  }

  static chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // -------------------------------------------------------------------------
  // Full flows
  // -------------------------------------------------------------------------

  /**
   * Ordered, unsigned transactions for an in-kind creation of `units`:
   *   [0]      accrue_management_fee + begin_mint (first chunk of <= beginPairsPerTx assets)
   *   [..]     begin_mint_continue per further chunk (funds with > beginPairsPerTx assets only)
   *   [..]     deposit batches (DEPOSITS_PER_TX per tx)
   *   [last]   create owner index ATA (idempotent) + finalize_mint
   * All transactions share one recent blockhash; send them in order promptly.
   */
  async buildMintTxs(owner: PublicKey, units: Amount, opts: BuildTxOptions = {}): Promise<VersionedTransaction[]> {
    const nonce = opts.nonce ?? randomNonce();
    const payer = opts.payer ?? owner;
    const [fund, assets, tables, indexTokenProgram] = await Promise.all([
      this.readFund(),
      this.readActiveAssets(),
      this.loadLookupTables(opts),
      this.resolveIndexTokenProgram(),
    ]);

    const feeAta = this.indexAta(fund.feeRecipient, indexTokenProgram);
    const ownerAta = this.indexAta(owner, indexTokenProgram);

    const [beginIx, ...continueIxs] = await this.beginMintIxs(owner, units, nonce, assets);
    const first: TransactionInstruction[] = [this.cuIx()];
    first.push(
      createAssociatedTokenAccountIdempotentInstruction(payer, feeAta, fund.feeRecipient, this.indexMint, indexTokenProgram),
    );
    if (!opts.skipAccrue) first.push(await this.accrueManagementFeeIx(fund));
    first.push(beginIx);
    const continueGroups = continueIxs.map((ix) => [this.cuIx(), ix]);

    // Token-2022 fee-on-transfer constituents need a gross deposit whose net clears `required`.
    // `required` is only known on-chain after begin_mint, so predict it with the same formula
    // (quoteMint); the accrue_management_fee prelude can only raise the supply, which lowers it.
    const fees = await this.transferFees(assets);
    let predicted: Map<string, bigint> | null = null;
    if ([...fees.values()].some((f) => f !== null)) {
      predicted = new Map((await this.quoteMint(units)).map((q) => [q.asset.address.toBase58(), q.amount]));
    }
    const depositIxs = await Promise.all(
      assets.map((a) => {
        const fee = fees.get(a.mint.toBase58()) ?? null;
        const gross = fee && predicted ? grossForNet(predicted.get(a.address.toBase58()) ?? 0n, fee.feeBps, fee.maxFee) : null;
        return this.depositIx(owner, nonce, a, undefined, gross);
      }),
    );
    const depositGroups = Fi6900Client.chunk(depositIxs, DEPOSITS_PER_TX).map((g) => [this.cuIx(), ...g]);

    const last: TransactionInstruction[] = [
      this.cuIx(),
      createAssociatedTokenAccountIdempotentInstruction(payer, ownerAta, owner, this.indexMint, indexTokenProgram),
      await this.finalizeMintIx(owner, nonce, fund, assets),
    ];

    return this.compile(payer, [first, ...continueGroups, ...depositGroups, last], tables);
  }

  /**
   * Ordered, unsigned transactions for an in-kind redemption of `units`:
   *   [0]      accrue_management_fee + begin_redeem (first chunk)
   *   [..]     begin_redeem_continue per further chunk
   *   [..]     withdraw batches (WITHDRAWS_PER_TX per tx, each preceded by an idempotent ATA create)
   *   [last]   close_redeem
   */
  async buildRedeemTxs(owner: PublicKey, units: Amount, opts: BuildTxOptions = {}): Promise<VersionedTransaction[]> {
    const nonce = opts.nonce ?? randomNonce();
    const payer = opts.payer ?? owner;
    const [fund, assets, tables, indexTokenProgram] = await Promise.all([
      this.readFund(),
      this.readActiveAssets(),
      this.loadLookupTables(opts),
      this.resolveIndexTokenProgram(),
    ]);

    const feeAta = this.indexAta(fund.feeRecipient, indexTokenProgram);
    const [beginIx, ...continueIxs] = await this.beginRedeemIxs(owner, units, nonce, fund, assets);
    const first: TransactionInstruction[] = [this.cuIx()];
    first.push(
      createAssociatedTokenAccountIdempotentInstruction(payer, feeAta, fund.feeRecipient, this.indexMint, indexTokenProgram),
    );
    if (!opts.skipAccrue) first.push(await this.accrueManagementFeeIx(fund));
    first.push(beginIx);
    const continueGroups = continueIxs.map((ix) => [this.cuIx(), ix]);

    const withdrawGroups: TransactionInstruction[][] = [];
    for (const group of Fi6900Client.chunk(assets, WITHDRAWS_PER_TX)) {
      const ixs: TransactionInstruction[] = [this.cuIx()];
      for (const a of group) {
        const ata = this.assetAta(owner, a);
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, a.mint, a.tokenProgram));
        ixs.push(await this.withdrawIx(owner, nonce, a, ata));
      }
      withdrawGroups.push(ixs);
    }

    const last = [await this.closeRedeemIx(owner, nonce)];
    return this.compile(payer, [first, ...continueGroups, ...withdrawGroups, last], tables);
  }

  /** Refund every deposited slot of a stale/abandoned mint session and close it. */
  async buildCancelMintTxs(owner: PublicKey, nonce: NonceLike, opts: BuildTxOptions = {}): Promise<VersionedTransaction[]> {
    const payer = opts.payer ?? owner;
    const session = await this.readMintSession(owner, nonce);
    if (!session) throw new Error("mint session not found");
    const [assets, tables] = await Promise.all([this.readAssets(), this.loadLookupTables(opts)]);
    const deposited = new Set(bitmapSlots(session.depositedBitmap));
    const refundIxs = await Promise.all(assets.filter((a) => deposited.has(a.index)).map((a) => this.cancelMintRefundIx(owner, nonce, a)));
    const groups = Fi6900Client.chunk(refundIxs, DEPOSITS_PER_TX).map((g) => [this.cuIx(), ...g]);
    groups.push([await this.cancelMintCloseIx(owner, nonce)]);
    return this.compile(payer, groups, tables);
  }

  // -------------------------------------------------------------------------
  // Token-2022 transfer fees (fee-on-transfer constituents)
  // -------------------------------------------------------------------------

  private readonly transferFeeCache = new Map<string, TransferFeeInfo | null>();

  /**
   * Active transfer fee of `mint` (null for plain SPL mints, Token-2022 mints without a
   * TransferFeeConfig, or a zero fee). Cached per client instance; pass `refresh` to re-read
   * (the fee authority can change the fee one epoch ahead).
   */
  async transferFee(mint: PublicKey, tokenProgram?: PublicKey, refresh = false): Promise<TransferFeeInfo | null> {
    const key = mint.toBase58();
    if (!refresh && this.transferFeeCache.has(key)) return this.transferFeeCache.get(key)!;
    const program = tokenProgram ?? (await this.resolveTokenProgram(mint));
    let info: TransferFeeInfo | null = null;
    if (program.equals(TOKEN_2022_PROGRAM_ID)) {
      const [m, epochInfo] = await Promise.all([getMint(this.connection, mint, "confirmed", program), this.connection.getEpochInfo()]);
      const cfg = getTransferFeeConfig(m);
      if (cfg) {
        const fee = getEpochFee(cfg, BigInt(epochInfo.epoch));
        if (fee.transferFeeBasisPoints > 0 && fee.maximumFee > 0n) info = { feeBps: fee.transferFeeBasisPoints, maxFee: fee.maximumFee };
      }
    }
    this.transferFeeCache.set(key, info);
    return info;
  }

  /** `transferFee` for many assets, keyed by mint base58 (only Token-2022 mints hit the RPC). */
  async transferFees(assets: AssetAccount[]): Promise<Map<string, TransferFeeInfo | null>> {
    const out = new Map<string, TransferFeeInfo | null>();
    await Promise.all(assets.map(async (a) => out.set(a.mint.toBase58(), await this.transferFee(a.mint, a.tokenProgram))));
    return out;
  }

  /** Gross amount to send so the vault receives `required` of `asset` (== required without a fee). */
  async depositGross(asset: AssetAccount, required: Amount): Promise<bigint> {
    const net = BigInt(toBN(required).toString());
    const fee = await this.transferFee(asset.mint, asset.tokenProgram);
    return fee ? grossForNet(net, fee.feeBps, fee.maxFee) : net;
  }

  /** Gross buy amount a filler must send so the buy vault receives `buyAmount` (== buyAmount without a fee). */
  fillGrossFor(buyAsset: AssetAccount, buyAmount: Amount): Promise<bigint> {
    return this.depositGross(buyAsset, buyAmount);
  }

  // -------------------------------------------------------------------------
  // Quotes (pure reads)
  // -------------------------------------------------------------------------

  /** Per-asset basket required to create `units` right now (same math as begin_mint). */
  async quoteMint(units: Amount): Promise<{ asset: AssetAccount; amount: bigint }[]> {
    const [assets, supply] = await Promise.all([this.readActiveAssets(), this.readSupply()]);
    if (supply === 0n) throw new Error("supply is zero");
    const u = BigInt(toBN(units).toString());
    const balances = await this.readVaultBalances(assets);
    return assets.map((asset, i) => {
      const eff = balances[i] - asset.pendingDeposits - asset.pendingWithdrawals;
      const num = eff * u;
      const amount = num % supply === 0n ? num / supply : num / supply + 1n;
      return { asset, amount };
    });
  }

  /** Per-asset basket received for redeeming `units` right now (same math as begin_redeem). */
  async quoteRedeem(units: Amount): Promise<{ asset: AssetAccount; amount: bigint; fee: bigint; net: bigint }[]> {
    const [fund, assets, supply] = await Promise.all([this.readFund(), this.readActiveAssets(), this.readSupply()]);
    if (supply === 0n) throw new Error("supply is zero");
    const u = BigInt(toBN(units).toString());
    const fee = (u * BigInt(fund.redeemFeeBps)) / 10_000n;
    const net = u - fee;
    const balances = await this.readVaultBalances(assets);
    return assets.map((asset, i) => {
      const eff = balances[i] - asset.pendingDeposits - asset.pendingWithdrawals;
      return { asset, amount: (eff * net) / supply, fee, net };
    });
  }

  async readSupply(): Promise<bigint> {
    const res = await this.connection.getTokenSupply(this.indexMint);
    return BigInt(res.value.amount);
  }

  async readVaultBalances(assets: AssetAccount[]): Promise<bigint[]> {
    const out: bigint[] = [];
    // getMultipleAccountsInfo accepts at most 100 keys per call
    for (const group of Fi6900Client.chunk(assets, 100)) {
      const infos = await this.connection.getMultipleAccountsInfo(group.map((a) => a.vault));
      for (const info of infos) {
        // SPL token account layout: amount is u64 LE at offset 64 (same for Token-2022 base layout).
        out.push(info ? info.data.readBigUInt64LE(64) : 0n);
      }
    }
    return out;
  }

  /** effective_balance per active asset (vault - pending_deposits - pending_withdrawals). */
  async readEffectiveBalances(assets?: AssetAccount[]): Promise<{ asset: AssetAccount; vault: bigint; effective: bigint }[]> {
    const list = assets ?? (await this.readActiveAssets());
    const balances = await this.readVaultBalances(list);
    return list.map((asset, i) => ({
      asset,
      vault: balances[i],
      effective: balances[i] - asset.pendingDeposits - asset.pendingWithdrawals,
    }));
  }
}

export { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID };
