/**
 * Reconstitution proposals ("index committee" mode) and their on-chain application through the
 * timelock. The methodology job only *proposes*; an operator approves/rejects (CLI or admin API)
 * and approved items are queued as PendingActions at the next reconstitution window (or at once
 * with --immediate). RECONSTITUTION_MODE=auto approves every indication automatically.
 */
import type { MintInfoSource } from '../chain/accounts.js';
import type { ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import type { ProposalRow, Repo } from '../db/repo.js';
import type { TargetWeight } from '../methodology/types.js';
import { parseJson } from '../util/json.js';
import { childLogger } from '../util/logger.js';
import { nowIso } from '../util/time.js';
import { payloads, type GovernanceService } from './actions.js';
import { canTransition, equalWeightAfter, reconcileProposals, transition, type IndicatedChange } from './proposals.js';

const log = childLogger('reconstitution');

export interface ReconstitutionDeps {
  chain: ChainClient;
  tx: TxSender;
  repo: Repo;
  env: Env;
  cfg: MethodologyConfig;
  mints: MintInfoSource;
  governance: GovernanceService;
}

export interface QueueApprovedResult {
  queued: { mint: string; action: string; pda: string; sig: string }[];
  weightActions: { mint: string; targetWeightBps: number; pda: string }[];
  skipped: string[];
}

/**
 * Target weights once `adds` join and `removes` leave. Equal weighting recomputes 1/N; other
 * schemes use the latest methodology weights when they cover the mint (fallback: equal).
 */
export function targetWeightsAfter(activeMints: readonly string[], adds: readonly { mint: string; weightBps: number | null }[], removes: ReadonlySet<string>, cfg: MethodologyConfig, lastWeights: readonly TargetWeight[]): Map<string, number> {
  const kept = activeMints.filter((m) => !removes.has(m));
  const out = new Map<string, number>();
  const equal = equalWeightAfter(kept.length, adds.length, 0);
  const byMint = new Map(lastWeights.map((w) => [w.mint, w.weightBps]));
  for (const m of kept) out.set(m, cfg.weighting.scheme === 'equal' ? equal : (byMint.get(m) ?? equal));
  for (const a of adds) out.set(a.mint, a.weightBps ?? (cfg.weighting.scheme === 'equal' ? equal : (byMint.get(a.mint) ?? equal)));
  return out;
}

export class ReconstitutionService {
  constructor(private readonly d: ReconstitutionDeps) {}

  get mode(): 'manual' | 'auto' {
    return this.d.cfg.reconstitution.mode;
  }

  list(status?: ProposalRow['status'] | ProposalRow['status'][]): ProposalRow[] {
    return this.d.repo.governance.proposals(status);
  }

  /** Record what the methodology indicated. New rows start `proposed` (manual) or `approved` (auto). */
  recordIndicated(indicated: readonly IndicatedChange[], now = new Date()): { created: ProposalRow[]; alreadyOpen: string[]; suppressed: string[] } {
    const existing = this.d.repo.governance.proposals(undefined, 10_000);
    const r = reconcileProposals(indicated, existing, now.getTime(), this.d.cfg.reconstitution.rejectCooldownDays);
    const created: ProposalRow[] = [];
    for (const c of r.create) {
      const status = this.mode === 'auto' ? 'approved' : 'proposed';
      const id = this.d.repo.governance.insertProposal({ mint: c.mint, symbol: c.symbol, action: c.action, reason: { source: 'methodology', ...c.metrics }, status, weightBps: c.weightBps, ts: now.toISOString() });
      if (status === 'approved') this.d.repo.governance.updateProposal(id, { decided_ts: now.toISOString(), note: 'auto-approved (RECONSTITUTION_MODE=auto)' });
      const row = this.d.repo.governance.getProposal(id);
      if (row) created.push(row);
    }
    if (created.length || r.suppressed.length) log.info({ created: created.map((c) => `${c.action}:${c.symbol ?? c.mint}`), suppressed: r.suppressed, alreadyOpen: r.alreadyOpen.length, mode: this.mode }, 'reconstitution proposals reconciled');
    return { created, alreadyOpen: r.alreadyOpen, suppressed: r.suppressed };
  }

  private openOrThrow(mint: string): ProposalRow {
    const row = this.d.repo.governance.openProposal(mint);
    if (!row) throw new Error(`no open proposal for ${mint}`);
    return row;
  }

  async approve(mint: string, opts: { weightBps?: number; immediate?: boolean; dry?: boolean } = {}): Promise<{ proposal: ProposalRow; queued: QueueApprovedResult | null }> {
    const row = this.openOrThrow(mint);
    if (!canTransition(row.status, 'approve')) throw new Error(`proposal ${row.id} is ${row.status}; cannot approve`);
    if (opts.weightBps !== undefined && (opts.weightBps < 0 || opts.weightBps > 10_000)) throw new Error('weight must be 0..10000 bps');
    this.d.repo.governance.updateProposal(row.id, { status: transition(row.status, 'approve'), decided_ts: nowIso(), ...(opts.weightBps !== undefined ? { weight_bps: opts.weightBps } : {}) });
    const proposal = this.d.repo.governance.getProposal(row.id)!;
    log.info({ id: row.id, mint, action: row.action, weightBps: proposal.weight_bps, immediate: Boolean(opts.immediate) }, 'proposal approved');
    const queued = opts.immediate ? await this.queueApproved({ dry: opts.dry, only: [mint] }) : null;
    return { proposal: this.d.repo.governance.getProposal(row.id)!, queued };
  }

  reject(mint: string, note?: string): ProposalRow {
    const row = this.openOrThrow(mint);
    if (!canTransition(row.status, 'reject')) throw new Error(`proposal ${row.id} is ${row.status}; cannot reject`);
    this.d.repo.governance.updateProposal(row.id, { status: 'rejected', decided_ts: nowIso(), note: note ?? row.note });
    log.info({ id: row.id, mint, action: row.action, cooldownDays: this.d.cfg.reconstitution.rejectCooldownDays }, 'proposal rejected');
    return this.d.repo.governance.getProposal(row.id)!;
  }

  /**
   * Manual add of an arbitrary mint. Validates the mint exists and (unless force) has revoked authorities and no
   * Token-2022 transfer fee (methodology rule 2.7). `--force` may admit a transfer-FEE mint — the program credits
   * vaults by received amount, the SDK sends gross deposits/fills and every holder pays the fee on redemption —
   * but never a transfer-HOOK mint, whose hook program can make vault transfers fail outright.
   */
  async addAsset(mint: string, opts: { weightBps?: number; immediate?: boolean; force?: boolean; dry?: boolean; symbol?: string } = {}): Promise<{ proposal: ProposalRow; queued: QueueApprovedResult | null }> {
    const info = (await this.d.mints.getMintInfo([mint])).get(mint);
    if (!info) throw new Error(`mint ${mint} does not exist on this cluster`);
    const assets = await this.d.chain.readAssets();
    if (assets.some((a) => a.mint === mint)) throw new Error(`mint ${mint} is already a constituent`);
    if (info.transferHookProgram) throw new Error(`mint ${mint} has a Token-2022 transfer hook (${info.transferHookProgram}); hooked tokens can never be constituents (rule 2.7, no override)`);
    if (info.transferFeeBps > 0 && !opts.force) {
      throw new Error(`mint ${mint} has a Token-2022 transfer fee of ${info.transferFeeBps} bps; ineligible by rule 2.7 — pass --force to admit it anyway (every deposit, redemption and auction fill is taxed)`);
    }
    if (!opts.force && (info.mintAuthority || info.freezeAuthority)) {
      throw new Error(`mint ${mint} has a live ${info.mintAuthority ? 'mint' : 'freeze'} authority; pass --force to add it anyway`);
    }
    if (info.transferFeeBps > 0) {
      log.warn(
        { mint, transferFeeBps: info.transferFeeBps, transferFeeMaxFee: info.transferFeeMaxFee.toString() },
        'ADMITTING A TRANSFER-FEE MINT BY OVERRIDE (rule 2.7): every vault deposit, withdrawal and auction fill of this constituent is taxed by its fee authority; depositors/fillers send gross, redeemers receive net',
      );
    }
    if (this.d.repo.governance.openProposal(mint)) throw new Error(`an open proposal for ${mint} already exists; approve or reject it`);
    const weight = opts.weightBps ?? equalWeightAfter(assets.filter((a) => a.status === 'active').length, 1, 0);
    const id = this.d.repo.governance.insertProposal({ mint, symbol: opts.symbol ?? null, action: 'add', reason: { source: 'manual', decimals: info.decimals, mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority, force: Boolean(opts.force), ...(info.transferFeeBps > 0 ? { transferFeeBps: info.transferFeeBps } : {}) }, status: 'approved', weightBps: weight, note: info.transferFeeBps > 0 ? `manual add (transfer-fee override, ${info.transferFeeBps} bps)` : 'manual add' });
    this.d.repo.governance.updateProposal(id, { decided_ts: nowIso() });
    const queued = opts.immediate ? await this.queueApproved({ dry: opts.dry, only: [mint] }) : null;
    return { proposal: this.d.repo.governance.getProposal(id)!, queued };
  }

  async removeAsset(mint: string, opts: { immediate?: boolean; dry?: boolean } = {}): Promise<{ proposal: ProposalRow; queued: QueueApprovedResult | null }> {
    const assets = await this.d.chain.readAssets();
    const a = assets.find((x) => x.mint === mint);
    if (!a) throw new Error(`mint ${mint} is not a constituent`);
    if (a.status !== 'active') throw new Error(`asset ${mint} is already being removed`);
    if (this.d.repo.governance.openProposal(mint)) throw new Error(`an open proposal for ${mint} already exists; approve or reject it`);
    const id = this.d.repo.governance.insertProposal({ mint, action: 'remove', reason: { source: 'manual' }, status: 'approved', note: 'manual remove' });
    this.d.repo.governance.updateProposal(id, { decided_ts: nowIso() });
    const queued = opts.immediate ? await this.queueApproved({ dry: opts.dry, only: [mint] }) : null;
    return { proposal: this.d.repo.governance.getProposal(id)!, queued };
  }

  /**
   * Queue every approved proposal (or the `only` subset) as timelocked actions, plus
   * set_target_weight actions re-equalizing the incumbents. Requires the keeper to be the authority.
   */
  async queueApproved(opts: { dry?: boolean; only?: string[] } = {}): Promise<QueueApprovedResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const approved = this.d.repo.governance.proposals('approved').filter((p) => !opts.only || opts.only.includes(p.mint));
    const result: QueueApprovedResult = { queued: [], weightActions: [], skipped: [] };
    if (approved.length === 0) return result;
    const fund = await this.d.chain.readFund();
    if (fund.openAuctions > 0) {
      log.warn('auctions open; postponing reconstitution queueing to the next run');
      result.skipped = approved.map((p) => p.mint);
      return result;
    }
    const assets = await this.d.chain.readAssets();
    const active = assets.filter((a) => a.status === 'active');
    const adds = approved.filter((p) => p.action === 'add' && !assets.some((a) => a.mint === p.mint));
    const removes = approved.filter((p) => p.action === 'remove' && active.some((a) => a.mint === p.mint));
    for (const p of approved) {
      if (!adds.includes(p) && !removes.includes(p)) {
        result.skipped.push(p.mint);
        log.warn({ mint: p.mint, action: p.action }, 'approved proposal no longer applicable (already applied?); marking executed');
        if (!dry) this.d.repo.governance.updateProposal(p.id, { status: 'executed', executed_ts: nowIso(), note: 'already reflected on-chain' });
      }
    }
    const removeSet = new Set(removes.map((r) => r.mint));
    const lastRun = this.d.repo.latestMethodologyRun();
    const lastWeights = lastRun ? parseJson<TargetWeight[]>(lastRun.weights, []) : [];
    const weights = targetWeightsAfter(active.map((a) => a.mint), adds.map((a) => ({ mint: a.mint, weightBps: a.weight_bps })), removeSet, this.d.cfg, lastWeights);

    for (const p of adds) {
      const w = weights.get(p.mint) ?? 0;
      const q = await this.d.governance.queue(payloads.addAsset(p.mint, w), `add_asset ${p.symbol ?? p.mint} ${w}bps`, { dry });
      result.queued.push({ mint: p.mint, action: 'add', pda: q.pda, sig: q.sig });
      if (!dry && q.sig !== DRY_RUN_SIG) this.d.repo.governance.updateProposal(p.id, { status: 'queued', queued_ts: nowIso(), action_pda: q.pda, queued_sig: q.sig, weight_bps: w });
    }
    for (const p of removes) {
      const q = await this.d.governance.queue(payloads.beginRemoveAsset(p.mint), `begin_remove_asset ${p.symbol ?? p.mint}`, { dry });
      result.queued.push({ mint: p.mint, action: 'remove', pda: q.pda, sig: q.sig });
      if (!dry && q.sig !== DRY_RUN_SIG) this.d.repo.governance.updateProposal(p.id, { status: 'queued', queued_ts: nowIso(), action_pda: q.pda, queued_sig: q.sig });
    }
    for (const a of active) {
      if (removeSet.has(a.mint)) continue;
      const w = weights.get(a.mint);
      if (w === undefined || w === a.targetWeightBps) continue;
      const q = await this.d.governance.queue(payloads.setTargetWeight(a.mint, w), `set_target_weight ${a.mint} ${w}bps`, { dry });
      result.weightActions.push({ mint: a.mint, targetWeightBps: w, pda: q.pda });
    }
    log.info({ adds: adds.length, removes: removes.length, weightActions: result.weightActions.length, timelockSlots: fund.timelockSlots.toString(), dry }, 'reconstitution queued through the timelock');
    return result;
  }

  /** Mark queued proposals executed once their PendingAction is gone and the chain reflects them. */
  async reconcileExecuted(): Promise<number> {
    const queued = this.d.repo.governance.proposals('queued');
    if (queued.length === 0) return 0;
    const [pending, assets] = await Promise.all([this.d.chain.readPendingActions(), this.d.chain.readAssets()]);
    const live = new Set(pending.map((p) => p.pda));
    let n = 0;
    for (const p of queued) {
      if (p.action_pda && live.has(p.action_pda)) continue;
      const a = assets.find((x) => x.mint === p.mint);
      const reflected = p.action === 'add' ? Boolean(a) : !a || a.status === 'removing';
      if (reflected) {
        this.d.repo.governance.updateProposal(p.id, { status: 'executed', executed_ts: nowIso() });
        n++;
      } else if (p.action_pda && !live.has(p.action_pda)) {
        this.d.repo.governance.updateProposal(p.id, { status: 'rejected', decided_ts: nowIso(), note: 'pending action cancelled on-chain' });
      }
    }
    return n;
  }
}
