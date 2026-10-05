import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  mintTo,
  createTransferCheckedInstruction,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
  ExtensionType,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "node:crypto";
import idl from "../target/idl/fi6900.json";
import type { Fi6900 } from "../target/types/fi6900";

export const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/** programs/fi6900 `token_metadata_hash`: sha256 over u32-LE-length-prefixed name, symbol, uri. */
export function tokenMetadataHash(name: string, symbol: string, uri: string): PublicKey {
  const h = createHash("sha256");
  for (const v of [name, symbol, uri]) {
    const bytes = Buffer.from(v, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    h.update(len).update(bytes);
  }
  return new PublicKey(h.digest());
}
export const PROGRAM_ID = new PublicKey(idl.address);

export const FUND_SEED = Buffer.from("fund");
export const ASSET_SEED = Buffer.from("asset");
export const MINT_SESSION_SEED = Buffer.from("mint_session");
export const REDEEM_SESSION_SEED = Buffer.from("redeem_session");
export const AUCTION_SEED = Buffer.from("auction");
export const PENDING_SEED = Buffer.from("pending");

/** [u64; 8] bitmap (BN words from Anchor) -> 512-bit bigint. */
export const bitmapBig = (words: (BN | bigint | number)[]): bigint => words.reduce<bigint>((acc, w, i) => acc | (big(w) << BigInt(64 * i)), 0n);
export const slotsOf = (bitmap: bigint): number[] => {
  const out: number[] = [];
  for (let i = 0; i < 512; i++) if ((bitmap >> BigInt(i)) & 1n) out.push(i);
  return out;
};

export enum ActionKind { SetFees = 0, SetTargetWeight = 1, SetRebalancer = 2, SetFeeRecipient = 3, RefPriceOverride = 4, SetMaxAuctionDiscount = 5, SetTimelock = 6, AddAsset = 7, BeginRemoveAsset = 8, SetRefMovePolicy = 9, SetTokenMetadata = 10 }

export const Q64 = 1n << 64n;
export const U64_MAX = (1n << 64n) - 1n;

export const big = (v: BN | bigint | number | string): bigint => (typeof v === "bigint" ? v : BigInt(v.toString()));
export const bn = (v: bigint | number): BN => new BN(v.toString());
export const le8 = (v: bigint | number): Buffer => new BN(v.toString()).toArrayLike(Buffer, "le", 8);

export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  const n = a * b;
  return n % c === 0n ? n / c : n / c + 1n;
}
export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b) / c;
}
export function linearPrice(start: bigint, end: bigint, elapsed: bigint, duration: bigint): bigint {
  const el = elapsed > duration ? duration : elapsed;
  const diff = start - end;
  return start - ((diff / duration) * el + ((diff % duration) * el) / duration);
}
/** Token-2022 transfer fee on a gross transfer: min(ceil(gross*bps/10_000), maxFee). */
export function transferFeeFor(gross: bigint, feeBps: number, maxFee: bigint): bigint {
  if (feeBps <= 0 || gross <= 0n) return 0n;
  const num = gross * BigInt(feeBps);
  const fee = num % 10_000n === 0n ? num / 10_000n : num / 10_000n + 1n;
  return fee > maxFee ? maxFee : fee;
}

/** Smallest gross g with g - fee(g) >= net (mirrors packages/sdk pricing.grossForNet). */
export function grossForNet(net: bigint, feeBps: number, maxFee: bigint): bigint {
  if (net <= 0n || feeBps <= 0 || maxFee <= 0n) return net;
  let lo = net;
  let hi = net + maxFee;
  while (lo < hi) {
    const mid = (lo + hi) >> 1n;
    if (mid - transferFeeFor(mid, feeBps, maxFee) >= net) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

export function buyAmountFor(sell: bigint, price: bigint): bigint {
  const hi = price >> 64n;
  const lo = price & U64_MAX;
  const fracNum = sell * lo;
  const total = sell * hi + (fracNum >> 64n) + ((fracNum & U64_MAX) !== 0n ? 1n : 0n);
  return total;
}

export interface AssetInfo {
  mint: PublicKey;
  decimals: number;
  tokenProgram: PublicKey;
  asset: PublicKey;
  vault: PublicKey;
  slot: number;
}

export class TestEnv {
  readonly connection: Connection;
  readonly authority: Keypair;
  readonly provider: AnchorProvider;
  readonly program: Program<Fi6900>;
  indexMint!: PublicKey;
  fund!: PublicKey;
  fundBump!: number;
  readonly assets: AssetInfo[] = [];

  constructor() {
    this.connection = new Connection(RPC_URL, "confirmed");
    this.authority = Keypair.generate();
    this.provider = new AnchorProvider(this.connection, new Wallet(this.authority), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    anchor.setProvider(this.provider);
    this.program = new Program<Fi6900>(idl as Fi6900, this.provider);
  }

  async airdrop(pubkey: PublicKey, sol = 100): Promise<void> {
    const sig = await this.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(sig, "confirmed");
  }

  async send(ixs: TransactionInstruction[], signers: Keypair[] = [this.authority]): Promise<string> {
    const tx = new Transaction().add(...ixs);
    return sendAndConfirmTransaction(this.connection, tx, signers, { commitment: "confirmed" });
  }

  /** Create the index mint (6 decimals, authority = test authority) and derive the fund PDA. */
  async createIndexMint(): Promise<void> {
    this.indexMint = await createMint(this.connection, this.authority, this.authority.publicKey, null, 6);
    [this.fund, this.fundBump] = PublicKey.findProgramAddressSync([FUND_SEED, this.indexMint.toBuffer()], PROGRAM_ID);
  }

  async createAssetMint(decimals: number, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<PublicKey> {
    return createMint(this.connection, this.authority, this.authority.publicKey, null, decimals, undefined, undefined, tokenProgram);
  }

  /** Token-2022 mint with a TransferFeeConfig (fee-on-transfer); authority = test authority. */
  async createTransferFeeMint(decimals: number, feeBps: number, maxFee: bigint): Promise<PublicKey> {
    const kp = Keypair.generate();
    const space = getMintLen([ExtensionType.TransferFeeConfig]);
    const lamports = await this.connection.getMinimumBalanceForRentExemption(space);
    await this.send(
      [
        SystemProgram.createAccount({ fromPubkey: this.authority.publicKey, newAccountPubkey: kp.publicKey, lamports, space, programId: TOKEN_2022_PROGRAM_ID }),
        createInitializeTransferFeeConfigInstruction(kp.publicKey, this.authority.publicKey, this.authority.publicKey, feeBps, maxFee, TOKEN_2022_PROGRAM_ID),
        createInitializeMintInstruction(kp.publicKey, decimals, this.authority.publicKey, null, TOKEN_2022_PROGRAM_ID),
      ],
      [this.authority, kp],
    );
    return kp.publicKey;
  }

  async mintTokens(mint: PublicKey, to: PublicKey, amount: bigint, tokenProgram: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, to, true, tokenProgram);
    await this.send([
      createAssociatedTokenAccountIdempotentInstruction(this.authority.publicKey, ata, to, mint, tokenProgram),
    ]);
    await mintTo(this.connection, this.authority, mint, ata, this.authority, amount, [], undefined, tokenProgram);
    return ata;
  }

  async ensureAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    await this.send([
      createAssociatedTokenAccountIdempotentInstruction(this.authority.publicKey, ata, owner, mint, tokenProgram),
    ]);
    return ata;
  }

  async tokenBalance(account: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<bigint> {
    const info = await this.connection.getAccountInfo(account);
    if (!info) return 0n;
    return (await getAccount(this.connection, account, "confirmed", tokenProgram)).amount;
  }

  async supply(): Promise<bigint> {
    return (await getMint(this.connection, this.indexMint)).supply;
  }

  indexAta(owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(this.indexMint, owner, true, TOKEN_PROGRAM_ID);
  }

  assetPda(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([ASSET_SEED, this.fund.toBuffer(), mint.toBuffer()], PROGRAM_ID)[0];
  }
  mintSessionPda(owner: PublicKey, nonce: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [MINT_SESSION_SEED, this.fund.toBuffer(), owner.toBuffer(), le8(nonce)],
      PROGRAM_ID,
    )[0];
  }
  redeemSessionPda(owner: PublicKey, nonce: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [REDEEM_SESSION_SEED, this.fund.toBuffer(), owner.toBuffer(), le8(nonce)],
      PROGRAM_ID,
    )[0];
  }
  auctionPda(nonce: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([AUCTION_SEED, this.fund.toBuffer(), le8(nonce)], PROGRAM_ID)[0];
  }

  // -- program wrappers -----------------------------------------------------

  async fetchFund() {
    return this.program.account.fund.fetch(this.fund);
  }
  async fetchAsset(asset: PublicKey) {
    return this.program.account.asset.fetch(asset);
  }

  /** Active assets in slot order, per the fund bitmap. */
  async activeAssets(): Promise<AssetInfo[]> {
    const fund = await this.fetchFund();
    const bitmap = bitmapBig(fund.activeBitmap as BN[]);
    return this.assets.filter((a) => (bitmap >> BigInt(a.slot)) & 1n).sort((a, b) => a.slot - b.slot);
  }

  assetVaultMetas(assets: AssetInfo[], assetWritable: boolean) {
    return assets.flatMap((a) => [
      { pubkey: a.asset, isSigner: false, isWritable: assetWritable },
      { pubkey: a.vault, isSigner: false, isWritable: false },
    ]);
  }

  async initializeFund(mintFee: number, redeemFee: number, mgmtFee: number, timelockSlots: bigint | number = 0): Promise<string> {
    return this.program.methods
      .initializeFund(mintFee, redeemFee, mgmtFee, bn(timelockSlots))
      .accountsStrict({
        authority: this.authority.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async addAsset(mint: PublicKey, decimals: number, tokenProgram: PublicKey, weightBps: number): Promise<AssetInfo> {
    const asset = this.assetPda(mint);
    const vault = getAssociatedTokenAddressSync(mint, this.fund, true, tokenProgram);
    await this.program.methods
      .addAsset(weightBps)
      .accountsStrict({
        authority: this.authority.publicKey,
        fund: this.fund,
        mint,
        asset,
        vault,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const acc = await this.fetchAsset(asset);
    const info: AssetInfo = { mint, decimals, tokenProgram, asset, vault, slot: acc.index };
    this.assets.push(info);
    return info;
  }

  /** Transfer `amount` of an asset from the authority's ATA into the vault (pre-bootstrap seeding). */
  async seedVault(a: AssetInfo, amount: bigint): Promise<void> {
    const from = getAssociatedTokenAddressSync(a.mint, this.authority.publicKey, true, a.tokenProgram);
    await this.send([
      createTransferCheckedInstruction(from, a.mint, a.vault, this.authority.publicKey, amount, a.decimals, [], a.tokenProgram),
    ]);
  }

  async bootstrapMint(units: bigint, recipient: PublicKey = this.authority.publicKey): Promise<string> {
    const ata = await this.ensureAta(recipient, this.indexMint, TOKEN_PROGRAM_ID);
    const active = await this.activeAssets();
    return this.program.methods
      .bootstrapMint(bn(units))
      .accountsStrict({
        authority: this.authority.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        recipientAta: ata,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(this.assetVaultMetas(active, false))
      .rpc();
  }

  async accrueManagementFee(): Promise<string> {
    const fund = await this.fetchFund();
    return this.program.methods
      .accrueManagementFee()
      .accountsStrict({
        fund: this.fund,
        indexMint: this.indexMint,
        feeRecipientAta: this.indexAta(fund.feeRecipient),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async beginMint(owner: Keypair, units: bigint, nonce: bigint): Promise<string> {
    const active = await this.activeAssets();
    return this.program.methods
      .beginMint(bn(units), bn(nonce))
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.mintSessionPda(owner.publicKey, nonce),
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.assetVaultMetas(active, false))
      .signers([owner])
      .rpc();
  }

  /** `gross` = amount the owner sends (null -> the program transfers exactly `required[slot]`). */
  async deposit(owner: Keypair, nonce: bigint, a: AssetInfo, gross: bigint | null = null): Promise<string> {
    return this.program.methods
      .deposit(a.slot, gross === null ? null : bn(gross))
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        session: this.mintSessionPda(owner.publicKey, nonce),
        asset: a.asset,
        vault: a.vault,
        mint: a.mint,
        ownerToken: getAssociatedTokenAddressSync(a.mint, owner.publicKey, true, a.tokenProgram),
        tokenProgram: a.tokenProgram,
      })
      .signers([owner])
      .rpc();
  }

  async finalizeMint(owner: Keypair, nonce: bigint): Promise<string> {
    const fund = await this.fetchFund();
    const active = await this.activeAssets();
    await this.ensureAta(owner.publicKey, this.indexMint, TOKEN_PROGRAM_ID);
    return this.program.methods
      .finalizeMint()
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.mintSessionPda(owner.publicKey, nonce),
        ownerIndexAta: this.indexAta(owner.publicKey),
        feeRecipientAta: this.indexAta(fund.feeRecipient),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(active.map((a) => ({ pubkey: a.asset, isSigner: false, isWritable: true })))
      .signers([owner])
      .rpc();
  }

  async cancelMintRefund(owner: Keypair, nonce: bigint, a: AssetInfo): Promise<string> {
    return this.program.methods
      .cancelMintRefund(a.slot)
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        session: this.mintSessionPda(owner.publicKey, nonce),
        asset: a.asset,
        vault: a.vault,
        mint: a.mint,
        ownerToken: getAssociatedTokenAddressSync(a.mint, owner.publicKey, true, a.tokenProgram),
        tokenProgram: a.tokenProgram,
      })
      .signers([owner])
      .rpc();
  }

  async cancelMintClose(owner: Keypair, nonce: bigint): Promise<string> {
    return this.program.methods
      .cancelMintClose()
      .accountsStrict({ owner: owner.publicKey, session: this.mintSessionPda(owner.publicKey, nonce) })
      .signers([owner])
      .rpc();
  }

  async beginRedeem(owner: Keypair, units: bigint, nonce: bigint): Promise<string> {
    const fund = await this.fetchFund();
    const active = await this.activeAssets();
    return this.program.methods
      .beginRedeem(bn(units), bn(nonce))
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        session: this.redeemSessionPda(owner.publicKey, nonce),
        ownerIndexAta: this.indexAta(owner.publicKey),
        feeRecipientAta: this.indexAta(fund.feeRecipient),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(this.assetVaultMetas(active, true))
      .signers([owner])
      .rpc();
  }

  async withdraw(owner: Keypair, nonce: bigint, a: AssetInfo): Promise<string> {
    await this.ensureAta(owner.publicKey, a.mint, a.tokenProgram);
    return this.program.methods
      .withdraw(a.slot)
      .accountsStrict({
        owner: owner.publicKey,
        fund: this.fund,
        session: this.redeemSessionPda(owner.publicKey, nonce),
        asset: a.asset,
        vault: a.vault,
        mint: a.mint,
        ownerToken: getAssociatedTokenAddressSync(a.mint, owner.publicKey, true, a.tokenProgram),
        tokenProgram: a.tokenProgram,
      })
      .signers([owner])
      .rpc();
  }

  async closeRedeem(owner: Keypair, nonce: bigint): Promise<string> {
    return this.program.methods
      .closeRedeem()
      .accountsStrict({ owner: owner.publicKey, session: this.redeemSessionPda(owner.publicKey, nonce) })
      .signers([owner])
      .rpc();
  }

  async startAuction(
    sell: AssetInfo,
    buy: AssetInfo,
    sellAmount: bigint,
    startPrice: bigint,
    endPrice: bigint,
    durationSlots: number,
    rebalancer: Keypair = this.authority,
  ): Promise<{ sig: string; auction: PublicKey; nonce: bigint }> {
    const fund = await this.fetchFund();
    const nonce = big(fund.auctionNonce);
    const auction = this.auctionPda(nonce);
    const sig = await this.program.methods
      .startAuction(bn(sellAmount), bn(startPrice), bn(endPrice), bn(durationSlots))
      .accountsStrict({
        rebalancer: rebalancer.publicKey,
        fund: this.fund,
        sellAsset: sell.asset,
        buyAsset: buy.asset,
        vault: sell.vault,
        auction,
        systemProgram: SystemProgram.programId,
      })
      .signers([rebalancer])
      .rpc();
    return { sig, auction, nonce };
  }

  /** `grossBuy` = buy-token amount the filler sends (null -> exactly the price-implied buy amount). */
  async fillAuction(filler: Keypair, auction: PublicKey, sell: AssetInfo, buy: AssetInfo, sellAmount: bigint, grossBuy: bigint | null = null): Promise<string> {
    await this.ensureAta(filler.publicKey, sell.mint, sell.tokenProgram);
    return this.program.methods
      .fillAuction(bn(sellAmount), grossBuy === null ? null : bn(grossBuy))
      .accountsStrict({
        filler: filler.publicKey,
        fund: this.fund,
        auction,
        sellAsset: sell.asset,
        buyAsset: buy.asset,
        sellVault: sell.vault,
        buyVault: buy.vault,
        fillerSellToken: getAssociatedTokenAddressSync(sell.mint, filler.publicKey, true, sell.tokenProgram),
        fillerBuyToken: getAssociatedTokenAddressSync(buy.mint, filler.publicKey, true, buy.tokenProgram),
        sellMint: sell.mint,
        buyMint: buy.mint,
        sellTokenProgram: sell.tokenProgram,
        buyTokenProgram: buy.tokenProgram,
      })
      .signers([filler])
      .rpc();
  }

  async cancelAuction(signer: Keypair, auction: PublicKey): Promise<string> {
    return this.program.methods
      .cancelAuction()
      .accountsStrict({ signer: signer.publicKey, fund: this.fund, auction })
      .signers([signer])
      .rpc();
  }


  // -- governance / ref prices ----------------------------------------------

  pendingActionPda(nonce: bigint): PublicKey {
    return PublicKey.findProgramAddressSync([PENDING_SEED, this.fund.toBuffer(), le8(nonce)], PROGRAM_ID)[0];
  }

  async setRefPrice(a: AssetInfo, price: bigint, signer: Keypair = this.authority): Promise<string> {
    return this.program.methods
      .setRefPrice(bn(price))
      .accountsStrict({ signer: signer.publicKey, fund: this.fund, asset: a.asset })
      .signers([signer])
      .rpc();
  }

  setRefPriceIx(a: AssetInfo, price: bigint, signer: PublicKey = this.authority.publicKey): Promise<TransactionInstruction> {
    return this.program.methods.setRefPrice(bn(price)).accountsStrict({ signer, fund: this.fund, asset: a.asset }).instruction();
  }

  async queueAction(kind: ActionKind, key: PublicKey, values: (bigint | number)[], authority: Keypair = this.authority): Promise<{ sig: string; action: PublicKey; nonce: bigint }> {
    const fund = await this.fetchFund();
    const nonce = big(fund.actionNonce);
    const action = this.pendingActionPda(nonce);
    const vals = [0, 1, 2, 3].map((i) => bn(values[i] ?? 0)) as [BN, BN, BN, BN];
    const sig = await this.program.methods
      .queueAction(kind, key, vals)
      .accountsStrict({ authority: authority.publicKey, fund: this.fund, action, systemProgram: SystemProgram.programId })
      .signers([authority])
      .rpc();
    return { sig, action, nonce };
  }

  async fetchAction(action: PublicKey) {
    return this.program.account.pendingAction.fetch(action);
  }

  /** execute_action (non add-asset kinds). Pass the asset PDA for weight / ref-price / remove kinds. */
  async executeAction(action: PublicKey, executor: Keypair = this.authority, asset: PublicKey | null = null): Promise<string> {
    const acc = await this.fetchAction(action);
    return this.program.methods
      .executeAction()
      .accountsStrict({ executor: executor.publicKey, fund: this.fund, action, proposer: acc.proposer, asset })
      .signers([executor])
      .rpc();
  }

  async executeActionAddAsset(action: PublicKey, mint: PublicKey, tokenProgram: PublicKey, executor: Keypair = this.authority): Promise<string> {
    const acc = await this.fetchAction(action);
    return this.program.methods
      .executeActionAddAsset()
      .accountsStrict({
        executor: executor.publicKey,
        fund: this.fund,
        action,
        proposer: acc.proposer,
        mint,
        asset: this.assetPda(mint),
        vault: getAssociatedTokenAddressSync(mint, this.fund, true, tokenProgram),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([executor])
      .rpc();
  }

  async cancelAction(action: PublicKey, authority: Keypair = this.authority): Promise<string> {
    const acc = await this.fetchAction(action);
    return this.program.methods
      .cancelAction()
      .accountsStrict({ authority: authority.publicKey, fund: this.fund, action, proposer: acc.proposer })
      .signers([authority])
      .rpc();
  }

  // -- Metaplex token metadata ---------------------------------------------

  tokenMetadataPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), this.indexMint.toBuffer()], TOKEN_METADATA_PROGRAM_ID)[0];
  }

  /** set_token_metadata; pass `action` (a due SetTokenMetadata PendingAction) while the timelock is armed. */
  async setTokenMetadata(name: string, symbol: string, uri: string, opts: { authority?: Keypair; action?: PublicKey } = {}): Promise<string> {
    const authority = opts.authority ?? this.authority;
    const acc = opts.action ? await this.fetchAction(opts.action) : null;
    return this.program.methods
      .setTokenMetadata(name, symbol, uri)
      .accountsStrict({
        authority: authority.publicKey,
        fund: this.fund,
        indexMint: this.indexMint,
        metadata: this.tokenMetadataPda(),
        action: opts.action ?? null,
        proposer: acc?.proposer ?? null,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();
  }

  /** Decoded mpl Metadata (key, update_authority, mint, Data{name,symbol,uri,...}, primary_sale, is_mutable). */
  async readTokenMetadata(): Promise<{ updateAuthority: PublicKey; mint: PublicKey; name: string; symbol: string; uri: string; sellerFeeBasisPoints: number; isMutable: boolean } | null> {
    const info = await this.connection.getAccountInfo(this.tokenMetadataPda());
    if (!info) return null;
    const b = info.data;
    let o = 1;
    const updateAuthority = new PublicKey(b.subarray(o, o + 32));
    o += 32;
    const mint = new PublicKey(b.subarray(o, o + 32));
    o += 32;
    const str = () => {
      const len = b.readUInt32LE(o);
      o += 4;
      const v = b.subarray(o, o + len).toString("utf8").replace(/\0+$/, "");
      o += len;
      return v;
    };
    const name = str();
    const symbol = str();
    const uri = str();
    const sellerFeeBasisPoints = b.readUInt16LE(o);
    o += 2;
    if (b[o] === 1) {
      o += 1;
      o += 4 + b.readUInt32LE(o) * 34;
    } else o += 1;
    o += 1;
    return { updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints, isMutable: b[o] === 1 };
  }

  async setTimelock(slots: bigint | number): Promise<string> {
    return this.program.methods.setTimelock(bn(slots)).accountsStrict({ authority: this.authority.publicKey, fund: this.fund }).rpc();
  }

  // -- bulk helpers for large funds -------------------------------------------

  /** Create n SPL mints (authority = test authority) in batches of 4 per transaction (each mint keypair signs). */
  async createMints(n: number, decimals: number): Promise<PublicKey[]> {
    const lamports = await getMinimumBalanceForRentExemptMint(this.connection);
    const out: PublicKey[] = [];
    for (let i = 0; i < n; i += 4) {
      const kps = Array.from({ length: Math.min(4, n - i) }, () => Keypair.generate());
      const ixs: TransactionInstruction[] = [];
      for (const kp of kps) {
        ixs.push(SystemProgram.createAccount({ fromPubkey: this.authority.publicKey, newAccountPubkey: kp.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }));
        ixs.push(createInitializeMint2Instruction(kp.publicKey, decimals, this.authority.publicKey, null));
      }
      await this.send(ixs, [this.authority, ...kps]);
      out.push(...kps.map((k) => k.publicKey));
    }
    return out;
  }

  /** Create ATAs and mint `amount` of each mint to each owner (5 mints per tx). */
  async mintManyTo(mints: PublicKey[], owners: PublicKey[], amount: bigint): Promise<void> {
    for (const owner of owners) {
      for (let i = 0; i < mints.length; i += 5) {
        const ixs: TransactionInstruction[] = [];
        for (const mint of mints.slice(i, i + 5)) {
          const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
          ixs.push(createAssociatedTokenAccountIdempotentInstruction(this.authority.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID));
          ixs.push(createMintToInstruction(mint, ata, this.authority.publicKey, amount));
        }
        await this.send(ixs);
      }
    }
  }

  addAssetIx(mint: PublicKey, tokenProgram: PublicKey, weightBps: number): Promise<TransactionInstruction> {
    return this.program.methods
      .addAsset(weightBps)
      .accountsStrict({
        authority: this.authority.publicKey,
        fund: this.fund,
        mint,
        asset: this.assetPda(mint),
        vault: getAssociatedTokenAddressSync(mint, this.fund, true, tokenProgram),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** add_asset for many mints (4 per tx), registering them in this.assets. */
  async addAssets(mints: PublicKey[], decimals: number, weightBps: number): Promise<AssetInfo[]> {
    const out: AssetInfo[] = [];
    for (let i = 0; i < mints.length; i += 4) {
      const group = mints.slice(i, i + 4);
      await this.send(await Promise.all(group.map((m) => this.addAssetIx(m, TOKEN_PROGRAM_ID, weightBps))));
      for (const mint of group) {
        const asset = this.assetPda(mint);
        const acc = await this.fetchAsset(asset);
        const info: AssetInfo = { mint, decimals, tokenProgram: TOKEN_PROGRAM_ID, asset, vault: getAssociatedTokenAddressSync(mint, this.fund, true, TOKEN_PROGRAM_ID), slot: acc.index };
        this.assets.push(info);
        out.push(info);
      }
    }
    return out;
  }

  /** Batched seedVault (5 per tx). */
  async seedVaults(assets: AssetInfo[], amount: bigint): Promise<void> {
    for (let i = 0; i < assets.length; i += 5) {
      const ixs = assets.slice(i, i + 5).map((a) =>
        createTransferCheckedInstruction(getAssociatedTokenAddressSync(a.mint, this.authority.publicKey, true, a.tokenProgram), a.mint, a.vault, this.authority.publicKey, amount, a.decimals, [], a.tokenProgram),
      );
      await this.send(ixs);
    }
  }

  /** Batched set_ref_price by the authority (10 per tx). */
  async setRefPrices(assets: AssetInfo[], price: bigint): Promise<void> {
    for (let i = 0; i < assets.length; i += 10) {
      await this.send(await Promise.all(assets.slice(i, i + 10).map((a) => this.setRefPriceIx(a, price))));
    }
  }

  /** Create address lookup table(s) (256 addresses each) holding `addresses`; waits one slot. */
  async createLookupTables(addresses: PublicKey[]): Promise<AddressLookupTableAccount[]> {
    const recent = await this.connection.getSlot("finalized");
    const keys: PublicKey[] = [];
    for (let t = 0; t * 256 < addresses.length; t++) {
      const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority: this.authority.publicKey, payer: this.authority.publicKey, recentSlot: recent - t });
      keys.push(table);
      const chunkAddrs = addresses.slice(t * 256, (t + 1) * 256);
      let first = true;
      for (let i = 0; i < chunkAddrs.length; i += 28) {
        const ext = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: this.authority.publicKey, payer: this.authority.publicKey, addresses: chunkAddrs.slice(i, i + 28) });
        await this.send(first ? [createIx, ext] : [ext]);
        first = false;
      }
    }
    await waitSlots(this.connection, 2);
    const out: AddressLookupTableAccount[] = [];
    for (const k of keys) out.push((await this.connection.getAddressLookupTable(k)).value!);
    return out;
  }

  /** Send a v0 transaction with lookup tables; returns {sig, cu, bytes}. */
  async sendV0(ixs: TransactionInstruction[], signers: Keypair[], tables: AddressLookupTableAccount[]): Promise<{ sig: string; cu: number; bytes: number }> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables);
    const tx = new VersionedTransaction(msg);
    tx.sign(signers);
    const bytes = tx.serialize().length;
    const sig = await this.connection.sendTransaction(tx, { skipPreflight: false });
    const conf = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new Error(`tx failed: ${JSON.stringify(conf.value.err)}`);
    return { sig, cu: await this.txCu(sig), bytes };
  }

  /** Compute units consumed by a confirmed transaction. */
  async txCu(sig: string): Promise<number> {
    const tx = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    return tx?.meta?.computeUnitsConsumed ?? 0;
  }

  /** Slot in which a confirmed transaction landed. */
  async txSlot(sig: string): Promise<bigint> {
    const tx = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) throw new Error("tx not found");
    return BigInt(tx.slot);
  }

  /** Decode anchor events emitted by a transaction. */
  async events(sig: string): Promise<{ name: string; data: any }[]> {
    const tx = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const parser = new anchor.EventParser(this.program.programId, this.program.coder);
    const out: { name: string; data: any }[] = [];
    for (const ev of parser.parseLogs(tx?.meta?.logMessages ?? [])) out.push({ name: ev.name, data: ev.data });
    return out;
  }
}

/** Assert that a promise rejects with the given Anchor error code. */
export async function expectAnchorError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e: any) {
    const err = anchor.AnchorError.parse(e?.logs ?? []) ?? e;
    const got = err?.error?.errorCode?.code ?? e?.error?.errorCode?.code;
    if (got !== code) {
      const msg = String(e?.message ?? e);
      if (!msg.includes(code)) {
        throw new Error(`expected AnchorError ${code}, got ${got ?? msg}`);
      }
    }
    return;
  }
  expect.fail(`expected rejection with ${code}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until at least `n` slots have passed. */
export async function waitSlots(connection: Connection, n: number): Promise<void> {
  const start = await connection.getSlot("confirmed");
  while ((await connection.getSlot("confirmed")) < start + n) await sleep(200);
}
