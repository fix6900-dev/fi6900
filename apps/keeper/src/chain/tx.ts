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

  private async build(ixs: TransactionInstruction[], opts: SendOptions): Promise<VersionedTransaction> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    const all = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.priorityFeeMicroLamports }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 600_000 }),
      ...ixs,
    ];
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: blockhash, instructions: all }).compileToV0Message(
      opts.lookupTables ?? [],
    );
    return new VersionedTransaction(msg);
  }

  async simulate(ixs: TransactionInstruction[], opts: SendOptions = {}): Promise<{ ok: boolean; logs: string[]; err?: string }> {
    const tx = await this.build(ixs, opts);
    const res = await this.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    return { ok: !res.value.err, logs: res.value.logs ?? [], err: res.value.err ? JSON.stringify(res.value.err) : undefined };
  }

  async sendIxs(ixs: TransactionInstruction[], opts: SendOptions = {}): Promise<string> {
    if (ixs.length === 0) throw new Error('no instructions');
    const tx = await this.build(ixs, opts);
    return this.sendVersioned(tx, opts);
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
    const sig = await withRetry(
      () => this.connection.sendTransaction(tx, { skipPreflight: opts.skipPreflight ?? false, maxRetries: 3 }),
      { retries: 2 },
    );
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    const conf = await this.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (conf.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(conf.value.err)}`);
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
