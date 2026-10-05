/**
 * Holder governance v1 service: token-weighted, signature-based (gasless) voting by $FIX6900 holders, binding
 * through the keeper.
 *
 *   propose  -> verify proposer signature, threshold, payload; snapshot every holder (circulating supply)
 *   vote     -> verify signature over the canonical message; weight = snapshot balance; re-vote replaces
 *   close    -> gov-job every 60 s: past end_ts -> passed | failed (quorum AND for > against)
 *   execute  -> passed add/remove -> approved reconstitution proposal queued through the on-chain timelock
 *               passed set_param -> kv `cfg.<key>` override consumed by methodology / rebalancer / flywheel
 *
 * Every step writes a flywheel_events row of kind 'governance' so the site feed shows it.
 */
import type { MintInfoSource } from '../chain/accounts.js';
import type { Env } from '../config/env.js';
import { CFG_PREFIX, listOverrides } from '../config/overrides.js';
import type { GovChoice, GovKind, GovProposalRow, GovStatus } from '../db/gov-repo.js';
import type { Repo } from '../db/repo.js';
import { TtlCache } from '../util/cache.js';
import type { EventBus } from '../util/events.js';
import { bigToString, parseJson } from '../util/json.js';
import { childLogger } from '../util/logger.js';
import type { ReconstitutionService } from './reconstitution.js';
import {
  GOV_CHOICES,
  GOV_KINDS,
  PARAM_SPECS,
  allowedParams,
  describeGovPayload,
  proposeMessage,
  tallyOutcome,
  validateAssetPayload,
  validateDescription,
  validateParamPayload,
  validateTitle,
  verifySignature,
  voteMessage,
  type ParamSpec,
} from './voting.js';

const log = childLogger('holder-gov');

/** Sig column for off-chain governance events (no transaction). */
export const OFFCHAIN_SIG = 'off-chain';
const DEV_WEIGHT = 1_000_000n; // 1 unit (6 dp) for GOV_DEV_ACCEPT_ANY_BALANCE wallets with no balance

export interface HolderBalanceLite {
  owner: string;
  amount: bigint;
}

export interface HolderGovDeps {
  repo: Repo;
  env: Pick<Env, 'GOV_ENABLED' | 'GOV_VOTING_HOURS' | 'GOV_QUORUM_BPS' | 'GOV_PROPOSAL_THRESHOLD_BPS' | 'GOV_MAX_OPEN_PER_WALLET' | 'GOV_ALLOWED_PARAMS' | 'GOV_DEV_ACCEPT_ANY_BALANCE' | 'DRY_RUN'> & Partial<Pick<Env, 'COIN_MINT'>>;
  getSlot: () => Promise<bigint>;
  /** Every holder of the coin mint (raw balances). */
  getHolders: () => Promise<HolderBalanceLite[]>;
  /** Wallets excluded from the snapshot (pools, PDAs, programs, burn, denylist, own wallets). */
  exclusions: (owners: readonly string[]) => Promise<Set<string>>;
  /** Live balance of a wallet (proposal threshold). Defaults to the cached snapshot. */
  getBalance?: (wallet: string) => Promise<bigint>;
  /** Mint checks for add_asset; when absent the checks are skipped (mock). */
  mints?: MintInfoSource;
  /** Current constituents (add must not be one; remove must be an active one). */
  readAssets?: () => Promise<{ mint: string; status: string }[]>;
  /** Binding path for add/remove; when absent, passed asset proposals are recorded as executed off-chain (mock). */
  reconstitution?: Pick<ReconstitutionService, 'addAsset' | 'removeAsset' | 'list'>;
  events?: EventBus;
  now?: () => Date;
}

export interface GovTallyDto {
  for: string;
  against: string;
  abstain: string;
  participation: string;
  voters: number;
  quorumUnits: string;
  quorumReached: boolean;
  majority: boolean;
  passed: boolean;
  /** Shares of the participating weight, bps. */
  forBps: number;
  againstBps: number;
  abstainBps: number;
  /** Participation as a share of the snapshot supply, bps. */
  participationBps: number;
}

export interface GovVoteDto {
  wallet: string;
  choice: GovChoice;
  weight: string;
  ts: string;
}

export interface GovProposalDto {
  id: number;
  kind: GovKind;
  payload: Record<string, unknown>;
  summary: string;
  title: string;
  description: string;
  proposer: string;
  createdTs: string;
  snapshotSlot: string;
  snapshotSupply: string;
  snapshotHolders: number;
  startTs: string;
  endTs: string;
  quorumBps: number;
  status: GovStatus;
  timeLeftSec: number;
  tally: GovTallyDto;
  result: Record<string, unknown> | null;
  queuedActionPda: string | null;
  queuedSig: string | null;
  /** Present when ?wallet= was given. */
  myVote?: GovVoteDto | null;
  myWeight?: string;
  /** Detail view only. */
  votes?: GovVoteDto[];
}

export interface GovSummaryDto {
  enabled: boolean;
  coinMint: string | null;
  counts: Record<GovStatus, number>;
  params: {
    votingHours: number;
    quorumBps: number;
    proposalThresholdBps: number;
    maxOpenPerWallet: number;
    allowedParams: ParamSpec[];
    devAcceptAnyBalance: boolean;
  };
  /** Governance overrides in force (kv cfg.*). */
  overrides: Record<string, number>;
  /** Latest known circulating supply (raw) from the most recent snapshot, if any. */
  lastSnapshot: { proposalId: number; slot: string; supply: string; holders: number } | null;
}

export interface GovEligibilityDto {
  wallet: string;
  balance: string;
  circulatingSupply: string;
  thresholdUnits: string;
  eligible: boolean;
  openProposals: number;
  maxOpenPerWallet: number;
}

export interface ProposeInput {
  kind: string;
  payload: Record<string, unknown>;
  title: string;
  description?: string;
  proposer: string;
  message?: string;
  signature?: string;
}

export class GovError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
  }
}

interface Snapshot {
  slot: bigint;
  balances: Map<string, bigint>;
  supply: bigint;
}

export class HolderGovernance {
  private readonly snapshotCache = new TtlCache<Snapshot>(5 * 60_000);

  constructor(private readonly d: HolderGovDeps) {}

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  get enabled(): boolean {
    return this.d.env.GOV_ENABLED;
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  /** Holder balances minus exclusions, cached for a few minutes (cheap re-use across proposals and eligibility checks). */
  async snapshot(force = false): Promise<Snapshot> {
    if (force) this.snapshotCache.delete('snapshot');
    return this.snapshotCache.getOrLoad('snapshot', async () => {
      const [slot, holders] = await Promise.all([this.d.getSlot(), this.d.getHolders()]);
      const ex = await this.d.exclusions(holders.map((h) => h.owner));
      const balances = new Map<string, bigint>();
      let supply = 0n;
      for (const h of holders) {
        if (h.amount <= 0n || ex.has(h.owner)) continue;
        balances.set(h.owner, (balances.get(h.owner) ?? 0n) + h.amount);
        supply += h.amount;
      }
      log.info({ slot: slot.toString(), holders: holders.length, excluded: holders.length - balances.size, supply: supply.toString() }, 'holder snapshot');
      return { slot, balances, supply };
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  summary(): GovSummaryDto {
    const last = this.d.repo.gov.list(undefined, 1)[0];
    return {
      enabled: this.enabled,
      coinMint: this.d.env.COIN_MINT ?? null,
      counts: this.d.repo.gov.countByStatus(),
      params: {
        votingHours: this.d.env.GOV_VOTING_HOURS,
        quorumBps: this.d.env.GOV_QUORUM_BPS,
        proposalThresholdBps: this.d.env.GOV_PROPOSAL_THRESHOLD_BPS,
        maxOpenPerWallet: this.d.env.GOV_MAX_OPEN_PER_WALLET,
        allowedParams: allowedParams(this.d.env.GOV_ALLOWED_PARAMS),
        devAcceptAnyBalance: this.d.env.GOV_DEV_ACCEPT_ANY_BALANCE,
      },
      overrides: listOverrides(this.d.repo, PARAM_SPECS.map((p) => p.key)),
      lastSnapshot: last ? { proposalId: last.id, slot: last.snapshot_slot, supply: last.snapshot_supply, holders: this.d.repo.gov.snapshotHolders(last.id) } : null,
    };
  }

  list(status?: string, wallet?: string): GovProposalDto[] {
    if (status && !['open', 'passed', 'failed', 'queued', 'executed', 'cancelled'].includes(status)) throw new GovError('status must be open|passed|failed|queued|executed|cancelled');
    const rows = this.d.repo.gov.list(status as GovStatus | undefined);
    const order: Record<GovStatus, number> = { open: 0, passed: 1, queued: 2, executed: 3, failed: 4, cancelled: 5 };
    return rows.sort((a, b) => order[a.status] - order[b.status] || b.id - a.id).map((r) => this.toDto(r, wallet));
  }

  get(id: number, wallet?: string): GovProposalDto {
    const row = this.d.repo.gov.get(id);
    if (!row) throw new GovError(`proposal ${id} not found`, 404);
    const dto = this.toDto(row, wallet);
    dto.votes = this.d.repo.gov.votes(id, 100).map((v) => ({ wallet: v.wallet, choice: v.choice, weight: v.weight, ts: v.ts }));
    return dto;
  }

  async eligibility(wallet: string): Promise<GovEligibilityDto> {
    const snap = await this.snapshot();
    const balance = await this.liveBalance(wallet, snap);
    const threshold = thresholdUnits(snap.supply, this.d.env.GOV_PROPOSAL_THRESHOLD_BPS);
    const open = this.d.repo.gov.openByProposer(wallet);
    return {
      wallet,
      balance: balance.toString(),
      circulatingSupply: snap.supply.toString(),
      thresholdUnits: threshold.toString(),
      eligible: this.d.env.GOV_DEV_ACCEPT_ANY_BALANCE || balance >= threshold,
      openProposals: open,
      maxOpenPerWallet: this.d.env.GOV_MAX_OPEN_PER_WALLET,
    };
  }

  private async liveBalance(wallet: string, snap: Snapshot): Promise<bigint> {
    if (this.d.getBalance) {
      try {
        return await this.d.getBalance(wallet);
      } catch (err) {
        log.warn({ err: (err as Error).message, wallet }, 'live balance read failed; using snapshot');
      }
    }
    return snap.balances.get(wallet) ?? 0n;
  }

  toDto(r: GovProposalRow, wallet?: string): GovProposalDto {
    const payload = parseJson<Record<string, unknown>>(r.payload, {});
    const supply = BigInt(r.snapshot_supply);
    const t = tallyOutcome(this.d.repo.gov.tally(r.id), supply, r.quorum_bps);
    const bps = (x: bigint, of: bigint): number => (of > 0n ? Number((x * 10_000n) / of) : 0);
    const dto: GovProposalDto = {
      id: r.id,
      kind: r.kind,
      payload,
      summary: describeGovPayload(r.kind, payload),
      title: r.title,
      description: r.description,
      proposer: r.proposer,
      createdTs: r.created_ts,
      snapshotSlot: r.snapshot_slot,
      snapshotSupply: r.snapshot_supply,
      snapshotHolders: this.d.repo.gov.snapshotHolders(r.id),
      startTs: r.start_ts,
      endTs: r.end_ts,
      quorumBps: r.quorum_bps,
      status: r.status,
      timeLeftSec: Math.max(0, Math.floor((Date.parse(r.end_ts) - this.now().getTime()) / 1000)),
      tally: {
        for: t.for.toString(),
        against: t.against.toString(),
        abstain: t.abstain.toString(),
        participation: t.participation.toString(),
        voters: t.voters,
        quorumUnits: t.quorumUnits.toString(),
        quorumReached: t.quorumReached,
        majority: t.majority,
        passed: t.passed,
        forBps: bps(t.for, t.participation),
        againstBps: bps(t.against, t.participation),
        abstainBps: bps(t.abstain, t.participation),
        participationBps: bps(t.participation, supply),
      },
      result: r.result ? parseJson<Record<string, unknown>>(r.result, {}) : null,
      queuedActionPda: r.queued_action_pda,
      queuedSig: r.queued_sig,
    };
    if (wallet) {
      const v = this.d.repo.gov.vote(r.id, wallet);
      dto.myVote = v ? { wallet: v.wallet, choice: v.choice, weight: v.weight, ts: v.ts } : null;
      dto.myWeight = this.voteWeight(r.id, wallet).toString();
    }
    return dto;
  }

  private voteWeight(proposalId: number, wallet: string): bigint {
    const w = this.d.repo.gov.snapshotBalance(proposalId, wallet);
    if (w > 0n) return w;
    return this.d.env.GOV_DEV_ACCEPT_ANY_BALANCE ? DEV_WEIGHT : 0n;
  }

  // ---------------------------------------------------------------------------
  // Propose
  // ---------------------------------------------------------------------------

  async propose(input: ProposeInput, opts: { admin?: boolean } = {}): Promise<GovProposalDto> {
    if (!this.enabled) throw new GovError('governance is disabled (GOV_ENABLED=false)', 403);
    const kind = input.kind as GovKind;
    if (!GOV_KINDS.includes(kind)) throw new GovError(`kind must be ${GOV_KINDS.join('|')}`);
    if (!input.payload || typeof input.payload !== 'object') throw new GovError('payload must be an object');
    const title = validateTitle(input.title);
    const description = validateDescription(input.description);
    const proposer = opts.admin ? (typeof input.proposer === 'string' && input.proposer ? input.proposer : 'admin') : input.proposer;
    if (!opts.admin && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proposer ?? '')) throw new GovError('proposer must be a base58 wallet');

    // Payload (shape, whitelist, bounds).
    let payload: Record<string, unknown>;
    if (kind === 'set_param') payload = validateParamPayload(input.payload, this.d.env.GOV_ALLOWED_PARAMS) as unknown as Record<string, unknown>;
    else payload = validateAssetPayload(kind, input.payload) as unknown as Record<string, unknown>;

    // Proposer signature over the canonical message (admin bearer may skip).
    if (!opts.admin) {
      const expected = proposeMessage({ kind, payload: input.payload, title: input.title, description: input.description ?? '', proposer });
      if (input.message !== expected) throw new GovError(`message mismatch; sign exactly: ${expected}`);
      if (!input.signature || !verifySignature(proposer, expected, input.signature)) throw new GovError('invalid signature', 403);
      if (this.d.repo.gov.openByProposer(proposer) >= this.d.env.GOV_MAX_OPEN_PER_WALLET) throw new GovError(`wallet already has ${this.d.env.GOV_MAX_OPEN_PER_WALLET} open proposal(s)`, 409);
    }

    // Chain checks for asset proposals.
    await this.checkAssetPayload(kind, payload);

    // Snapshot (fresh for a new proposal) + threshold.
    const snap = await this.snapshot(true);
    if (!opts.admin) {
      const balance = await this.liveBalance(proposer, snap);
      const threshold = thresholdUnits(snap.supply, this.d.env.GOV_PROPOSAL_THRESHOLD_BPS);
      if (balance < threshold && !this.d.env.GOV_DEV_ACCEPT_ANY_BALANCE) {
        throw new GovError(`proposer holds ${fmtUnits(balance)} units; ${fmtUnits(threshold)} (${this.d.env.GOV_PROPOSAL_THRESHOLD_BPS} bps of circulating ${fmtUnits(snap.supply)}) required`, 403);
      }
    }

    const now = this.now();
    const end = new Date(now.getTime() + this.d.env.GOV_VOTING_HOURS * 3_600_000);
    const id = this.d.repo.gov.insertProposal({
      kind,
      payload,
      title,
      description,
      proposer,
      snapshotSlot: snap.slot,
      snapshotSupply: snap.supply,
      startTs: now.toISOString(),
      endTs: end.toISOString(),
      quorumBps: this.d.env.GOV_QUORUM_BPS,
      createdTs: now.toISOString(),
    });
    const holders = this.d.repo.gov.insertSnapshot(id, snap.balances);
    this.event({ action: 'proposed', proposalId: id, kind, proposer, snapshotSlot: snap.slot, snapshotSupply: snap.supply, holders, endTs: end.toISOString() }, `Proposal #${id} opened: ${title} (${describeGovPayload(kind, payload)}); voting until ${end.toISOString()}`);
    log.info({ id, kind, proposer, title, snapshotSlot: snap.slot.toString(), supply: snap.supply.toString(), holders }, 'proposal opened');
    return this.get(id, opts.admin ? undefined : proposer);
  }

  private async checkAssetPayload(kind: GovKind, payload: Record<string, unknown>): Promise<void> {
    if (kind === 'set_param') return;
    const mint = payload.mint as string;
    const assets = this.d.readAssets ? await this.d.readAssets() : [];
    const held = assets.find((a) => a.mint === mint);
    if (kind === 'remove_asset') {
      if (this.d.readAssets && !held) throw new GovError(`mint ${mint} is not a constituent`);
      if (held && held.status !== 'active') throw new GovError(`asset ${mint} is already being removed`);
      return;
    }
    if (held) throw new GovError(`mint ${mint} is already a constituent`, 409);
    if (!this.d.mints) return;
    const info = (await this.d.mints.getMintInfo([mint])).get(mint);
    if (!info) throw new GovError(`mint ${mint} does not exist on this cluster`);
    if (info.transferHookProgram) throw new GovError(`mint ${mint} has a Token-2022 transfer hook (${info.transferHookProgram}); hooked tokens can never be constituents`);
    if (info.mintAuthority || info.freezeAuthority) throw new GovError(`mint ${mint} has a live ${info.mintAuthority ? 'mint' : 'freeze'} authority; not eligible`);
    if (info.transferFeeBps > 0 && payload.allowTransferFee !== true) throw new GovError(`mint ${mint} has a Token-2022 transfer fee of ${info.transferFeeBps} bps; set payload.allowTransferFee=true to propose it anyway`);
    payload.decimals = info.decimals;
    if (info.transferFeeBps > 0) payload.transferFeeBps = info.transferFeeBps;
  }

  // ---------------------------------------------------------------------------
  // Vote
  // ---------------------------------------------------------------------------

  vote(id: number, input: { wallet: string; choice: string; message: string; signature: string }): GovProposalDto {
    if (!this.enabled) throw new GovError('governance is disabled (GOV_ENABLED=false)', 403);
    const row = this.d.repo.gov.get(id);
    if (!row) throw new GovError(`proposal ${id} not found`, 404);
    if (row.status !== 'open') throw new GovError(`proposal ${id} is ${row.status}; voting is closed`, 409);
    if (this.now().getTime() >= Date.parse(row.end_ts)) throw new GovError(`proposal ${id} voting ended at ${row.end_ts}`, 409);
    const choice = input.choice as GovChoice;
    if (!GOV_CHOICES.includes(choice)) throw new GovError(`choice must be ${GOV_CHOICES.join('|')}`);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.wallet ?? '')) throw new GovError('wallet must be a base58 public key');
    const expected = voteMessage(choice, id, row.snapshot_slot);
    if (input.message !== expected) throw new GovError(`message mismatch; sign exactly: ${expected}`);
    if (!verifySignature(input.wallet, expected, input.signature)) throw new GovError('invalid signature', 403);
    const weight = this.voteWeight(id, input.wallet);
    if (weight <= 0n) throw new GovError(`wallet ${input.wallet} held no $FIX6900 at snapshot slot ${row.snapshot_slot}`, 403);
    const prev = this.d.repo.gov.vote(id, input.wallet);
    this.d.repo.gov.upsertVote({ proposalId: id, wallet: input.wallet, choice, weight, sig: input.signature, message: expected, ts: this.now().toISOString() });
    log.info({ id, wallet: input.wallet, choice, weight: weight.toString(), replaced: prev?.choice ?? null }, 'vote recorded');
    return this.get(id, input.wallet);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  cancel(id: number, note?: string): GovProposalDto {
    const row = this.d.repo.gov.get(id);
    if (!row) throw new GovError(`proposal ${id} not found`, 404);
    if (row.status !== 'open' && row.status !== 'passed') throw new GovError(`proposal ${id} is ${row.status}; only open or passed proposals can be cancelled`, 409);
    const result = { ...(row.result ? parseJson<Record<string, unknown>>(row.result, {}) : {}), cancelledTs: this.now().toISOString(), note: note ?? 'cancelled by the index committee' };
    this.d.repo.gov.update(id, { status: 'cancelled', result: JSON.stringify(result) });
    this.event({ action: 'cancelled', proposalId: id, note: result.note }, `Proposal #${id} cancelled by the index committee${note ? `: ${note}` : ''}`);
    return this.get(id);
  }

  // ---------------------------------------------------------------------------
  // Tally + binding execution (gov-job)
  // ---------------------------------------------------------------------------

  /** Close every open proposal past its end: passed | failed. */
  closeDue(): { closed: number; passed: number[]; failed: number[] } {
    const out = { closed: 0, passed: [] as number[], failed: [] as number[] };
    for (const row of this.d.repo.gov.dueForClose(this.now().toISOString())) {
      const t = tallyOutcome(this.d.repo.gov.tally(row.id), BigInt(row.snapshot_supply), row.quorum_bps);
      const status: GovStatus = t.passed ? 'passed' : 'failed';
      const result = {
        closedTs: this.now().toISOString(),
        for: t.for.toString(),
        against: t.against.toString(),
        abstain: t.abstain.toString(),
        voters: t.voters,
        quorumUnits: t.quorumUnits.toString(),
        quorumReached: t.quorumReached,
        majority: t.majority,
        reason: t.passed ? 'quorum reached and for > against' : !t.quorumReached ? 'quorum not reached' : 'for did not exceed against',
      };
      this.d.repo.gov.update(row.id, { status, result: JSON.stringify(result) });
      out.closed++;
      (t.passed ? out.passed : out.failed).push(row.id);
      this.event({ action: status, proposalId: row.id, ...result }, `Proposal #${row.id} ${status}: ${row.title} (for ${fmtUnits(t.for)} / against ${fmtUnits(t.against)} / abstain ${fmtUnits(t.abstain)}; ${result.reason})`);
      log.info({ id: row.id, status, ...result }, 'proposal closed');
    }
    return out;
  }

  /** Apply every passed proposal, then reconcile queued ones with the on-chain timelock. */
  async executePassed(): Promise<{ executed: number[]; queued: number[]; waiting: number[]; failed: number[] }> {
    const out = { executed: [] as number[], queued: [] as number[], waiting: [] as number[], failed: [] as number[] };
    for (const row of this.d.repo.gov.list('passed')) {
      const payload = parseJson<Record<string, unknown>>(row.payload, {});
      const result = parseJson<Record<string, unknown>>(row.result, {});
      try {
        if (row.kind === 'set_param') {
          const key = String(payload.key);
          const value = Number(payload.value);
          this.d.repo.setKv(CFG_PREFIX + key, String(value));
          this.d.repo.gov.update(row.id, { status: 'executed', result: JSON.stringify({ ...result, executedTs: this.now().toISOString(), effective: { key, value } }) });
          out.executed.push(row.id);
          this.event({ action: 'executed', proposalId: row.id, key, value }, `Proposal #${row.id} executed: ${key} = ${value} is now in force`);
          log.info({ id: row.id, key, value }, 'parameter override applied');
          continue;
        }
        // add_asset / remove_asset -> approved reconstitution proposal, queued on-chain through the timelock.
        if (!this.d.reconstitution) {
          this.d.repo.gov.update(row.id, { status: 'executed', result: JSON.stringify({ ...result, executedTs: this.now().toISOString(), note: 'no chain in this mode; recorded only' }) });
          out.executed.push(row.id);
          continue;
        }
        let reconId = typeof result.reconProposalId === 'number' ? result.reconProposalId : null;
        if (reconId === null) {
          const mint = String(payload.mint);
          const r =
            row.kind === 'add_asset'
              ? await this.d.reconstitution.addAsset(mint, { weightBps: typeof payload.weightBps === 'number' ? payload.weightBps : undefined, immediate: true, force: payload.allowTransferFee === true, symbol: typeof payload.symbol === 'string' ? payload.symbol : undefined })
              : await this.d.reconstitution.removeAsset(mint, { immediate: true });
          reconId = r.proposal.id;
          result.reconProposalId = reconId;
          this.d.repo.gov.update(row.id, { result: JSON.stringify(result) });
          this.event({ action: 'approved', proposalId: row.id, reconProposalId: reconId, queued: r.queued?.queued ?? [], skipped: r.queued?.skipped ?? [] }, `Proposal #${row.id} passed: ${describeGovPayload(row.kind, payload)} approved for reconstitution${r.queued?.queued.length ? ' and queued through the timelock' : ' (queued at the next window)'}`);
        }
        const synced = this.syncWithRecon(row.id, reconId);
        if (synced === 'queued') out.queued.push(row.id);
        else if (synced === 'executed') out.executed.push(row.id);
        else out.waiting.push(row.id);
      } catch (err) {
        out.failed.push(row.id);
        const msg = (err as Error).message;
        log.error({ id: row.id, err: msg }, 'execution failed');
        this.d.repo.gov.update(row.id, { result: JSON.stringify({ ...result, lastError: msg, lastErrorTs: this.now().toISOString() }) });
      }
    }
    // queued -> executed once the reconstitution proposal reports the on-chain action executed.
    for (const row of this.d.repo.gov.list('queued')) {
      const result = parseJson<Record<string, unknown>>(row.result, {});
      if (typeof result.reconProposalId === 'number' && this.syncWithRecon(row.id, result.reconProposalId) === 'executed') out.executed.push(row.id);
    }
    return out;
  }

  /** Mirrors the reconstitution proposal's status (queued/executed/rejected) onto the governance proposal. */
  private syncWithRecon(id: number, reconId: number): GovStatus | 'waiting' {
    const gov = this.d.repo.gov.get(id);
    const recon = this.d.repo.governance.getProposal(reconId);
    if (!gov || !recon) return 'waiting';
    const result = parseJson<Record<string, unknown>>(gov.result, {});
    if (recon.status === 'queued' && gov.status !== 'queued') {
      this.d.repo.gov.update(id, { status: 'queued', queued_action_pda: recon.action_pda, queued_sig: recon.queued_sig, result: JSON.stringify({ ...result, queuedTs: recon.queued_ts }) });
      this.event({ action: 'queued', proposalId: id, actionPda: recon.action_pda, sig: recon.queued_sig }, `Proposal #${id} queued on-chain as ${recon.action_pda} (timelock applies)`, recon.queued_sig ?? undefined);
      return 'queued';
    }
    if (recon.status === 'executed' && gov.status !== 'executed') {
      this.d.repo.gov.update(id, { status: 'executed', queued_action_pda: gov.queued_action_pda ?? recon.action_pda, queued_sig: gov.queued_sig ?? recon.queued_sig, result: JSON.stringify({ ...result, executedTs: recon.executed_ts ?? this.now().toISOString() }) });
      this.event({ action: 'executed', proposalId: id, actionPda: recon.action_pda }, `Proposal #${id} executed on-chain (${recon.action} ${recon.symbol ?? recon.mint})`);
      return 'executed';
    }
    if (recon.status === 'rejected' && gov.status !== 'failed') {
      this.d.repo.gov.update(id, { status: 'failed', result: JSON.stringify({ ...result, note: recon.note ?? 'reconstitution proposal rejected' }) });
      this.event({ action: 'failed', proposalId: id, note: recon.note }, `Proposal #${id} could not be applied: ${recon.note ?? 'reconstitution proposal rejected'}`);
      return 'failed';
    }
    return gov.status === 'queued' ? 'queued' : 'waiting';
  }

  /** One gov-job tick. */
  async tick(): Promise<Record<string, unknown>> {
    if (!this.enabled) return { enabled: false };
    const closed = this.closeDue();
    const exec = await this.executePassed();
    return { closed: closed.closed, passed: closed.passed, failed: closed.failed, executed: exec.executed, queued: exec.queued, waiting: exec.waiting.length, execFailed: exec.failed };
  }

  private event(raw: Record<string, unknown>, note: string, sig = OFFCHAIN_SIG): void {
    const amounts = bigToString(raw) as Record<string, unknown>; // JSON-safe for the SSE stream and the mock feed
    const id = this.d.repo.insertFlywheelEvent({ kind: 'governance', sig, amounts, note });
    this.d.events?.emit('flywheel_event', { id, kind: 'governance', sig, amounts, note, ts: this.now().toISOString() });
  }
}

export function thresholdUnits(supply: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  return (supply * BigInt(bps) + 9_999n) / 10_000n;
}

function fmtUnits(raw: bigint): string {
  return (Number(raw) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
}
