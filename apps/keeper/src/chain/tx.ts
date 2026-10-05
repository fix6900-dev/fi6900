/** Transaction sending with DRY_RUN support, priority fees and confirmation. */
import {
  ComputeBudgetProgram,
  PublicKey,
  type Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from '@solana/web3.js';
import { childLogger } from '../util/logger.js';
import { withRetry } from '../util/retry.js';

const log = childLogger('chain.tx');

export const DRY_RUN_SIG = 'dry-run';

export interface SendOptions {
  /** Extra signers besides the payer. */
  signers?: Keypair[];
  lookupTables?: AddressLookupTableAccount[];
  computeUnits?: number;
  skipPreflight?: boolean;
  label?: string;
}

export interface TxSender {
  readonly dryRun: boolean;
  readonly payer: PublicKey;
  sendIxs(ixs: TransactionInstruction[], opts?: SendOptions): Promise<string>;
  /** Signs with payer (+ signers) and sends a pre-built versioned tx. */
  sendVersioned(tx: VersionedTransaction, opts?: SendOptions): Promise<string>;
  sendMany(txs: VersionedTransaction[], opts?: SendOptions): Promise<string[]>;
  /** Legacy Transaction support (some third-party SDKs still return these). */
  sendLegacy(tx: Transaction, opts?: SendOptions): Promise<string>;
  simulate(ixs: TransactionInstruction[], opts?: SendOptions): Promise<{ ok: boolean; logs: string[]; err?: string }>;
}

/** A session nonce for mint/redeem sessions (unique per run; fits the program's u64). */
export function sessionNonce(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

/**
 * Sends an ordered multi-transaction session (begin → deposits/withdraws → finalize/close) one step at a time,
 * rebuilding the whole list before every step so each transaction carries a fresh blockhash. A pre-built list
 * shares one blockhash and the later steps expire while the earlier ones confirm on a busy network.
 */
export async function sendSession(
  tx: TxSender,
  build: () => Promise<VersionedTransaction[]>,
  opts: SendOptions = {},
): Promise<string[]> {
  const sigs: string[] = [];
  const first = await build();
  const n = first.length;
  for (let i = 0; i < n; i++) {
    const txs = i === 0 ? first : await build();
    const step = txs[i];
    if (!step) throw new Error(`session rebuild returned ${txs.length} txs, expected ${n}`);
    sigs.push(await tx.sendVersioned(step, { ...opts, label: `${opts.label ?? 'session'} ${i + 1}/${n}` }));
  }
  return sigs;
}

export class TxExpiredError extends Error {
  constructor(readonly sig: string) {
    super(`Signature ${sig} expired: block height exceeded`);
    this.name = 'TxExpiredError';
  }
}

export class RpcTxSender implements TxSender {
  constructor(
    private readonly connection: Connection,
    private readonly keypair: Keypair,
    readonly dryRun: boolean,
    private readonly priorityFeeMicroLamports: number,
  ) {}

  get payer(): PublicKey {
    return this.keypair.publicKey;
  }

  private async build(ixs: TransactionInstruction[], opts: SendOptions): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number }> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const all = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.priorityFeeMicroLamports }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 600_000 }),
      ...ixs,
    ];
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: blockhash, instructions: all }).compileToV0Message(
      opts.lookupTables ?? [],
    );
    return { tx: new VersionedTransaction(msg), lastValidBlockHeight };
  }

  /**
   * Sends a signed tx and rebroadcasts it every ~2 s until it is confirmed or the chain has moved past
   * `lastValidBlockHeight` (then the signature can never land and the caller may rebuild with a fresh blockhash).
   */
  private async sendAndConfirm(tx: VersionedTransaction, lastValidBlockHeight: number, opts: SendOptions): Promise<string> {
    const raw = tx.serialize();
    const sig = await withRetry(
      () => this.connection.sendRawTransaction(raw, { skipPreflight: opts.skipPreflight ?? false, maxRetries: 0 }),
      { retries: 2 },
    );
    const started = Date.now();
    for (;;) {
      const st = (await this.connection.getSignatureStatuses([sig])).value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        if (st.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.err)}`);
        return sig;
      }
      const height = await this.connection.getBlockHeight('confirmed');
      if (height > lastValidBlockHeight) throw new TxExpiredError(sig);
      if (Date.now() - started > 120_000) throw new TxExpiredError(sig);
      // rebroadcast: validators drop low-priority txs under load, so keep re-sending the same signature
      await this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async simulate(ixs: TransactionInstruction[], opts: SendOptions = {}): Promise<{ ok: boolean; logs: string[]; err?: string }> {
    const { tx } = await this.build(ixs, opts);
    const res = await this.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    return { ok: !res.value.err, logs: res.value.logs ?? [], err: res.value.err ? JSON.stringify(res.value.err) : undefined };
  }

  async sendIxs(ixs: TransactionInstruction[], opts: SendOptions = {}): Promise<string> {
    if (ixs.length === 0) throw new Error('no instructions');
    if (this.dryRun) {
      const { tx } = await this.build(ixs, opts);
      return this.sendVersioned(tx, opts);
    }
    // Rebuild with a fresh blockhash each time the previous one provably expired.
    for (let attempt = 1; ; attempt++) {
      const { tx, lastValidBlockHeight } = await this.build(ixs, opts);
      tx.sign([this.keypair, ...(opts.signers ?? [])]);
      try {
        const sig = await this.sendAndConfirm(tx, lastValidBlockHeight, opts);
        log.info({ label: opts.label, sig, attempt }, 'tx confirmed');
        return sig;
      } catch (e) {
        if (e instanceof TxExpiredError && attempt < 4) {
          log.warn({ label: opts.label, sig: e.sig, attempt }, 'tx expired without landing; rebuilding with a fresh blockhash');
          continue;
        }
        throw e;
      }
    }
  }

  async sendVersioned(tx: VersionedTransaction, opts: SendOptions = {}): Promise<string> {
    if (this.dryRun) {
      const sim = await this.connection
        .simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
        .catch((e: Error) => ({ value: { err: e.message, logs: [] as string[] } }));
      log.info({ label: opts.label, ok: !sim.value.err, err: sim.value.err ?? undefined }, 'DRY_RUN: simulated instead of sending');
      return DRY_RUN_SIG;
    }
    tx.sign([this.keypair, ...(opts.signers ?? [])]);
    // Pre-built tx: we cannot rebuild it, so confirm against the blockhash it carries.
    const lastValid = (await this.connection.getLatestBlockhash('confirmed')).lastValidBlockHeight;
    const sig = await this.sendAndConfirm(tx, lastValid, opts);
    log.info({ label: opts.label, sig }, 'tx confirmed');
    return sig;
  }

  async sendMany(txs: VersionedTransaction[], opts: SendOptions = {}): Promise<string[]> {
    const sigs: string[] = [];
    for (const tx of txs) sigs.push(await this.sendVersioned(tx, opts));
    return sigs;
  }

  async sendLegacy(tx: Transaction, opts: SendOptions = {}): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.payer;
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message(opts.lookupTables ?? []);
    return this.sendVersioned(new VersionedTransaction(msg), opts);
  }
}
