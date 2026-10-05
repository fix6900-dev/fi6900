/**
 * The ONLY module that touches @fi6900/sdk (packages/sdk).
 *
 * Types are imported with `import type` (erased at runtime) and the module itself is loaded with a
 * dynamic import, so MOCK_MODE, the CLI help and the unit tests never need the SDK to be built;
 * a missing/unbuilt SDK surfaces as a clear `SdkUnavailableError` at first chain access.
 *
 * SDK surface used (packages/sdk/src/client.ts, accounts.ts, pricing.ts):
 *   new Fi6900Client(connection, indexMint, { lookupTables? })
 *   readFund/readAssets/readAuctions/readAuction/readSupply/readVaultBalances/readPendingActions
 *   startAuctionIx(rebalancer, sellAsset, buyAsset, amount, startQ64, endQ64, duration) -> {instruction, auction, nonce}
 *   fillAuctionIx(filler, auction, amount, grossBuyAmount?) / fillGrossFor(mint, net) / cancelAuctionIx(signer, auction) / accrueManagementFeeIx()
 *   setRefPriceIx / queueActionIx / executeActionIx / cancelActionIx
 *   initializeFundIx / addAssetIx / setTargetWeightIx / beginRemoveAssetIx / bootstrapMintIx
 *   buildMintTxs(owner, units) / buildRedeemTxs(owner, units) / createFundLookupTable(payer)
 */
import type { AssetAccount, AuctionAccount, Fi6900Client, FundAccount, PendingActionAccount } from '@fi6900/sdk';
import { BorshCoder, EventParser, type Idl } from '@coral-xyz/anchor';
import { PublicKey, type Connection, type TransactionInstruction, type VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { childLogger } from '../util/logger.js';
import { readProgramUpgradeInfo } from './accounts.js';
import {
  ACTION_KIND_NAMES,
  type ActionPayload,
  type AssetState,
  type AuctionFillEvent,
  type AuctionState,
  type AuctionStatus,
  type ChainClient,
  type FundState,
  type LookupTableCreation,
  type PendingActionState,
  type ProgramUpgradeInfo,
  type QueueActionResult,
  type StartAuctionParams,
  type StartAuctionResult,
} from './types.js';

const log = childLogger('chain.sdk');
const SDK_SPECIFIER = '@fi6900/sdk';

type SdkModule = typeof import('@fi6900/sdk');

export class SdkUnavailableError extends Error {
  constructor(msg: string) {
    super(`@fi6900/sdk unavailable: ${msg}`);
    this.name = 'SdkUnavailableError';
  }
}

let sdkPromise: Promise<SdkModule> | undefined;

export async function loadSdk(): Promise<SdkModule> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      let mod: Partial<SdkModule>;
      try {
        mod = (await import(SDK_SPECIFIER)) as SdkModule;
      } catch (err) {
        throw new SdkUnavailableError(`${(err as Error).message} (run: pnpm --filter @fi6900/sdk build)`);
      }
      const required: (keyof SdkModule)[] = ['PROGRAM_ID', 'fundPda', 'Fi6900Client', 'readFund', 'readAssets', 'readAuctions', 'readPendingActions', 'ActionPayloads'];
      const missing = required.filter((k) => mod[k] === undefined);
      if (missing.length) throw new SdkUnavailableError(`missing exports: ${missing.join(', ')}`);
      return mod as SdkModule;
    })();
  }
  return sdkPromise;
}

// ---------- adapters: SDK account structs -> keeper state ----------

const AUCTION_STATUS: readonly AuctionStatus[] = ['open', 'filled', 'cancelled', 'expired'];

export function adaptFund(f: FundAccount): FundState {
  return {
    pda: f.address.toBase58(),
    authority: f.authority.toBase58(),
    pendingAuthority: f.pendingAuthority.toBase58(),
    rebalancer: f.rebalancer.toBase58(),
    feeRecipient: f.feeRecipient.toBase58(),
    indexMint: f.indexMint.toBase58(),
    bump: f.bump,
    assetCount: f.assetCount,
    activeBitmap: f.activeBitmap,
    mintFeeBps: f.mintFeeBps,
    redeemFeeBps: f.redeemFeeBps,
    mgmtFeeBps: f.mgmtFeeBps,
    lastFeeAccrualTs: Number(f.lastFeeAccrualTs),
    epoch: f.epoch,
    openAuctions: f.openAuctions,
    paused: f.paused,
    auctionNonce: f.auctionNonce,
    maxAuctionDiscountBps: f.maxAuctionDiscountBps,
    maxRefMoveBps: f.maxRefMoveBps,
    refMovePeriodSlots: f.refMovePeriodSlots,
    timelockSlots: f.timelockSlots,
    actionNonce: f.actionNonce,
  };
}

export function adaptAsset(a: AssetAccount, vaultAmount: bigint): AssetState {
  return {
    pda: a.address.toBase58(),
    fund: a.fund.toBase58(),
    mint: a.mint.toBase58(),
    vault: a.vault.toBase58(),
    tokenProgram: a.tokenProgram.toBase58(),
    index: a.index,
    status: a.status === 1 ? 'removing' : 'active',
    decimals: a.decimals,
    targetWeightBps: a.targetWeightBps,
    pendingDeposits: a.pendingDeposits,
    pendingWithdrawals: a.pendingWithdrawals,
    vaultAmount,
    refPrice: a.refPrice,
    refPriceUpdatedSlot: a.refPriceUpdatedSlot,
    refPriceAnchor: a.refPriceAnchor,
    refPriceAnchorSlot: a.refPriceAnchorSlot,
  };
}

export function adaptAuction(a: AuctionAccount, assetsByPda: ReadonlyMap<string, AssetState>): AuctionState {
  const sellAsset = a.sellAsset.toBase58();
  const buyAsset = a.buyAsset.toBase58();
  return {
    pda: a.address.toBase58(),
    fund: a.fund.toBase58(),
    sellAsset,
    buyAsset,
    sellMint: assetsByPda.get(sellAsset)?.mint ?? PublicKey.default.toBase58(),
    buyMint: assetsByPda.get(buyAsset)?.mint ?? PublicKey.default.toBase58(),
    sellRemaining: a.sellRemaining,
    sellTotal: a.sellTotal,
    startPrice: a.startPrice,
    endPrice: a.endPrice,
    startSlot: a.startSlot,
    endSlot: a.endSlot,
    boughtTotal: a.boughtTotal,
    status: AUCTION_STATUS[a.status] ?? 'open',
    nonce: a.nonce,
  };
}

export function adaptPendingAction(p: PendingActionAccount): PendingActionState {
  return {
    pda: p.address.toBase58(),
    fund: p.fund.toBase58(),
    nonce: p.nonce,
    kind: p.kind,
    kindName: ACTION_KIND_NAMES[p.kind] ?? `kind_${p.kind}`,
    proposer: p.proposer.toBase58(),
    queuedSlot: p.queuedSlot,
    etaSlot: p.etaSlot,
    key: p.key.toBase58(),
    values: p.values,
  };
}

/** Linear Dutch-auction price at `slot` (Q64.64). Mirrors on-chain `fill_auction` and the SDK's `auctionPriceAt`. */
export function auctionPriceAt(a: Pick<AuctionState, 'startPrice' | 'endPrice' | 'startSlot' | 'endSlot'>, slot: bigint): bigint {
  if (slot <= a.startSlot) return a.startPrice;
  if (slot >= a.endSlot) return a.endPrice;
  const duration = a.endSlot - a.startSlot;
  if (duration <= 0n) return a.endPrice;
  return a.startPrice - ((a.startPrice - a.endPrice) * (slot - a.startSlot)) / duration;
}

// ---------- client ----------

export interface SdkChainClientOptions {
  lookupTable?: PublicKey;
  lookupTables?: PublicKey[];
}

export class SdkChainClient implements ChainClient {
  private assetCache: { at: number; assets: AssetState[]; raw: AssetAccount[] } | undefined;

  private constructor(
    private readonly sdk: SdkModule,
    private readonly connection: Connection,
    private readonly client: Fi6900Client,
    readonly indexMint: PublicKey,
    readonly fundPda: PublicKey,
    private readonly lookupTables: PublicKey[],
  ) {}

  static async create(connection: Connection, indexMint: PublicKey, opts: SdkChainClientOptions = {}): Promise<SdkChainClient> {
    const sdk = await loadSdk();
    const tables = [...(opts.lookupTables ?? []), ...(opts.lookupTable ? [opts.lookupTable] : [])];
    const client = new sdk.Fi6900Client(connection, indexMint, { lookupTables: tables });
    log.info({ programId: client.programId.toBase58(), fund: client.fund.toBase58(), lut: tables.map((t) => t.toBase58()) }, 'sdk loaded');
    return new SdkChainClient(sdk, connection, client, indexMint, client.fund, tables);
  }

  get programId(): string {
    return this.client.programId.toBase58();
  }

  async readFund(): Promise<FundState> {
    return adaptFund(await this.client.readFund());
  }

  private async rawAssets(maxAgeMs = 2_000): Promise<{ assets: AssetState[]; raw: AssetAccount[] }> {
    if (this.assetCache && Date.now() - this.assetCache.at < maxAgeMs) return this.assetCache;
    const raw = await this.client.readAssets();
    const balances = await this.client.readVaultBalances(raw);
    const assets = raw.map((a, i) => adaptAsset(a, balances[i] ?? 0n)).sort((a, b) => a.index - b.index);
    this.assetCache = { at: Date.now(), assets, raw };
    return this.assetCache;
  }

  async readAssets(): Promise<AssetState[]> {
    return (await this.rawAssets(0)).assets;
  }

  async readAuctions(status: 'open' | 'all' = 'all'): Promise<AuctionState[]> {
    const [raws, { assets }] = await Promise.all([this.client.readAuctions(status === 'open' ? 0 : undefined), this.rawAssets()]);
    const byPda = new Map(assets.map((a) => [a.pda, a]));
    return raws.map((r) => adaptAuction(r, byPda));
  }

  /** Decodes `AuctionFilled` events from the auction PDA's recent transactions. */
  async getAuctionFills(auctionPda: string, limit = 50): Promise<AuctionFillEvent[]> {
    const pda = new PublicKey(auctionPda);
    const sigs = await this.connection.getSignaturesForAddress(pda, { limit });
    if (sigs.length === 0) return [];
    const parser = new EventParser(this.client.programId, new BorshCoder(this.sdk.IDL as unknown as Idl));
    const out: AuctionFillEvent[] = [];
    const txs = await this.connection.getTransactions(
      sigs.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    );
    txs.forEach((tx, i) => {
      const sig = sigs[i]?.signature;
      if (!tx || !sig || !tx.meta?.logMessages) return;
      for (const ev of parser.parseLogs(tx.meta.logMessages)) {
        if (ev.name !== 'auctionFilled' && ev.name !== 'AuctionFilled') continue;
        const d = ev.data as Record<string, { toString(): string } | PublicKey>;
        // Anchor's BorshCoder keeps the IDL's snake_case field names; older builds camelCased them.
        const field = (camel: string): { toString(): string } | PublicKey | undefined => d[camel] ?? d[camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
        const big = (k: string): bigint => BigInt(field(k)?.toString() ?? '0');
        const auction = d.auction instanceof PublicKey ? d.auction.toBase58() : auctionPda;
        if (auction !== auctionPda) continue;
        out.push({
          sig,
          auctionPda,
          filler: d.filler instanceof PublicKey ? d.filler.toBase58() : String(d.filler ?? 'unknown'),
          sellAmount: big('sellAmount'),
          buyAmount: big('buyAmount'),
          price: big('price'),
          slot: tx.slot,
        });
      }
    });
    return out.sort((a, b) => a.slot - b.slot);
  }

  async getIndexSupply(): Promise<bigint> {
    return this.client.readSupply();
  }

  async getLookupTable(): Promise<string | null> {
    return this.lookupTables[0]?.toBase58() ?? null;
  }

  async getCurrentSlot(): Promise<bigint> {
    return BigInt(await this.connection.getSlot('confirmed'));
  }

  async getProgramUpgradeInfo(): Promise<ProgramUpgradeInfo> {
    return readProgramUpgradeInfo(this.connection, this.client.programId);
  }

  async buildMintTxs(units: bigint, owner: PublicKey): Promise<VersionedTransaction[]> {
    return this.client.buildMintTxs(owner, units, { lookupTables: this.lookupTables });
  }

  async buildRedeemTxs(units: bigint, owner: PublicKey): Promise<VersionedTransaction[]> {
    return this.client.buildRedeemTxs(owner, units, { lookupTables: this.lookupTables });
  }

  private async findRawAsset(mint: PublicKey): Promise<AssetAccount> {
    const { raw } = await this.rawAssets();
    const a = raw.find((x) => x.mint.equals(mint));
    if (!a) throw new Error(`asset ${mint.toBase58()} not in fund`);
    return a;
  }

  async startAuction(p: StartAuctionParams, rebalancer: PublicKey): Promise<StartAuctionResult> {
    const [sell, buy] = await Promise.all([this.findRawAsset(p.sellMint), this.findRawAsset(p.buyMint)]);
    const r = await this.client.startAuctionIx(rebalancer, sell, buy, p.sellAmount, p.startPrice, p.endPrice, p.durationSlots);
    return { ixs: [r.instruction], auctionPda: r.auction.toBase58(), nonce: r.nonce };
  }

  async fillAuctionIx(auctionPda: PublicKey, sellAmount: bigint, filler: PublicKey, grossBuyAmount?: bigint | null): Promise<TransactionInstruction[]> {
    const auction = await this.client.readAuction(auctionPda);
    const { raw } = await this.rawAssets();
    const sellAsset = raw.find((a) => a.address.equals(auction.sellAsset));
    const buyAsset = raw.find((a) => a.address.equals(auction.buyAsset));
    if (!sellAsset || !buyAsset) throw new Error('auction assets not found');
    // The filler receives sell-token: make sure its ATA exists.
    const fillerSellToken = getAssociatedTokenAddressSync(sellAsset.mint, filler, false, sellAsset.tokenProgram);
    const ata = createAssociatedTokenAccountIdempotentInstruction(filler, fillerSellToken, filler, sellAsset.mint, sellAsset.tokenProgram);
    const fill = await this.client.fillAuctionIx(filler, auction, sellAmount, { sellAsset, buyAsset, fillerSellToken, grossBuyAmount: grossBuyAmount ?? null });
    return [ata, fill];
  }

  async fillGrossFor(mint: PublicKey, net: bigint): Promise<bigint> {
    const { raw } = await this.rawAssets();
    const asset = raw.find((a) => a.mint.equals(mint));
    if (!asset) return net;
    return this.client.fillGrossFor(asset, net);
  }

  async cancelAuctionIx(auctionPda: PublicKey, signer: PublicKey): Promise<TransactionInstruction[]> {
    return [await this.client.cancelAuctionIx(signer, auctionPda)];
  }

  async accrueManagementFeeIx(): Promise<TransactionInstruction[]> {
    return [await this.client.accrueManagementFeeIx()];
  }

  // ---------- governance ----------

  async setRefPriceIx(mint: PublicKey, refPriceQ64: bigint, signer: PublicKey): Promise<TransactionInstruction[]> {
    this.assetCache = undefined;
    return [await this.client.setRefPriceIx(signer, mint, refPriceQ64)];
  }

  async readPendingActions(): Promise<PendingActionState[]> {
    return (await this.client.readPendingActions()).map(adaptPendingAction);
  }

  async queueActionIx(payload: ActionPayload, authority: PublicKey): Promise<QueueActionResult> {
    const r = await this.client.queueActionIx(authority, { kind: payload.kind, key: new PublicKey(payload.key), values: payload.values });
    return { ixs: [r.instruction], actionPda: r.action.toBase58(), nonce: r.nonce };
  }

  async executeActionIx(actionPda: PublicKey, executor: PublicKey): Promise<TransactionInstruction[]> {
    const action = await this.client.readPendingAction(actionPda);
    if (!action) throw new Error(`pending action ${actionPda.toBase58()} not found (already executed or cancelled)`);
    this.assetCache = undefined;
    return [await this.client.executeActionIx(executor, action)];
  }

  async cancelActionIx(actionPda: PublicKey, authority: PublicKey): Promise<TransactionInstruction[]> {
    const action = await this.client.readPendingAction(actionPda);
    if (!action) throw new Error(`pending action ${actionPda.toBase58()} not found`);
    return [await this.client.cancelActionIx(authority, action)];
  }

  // ---------- admin / launch ----------

  async initializeFundIx(
    authority: PublicKey,
    fees: { mintFeeBps: number; redeemFeeBps: number; mgmtFeeBps: number },
    timelockSlots = 0n,
  ): Promise<TransactionInstruction[]> {
    return [await this.client.initializeFundIx(authority, fees.mintFeeBps, fees.redeemFeeBps, fees.mgmtFeeBps, timelockSlots)];
  }

  async addAssetIx(mint: PublicKey, targetWeightBps: number, authority: PublicKey): Promise<TransactionInstruction[]> {
    const info = await this.connection.getAccountInfo(mint);
    const tokenProgram = info?.owner ?? TOKEN_PROGRAM_ID;
    this.assetCache = undefined;
    return [await this.client.addAssetIx(authority, mint, targetWeightBps, tokenProgram)];
  }

  async setTargetWeightIx(mint: PublicKey, bps: number, authority: PublicKey): Promise<TransactionInstruction[]> {
    this.assetCache = undefined;
    return [await this.client.setTargetWeightIx(authority, mint, bps)];
  }

  async beginRemoveAssetIx(mint: PublicKey, authority: PublicKey): Promise<TransactionInstruction[]> {
    this.assetCache = undefined;
    return [await this.client.beginRemoveAssetIx(authority, mint)];
  }

  async bootstrapMintIx(units: bigint, authority: PublicKey): Promise<TransactionInstruction[]> {
    const ata = getAssociatedTokenAddressSync(this.indexMint, authority, false, TOKEN_PROGRAM_ID);
    return [
      createAssociatedTokenAccountIdempotentInstruction(authority, ata, authority, this.indexMint, TOKEN_PROGRAM_ID),
      await this.client.bootstrapMintIx(authority, units, ata),
    ];
  }

  async createFundLookupTable(payer: PublicKey): Promise<LookupTableCreation> {
    const plan = await this.client.createFundLookupTable(payer, payer);
    return { address: plan.lookupTable, lookupTables: plan.lookupTables, instructionGroups: plan.instructionGroups, addresses: plan.addresses.length };
  }
}
