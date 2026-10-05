/** Holder-governance tables (gov_proposals, gov_votes, gov_snapshots). Raw u64 weights are decimal strings. */
import type { Db } from './db.js';
import { nowIso } from '../util/time.js';
import { stringifyBig } from '../util/json.js';

export type GovKind = 'add_asset' | 'remove_asset' | 'set_param';
export type GovStatus = 'open' | 'passed' | 'failed' | 'queued' | 'executed' | 'cancelled';
export type GovChoice = 'for' | 'against' | 'abstain';

export interface GovProposalRow {
  id: number;
  kind: GovKind;
  payload: string;
  title: string;
  description: string;
  proposer: string;
  created_ts: string;
  snapshot_slot: string;
  snapshot_supply: string;
  start_ts: string;
  end_ts: string;
  quorum_bps: number;
  status: GovStatus;
  result: string | null;
  queued_action_pda: string | null;
  queued_sig: string | null;
  updated_ts: string;
}

export interface GovVoteRow {
  proposal_id: number;
  wallet: string;
  choice: GovChoice;
  weight: string;
  sig: string;
  message: string;
  ts: string;
}

export interface GovTally {
  for: bigint;
  against: bigint;
  abstain: bigint;
  voters: number;
}

export class GovRepo {
  constructor(readonly db: Db) {}

  insertProposal(p: {
    kind: GovKind;
    payload: unknown;
    title: string;
    description: string;
    proposer: string;
    snapshotSlot: bigint;
    snapshotSupply: bigint;
    startTs: string;
    endTs: string;
    quorumBps: number;
    createdTs?: string;
  }): number {
    const ts = p.createdTs ?? nowIso();
    const r = this.db
      .prepare(
        `INSERT INTO gov_proposals(kind, payload, title, description, proposer, created_ts, snapshot_slot, snapshot_supply, start_ts, end_ts, quorum_bps, status, updated_ts)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'open',?)`,
      )
      .run(p.kind, stringifyBig(p.payload), p.title, p.description, p.proposer, ts, p.snapshotSlot.toString(), p.snapshotSupply.toString(), p.startTs, p.endTs, p.quorumBps, ts);
    return Number(r.lastInsertRowid);
  }

  get(id: number): GovProposalRow | undefined {
    return this.db.prepare<[number], GovProposalRow>('SELECT * FROM gov_proposals WHERE id = ?').get(id);
  }

  list(status?: GovStatus | GovStatus[], limit = 200): GovProposalRow[] {
    if (!status) return this.db.prepare<[number], GovProposalRow>('SELECT * FROM gov_proposals ORDER BY id DESC LIMIT ?').all(limit);
    const list = Array.isArray(status) ? status : [status];
    const q = list.map(() => '?').join(',');
    return this.db.prepare<(string | number)[], GovProposalRow>(`SELECT * FROM gov_proposals WHERE status IN (${q}) ORDER BY id DESC LIMIT ?`).all(...list, limit);
  }

  countByStatus(): Record<GovStatus, number> {
    const out: Record<GovStatus, number> = { open: 0, passed: 0, failed: 0, queued: 0, executed: 0, cancelled: 0 };
    for (const r of this.db.prepare<[], { status: GovStatus; n: number }>('SELECT status, COUNT(*) n FROM gov_proposals GROUP BY status').all()) out[r.status] = r.n;
    return out;
  }

  openByProposer(wallet: string): number {
    return this.db.prepare<[string], { n: number }>("SELECT COUNT(*) n FROM gov_proposals WHERE proposer = ? AND status = 'open'").get(wallet)?.n ?? 0;
  }

  /** Open proposals past their end timestamp. */
  dueForClose(nowIsoTs: string): GovProposalRow[] {
    return this.db.prepare<[string], GovProposalRow>("SELECT * FROM gov_proposals WHERE status = 'open' AND end_ts <= ? ORDER BY id ASC").all(nowIsoTs);
  }

  update(id: number, patch: Partial<Pick<GovProposalRow, 'status' | 'result' | 'queued_action_pda' | 'queued_sig' | 'end_ts'>>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE gov_proposals SET ${sets}, updated_ts = @updated_ts WHERE id = @id`).run({ ...patch, updated_ts: nowIso(), id });
  }

  // ---- snapshots ----
  insertSnapshot(proposalId: number, balances: ReadonlyMap<string, bigint> | readonly { wallet: string; balance: bigint }[]): number {
    const ins = this.db.prepare('INSERT OR REPLACE INTO gov_snapshots(proposal_id, wallet, balance) VALUES(?,?,?)');
    let n = 0;
    const entries: [string, bigint][] = balances instanceof Map ? [...balances.entries()] : (balances as readonly { wallet: string; balance: bigint }[]).map((b) => [b.wallet, b.balance]);
    this.db.transaction(() => {
      for (const [w, b] of entries) {
        if (b <= 0n) continue;
        ins.run(proposalId, w, b.toString());
        n++;
      }
    })();
    return n;
  }

  snapshotBalance(proposalId: number, wallet: string): bigint {
    const r = this.db.prepare<[number, string], { balance: string }>('SELECT balance FROM gov_snapshots WHERE proposal_id = ? AND wallet = ?').get(proposalId, wallet);
    return r ? BigInt(r.balance) : 0n;
  }

  snapshotHolders(proposalId: number): number {
    return this.db.prepare<[number], { n: number }>('SELECT COUNT(*) n FROM gov_snapshots WHERE proposal_id = ?').get(proposalId)?.n ?? 0;
  }

  // ---- votes ----
  /** Insert or replace (re-vote replaces the earlier choice and weight). */
  upsertVote(v: { proposalId: number; wallet: string; choice: GovChoice; weight: bigint; sig: string; message: string; ts?: string }): void {
    this.db
      .prepare(
        `INSERT INTO gov_votes(proposal_id, wallet, choice, weight, sig, message, ts) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(proposal_id, wallet) DO UPDATE SET choice = excluded.choice, weight = excluded.weight, sig = excluded.sig, message = excluded.message, ts = excluded.ts`,
      )
      .run(v.proposalId, v.wallet, v.choice, v.weight.toString(), v.sig, v.message, v.ts ?? nowIso());
  }

  vote(proposalId: number, wallet: string): GovVoteRow | undefined {
    return this.db.prepare<[number, string], GovVoteRow>('SELECT * FROM gov_votes WHERE proposal_id = ? AND wallet = ?').get(proposalId, wallet);
  }

  votes(proposalId: number, limit = 1000): GovVoteRow[] {
    return this.db.prepare<[number, number], GovVoteRow>('SELECT * FROM gov_votes WHERE proposal_id = ? ORDER BY CAST(weight AS INTEGER) DESC, ts ASC LIMIT ?').all(proposalId, limit);
  }

  tally(proposalId: number): GovTally {
    const t: GovTally = { for: 0n, against: 0n, abstain: 0n, voters: 0 };
    for (const r of this.db.prepare<[number], { choice: GovChoice; weight: string }>('SELECT choice, weight FROM gov_votes WHERE proposal_id = ?').all(proposalId)) {
      t[r.choice] += BigInt(r.weight);
      t.voters++;
    }
    return t;
  }
}
