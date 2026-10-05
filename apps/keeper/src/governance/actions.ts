/**
 * Timelocked admin actions: queue (authority), execute when due (anyone), cancel (authority),
 * and the merged on-chain + local view served by GET /v1/governance.
 */
import { PublicKey } from '@solana/web3.js';
import { ACTION_KIND_NAMES, ActionKind, type ActionPayload, type ChainClient, type PendingActionState } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { Repo } from '../db/repo.js';
import { childLogger } from '../util/logger.js';

const log = childLogger('governance');

const DEFAULT_KEY = PublicKey.default.toBase58();
const v4 = (a: bigint | number = 0, b: bigint | number = 0, c: bigint | number = 0, d: bigint | number = 0): [bigint, bigint, bigint, bigint] => [BigInt(a), BigInt(b), BigInt(c), BigInt(d)];

/** Payload builders (mirror the SDK's ActionPayloads). */
export const payloads = {
  setFees: (mintFeeBps: number, redeemFeeBps: number, mgmtFeeBps: number): ActionPayload => ({ kind: ActionKind.SetFees, key: DEFAULT_KEY, values: v4(mintFeeBps, redeemFeeBps, mgmtFeeBps) }),
  setTargetWeight: (mint: string, bps: number): ActionPayload => ({ kind: ActionKind.SetTargetWeight, key: mint, values: v4(bps) }),
  setRebalancer: (rebalancer: string): ActionPayload => ({ kind: ActionKind.SetRebalancer, key: rebalancer, values: v4() }),
  setFeeRecipient: (recipient: string): ActionPayload => ({ kind: ActionKind.SetFeeRecipient, key: recipient, values: v4() }),
  refPriceOverride: (mint: string, refPriceQ64: bigint): ActionPayload => ({ kind: ActionKind.RefPriceOverride, key: mint, values: v4(refPriceQ64 & ((1n << 64n) - 1n), refPriceQ64 >> 64n) }),
  setMaxAuctionDiscount: (bps: number): ActionPayload => ({ kind: ActionKind.SetMaxAuctionDiscount, key: DEFAULT_KEY, values: v4(bps) }),
  setTimelock: (slots: bigint | number): ActionPayload => ({ kind: ActionKind.SetTimelock, key: DEFAULT_KEY, values: v4(slots) }),
  addAsset: (mint: string, weightBps: number): ActionPayload => ({ kind: ActionKind.AddAsset, key: mint, values: v4(weightBps) }),
  beginRemoveAsset: (mint: string): ActionPayload => ({ kind: ActionKind.BeginRemoveAsset, key: mint, values: v4() }),
  setRefMovePolicy: (maxRefMoveBps: number, periodSlots: bigint | number): ActionPayload => ({ kind: ActionKind.SetRefMovePolicy, key: DEFAULT_KEY, values: v4(maxRefMoveBps, periodSlots) }),
};

/** Human-readable payload for logs / API. */
export function describePayload(kind: number, key: string, values: readonly bigint[]): Record<string, unknown> {
  switch (kind) {
    case ActionKind.SetFees:
      return { mintFeeBps: Number(values[0]), redeemFeeBps: Number(values[1]), mgmtFeeBps: Number(values[2]) };
    case ActionKind.SetTargetWeight:
      return { mint: key, targetWeightBps: Number(values[0]) };
    case ActionKind.SetRebalancer:
      return { rebalancer: key };
    case ActionKind.SetFeeRecipient:
      return { feeRecipient: key };
    case ActionKind.RefPriceOverride:
      return { mint: key, refPrice: ((values[0] ?? 0n) | ((values[1] ?? 0n) << 64n)).toString() };
    case ActionKind.SetMaxAuctionDiscount:
      return { maxAuctionDiscountBps: Number(values[0]) };
    case ActionKind.SetTimelock:
      return { timelockSlots: (values[0] ?? 0n).toString() };
    case ActionKind.AddAsset:
      return { mint: key, targetWeightBps: Number(values[0]) };
    case ActionKind.BeginRemoveAsset:
      return { mint: key };
    case ActionKind.SetRefMovePolicy:
      return { maxRefMoveBps: Number(values[0]), refMovePeriodSlots: (values[1] ?? 0n).toString() };
    default:
      return { key, values: values.map((v) => v.toString()) };
  }
}

export interface GovernanceDeps {
  chain: ChainClient;
  tx: TxSender;
  repo: Repo;
  env: Env;
}

export interface PendingActionView {
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

export interface QueueResult {
  pda: string;
  sig: string;
  etaSlot: bigint;
}

export class GovernanceService {
  constructor(private readonly d: GovernanceDeps) {}

  /** Queue a timelocked action. The keeper must be the fund authority. */
  async queue(payload: ActionPayload, label: string, opts: { dry?: boolean } = {}): Promise<QueueResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const fund = await this.d.chain.readFund();
    const auth = this.d.tx.payer;
    if (fund.authority !== auth.toBase58()) {
      throw new Error(`keeper ${auth.toBase58()} is not the fund authority (${fund.authority}); queue this action from the multisig: ${ACTION_KIND_NAMES[payload.kind]} ${JSON.stringify(describePayload(payload.kind, payload.key, payload.values))}`);
    }
    const r = await this.d.chain.queueActionIx(payload, auth);
    const sig = await this.d.tx.sendIxs(r.ixs, { label: `queue_action ${label}` });
    const slot = await this.d.chain.getCurrentSlot();
    const eta = slot + fund.timelockSlots;
    if (sig !== DRY_RUN_SIG) {
      this.d.repo.governance.insertGovernanceAction({ pda: r.actionPda, nonce: r.nonce, kind: payload.kind, payload: { key: payload.key, values: payload.values }, etaSlot: eta, proposer: auth.toBase58(), queuedSig: sig, label });
    }
    log.info({ pda: r.actionPda, kind: ACTION_KIND_NAMES[payload.kind], payload: describePayload(payload.kind, payload.key, payload.values), eta: eta.toString(), timelockSlots: fund.timelockSlots.toString(), sig, dry }, 'action queued');
    return { pda: dry ? `dry-${r.actionPda}` : r.actionPda, sig, etaSlot: eta };
  }

  /** Execute every pending action whose eta has passed. Anyone may execute; the keeper does it on a schedule. */
  async executeDue(opts: { dry?: boolean } = {}): Promise<{ executed: string[]; waiting: number; failed: string[] }> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const [pending, slot] = await Promise.all([this.d.chain.readPendingActions(), this.d.chain.getCurrentSlot()]);
    const out = { executed: [] as string[], waiting: 0, failed: [] as string[] };
    this.reconcileLocal(pending);
    for (const a of pending) {
      if (a.etaSlot > slot) {
        out.waiting++;
        continue;
      }
      try {
        const ixs = await this.d.chain.executeActionIx(new PublicKey(a.pda), this.d.tx.payer);
        const sig = await this.d.tx.sendIxs(ixs, { label: `execute_action ${a.kindName} ${a.pda}` });
        if (!dry) this.d.repo.governance.setGovernanceActionStatus(a.pda, 'executed', sig);
        out.executed.push(a.pda);
        log.info({ pda: a.pda, kind: a.kindName, payload: describePayload(a.kind, a.key, a.values), sig }, 'action executed');
      } catch (err) {
        out.failed.push(a.pda);
        log.error({ pda: a.pda, kind: a.kindName, err: (err as Error).message }, 'execute_action failed');
      }
    }
    return out;
  }

  async cancel(pda: string): Promise<string> {
    const ixs = await this.d.chain.cancelActionIx(new PublicKey(pda), this.d.tx.payer);
    const sig = await this.d.tx.sendIxs(ixs, { label: `cancel_action ${pda}` });
    if (sig !== DRY_RUN_SIG) this.d.repo.governance.setGovernanceActionStatus(pda, 'cancelled', sig);
    return sig;
  }

  /** On-chain pending actions enriched with the local queued signature. */
  async pending(): Promise<PendingActionView[]> {
    const [pending, slot] = await Promise.all([this.d.chain.readPendingActions(), this.d.chain.getCurrentSlot()]);
    this.reconcileLocal(pending);
    return pending.map((a) => ({
      pda: a.pda,
      nonce: a.nonce.toString(),
      kind: a.kind,
      kindName: a.kindName,
      payload: describePayload(a.kind, a.key, a.values),
      etaSlot: a.etaSlot.toString(),
      queuedSlot: a.queuedSlot.toString(),
      proposer: a.proposer,
      queuedSig: this.d.repo.governance.governanceAction(a.pda)?.queued_sig ?? null,
      due: a.etaSlot <= slot,
    }));
  }

  /** Mark locally-queued rows whose PDA disappeared (executed or cancelled by someone else). */
  private reconcileLocal(onchain: readonly PendingActionState[]): void {
    const live = new Set(onchain.map((a) => a.pda));
    for (const row of this.d.repo.governance.governanceActions('queued')) {
      if (!live.has(row.pda)) this.d.repo.governance.setGovernanceActionStatus(row.pda, 'executed', null);
    }
    for (const a of onchain) {
      if (!this.d.repo.governance.governanceAction(a.pda)) {
        this.d.repo.governance.insertGovernanceAction({ pda: a.pda, nonce: a.nonce, kind: a.kind, payload: { key: a.key, values: a.values }, etaSlot: a.etaSlot, proposer: a.proposer, queuedSig: null, label: 'observed on-chain' });
      }
    }
  }
}
