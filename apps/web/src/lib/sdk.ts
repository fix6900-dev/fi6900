"use client";

/**
 * SDK adapter. Thin wrapper over @fi6900/sdk (ARCHITECTURE §6) exposing the small surface the
 * UI needs, with the fund's address lookup table resolved from env or the keeper's /v1/verify.
 */

import { PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { Fi6900Client as RawClient, PROGRAM_ID } from "@fi6900/sdk";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { env } from "./env";

/* ----------------------------- UI-facing interface ----------------------------- */

export interface Fi6900Client {
  raw: RawClient;
  readFund(): Promise<unknown>;
  readAssets(): Promise<unknown[]>;
  readAuctions(): Promise<unknown[]>;
  /** Ordered: [begin_mint, deposit batch 1..N (ALT), finalize_mint] */
  buildMintTxs(units: bigint | number): Promise<VersionedTransaction[]>;
  /** Ordered: [begin_redeem, withdraw batch 1..N (ALT), close_redeem] */
  buildRedeemTxs(units: bigint | number): Promise<VersionedTransaction[]>;
  fillAuction(auction: PublicKey, sellAmount: bigint | number): Promise<VersionedTransaction>;
}

export interface WalletLike {
  publicKey: PublicKey | null;
  signTransaction?: <T extends VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: <T extends VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

export class SdkUnavailableError extends Error {
  constructor(msg = "The index mint is not configured (NEXT_PUBLIC_INDEX_MINT), so transactions cannot be constructed.") {
    super(msg);
    this.name = "SdkUnavailableError";
  }
}

let lookupTableCache: Promise<PublicKey | undefined> | null = null;

/** Lookup table from env, else from the keeper's /v1/verify. Cached for the page lifetime. */
async function resolveLookupTable(): Promise<PublicKey | undefined> {
  if (!lookupTableCache) {
    lookupTableCache = (async () => {
      const fromEnv = process.env.NEXT_PUBLIC_LOOKUP_TABLE;
      if (fromEnv) return new PublicKey(fromEnv);
      try {
        const res = await fetch(`${env.apiUrl}/v1/verify`, { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; data?: { lookupTable?: string | null } };
        const lt = json?.data?.lookupTable;
        return lt ? new PublicKey(lt) : undefined;
      } catch {
        return undefined;
      }
    })();
  }
  return lookupTableCache;
}

export async function createClient(args: {
  connection: Connection;
  wallet: WalletLike;
  programId?: PublicKey;
  indexMint?: PublicKey;
  lookupTable?: PublicKey;
}): Promise<Fi6900Client> {
  const { connection, wallet } = args;
  const indexMint = args.indexMint ?? (env.indexMint ? new PublicKey(env.indexMint) : undefined);
  if (!indexMint) throw new SdkUnavailableError();
  const programId = args.programId ?? (env.programId ? new PublicKey(env.programId) : PROGRAM_ID);
  const lookupTable = args.lookupTable ?? (await resolveLookupTable());
  const raw = new RawClient(connection, indexMint, { programId, lookupTable });

  const owner = () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    return wallet.publicKey;
  };

  return {
    raw,
    readFund: () => raw.readFund(),
    readAssets: () => raw.readAssets(),
    readAuctions: () => raw.readAuctions(),
    buildMintTxs: (units) => raw.buildMintTxs(owner(), units),
    buildRedeemTxs: (units) => raw.buildRedeemTxs(owner(), units),
    async fillAuction(auction, sellAmount) {
      const filler = owner();
      const acct = await raw.readAuction(auction);
      const assets = await raw.readAssets();
      const sellAsset = assets.find((a) => a.address.equals(acct.sellAsset));
      if (!sellAsset) throw new Error("Auction sell asset not found");
      // The filler receives the vault's sell token; make sure their ATA exists.
      const receiveAta = raw.assetAta(filler, sellAsset);
      const createAta = createAssociatedTokenAccountIdempotentInstruction(filler, receiveAta, filler, sellAsset.mint, sellAsset.tokenProgram);
      const ix = await raw.fillAuctionIx(filler, acct, sellAmount, { sellAsset });
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: filler, recentBlockhash: blockhash, instructions: [createAta, ix] }).compileToV0Message();
      return new VersionedTransaction(msg);
    },
  };
}

/* -------------------------- tx pipeline runner -------------------------- */

export type TxStepStatus = "idle" | "signing" | "sending" | "confirming" | "confirmed" | "failed";
export interface TxStep {
  id: string;
  label: string;
  status: TxStepStatus;
  signature?: string;
  error?: string;
}

export interface RunOptions {
  connection: Connection;
  wallet: WalletLike;
  txs: VersionedTransaction[];
  labels: string[];
  onUpdate: (steps: TxStep[]) => void;
  /** Resume from this index (used by "retry") */
  startAt?: number;
  initial?: TxStep[];
}

/** Signs and sends an ordered list of transactions, reporting progress per step. */
export async function runTxPipeline(opts: RunOptions): Promise<TxStep[]> {
  const { connection, wallet, txs, labels, onUpdate } = opts;
  if (!wallet.signTransaction) throw new Error("Wallet does not support signTransaction");
  const steps: TxStep[] = opts.initial ?? labels.map((label, i) => ({ id: String(i), label, status: "idle" }));
  const emit = () => onUpdate(steps.map((s) => ({ ...s })));
  emit();
  for (let i = opts.startAt ?? 0; i < txs.length; i++) {
    const step = steps[i];
    try {
      step.status = "signing";
      step.error = undefined;
      emit();
      const signed = await wallet.signTransaction(txs[i]);
      step.status = "sending";
      emit();
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      step.signature = sig;
      step.status = "confirming";
      emit();
      const bh = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
      step.status = "confirmed";
      emit();
    } catch (e) {
      step.status = "failed";
      step.error = e instanceof Error ? e.message : String(e);
      emit();
      throw e;
    }
  }
  return steps;
}
