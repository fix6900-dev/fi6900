/** Typed data access. Raw u64/u128 are stored as decimal strings. */
import type { Db } from './db.js';
import { nowIso } from '../util/time.js';
import { stringifyBig, parseJson } from '../util/json.js';
import type { AuctionStatus } from '../chain/types.js';
import { GovRepo } from './gov-repo.js';

export type FlywheelKind =
  | 'claim'
  | 'buy_index'
  | 'add_lp'
  | 'airdrop'
  | 'buyback'
  | 'burn'
  | 'create'
  | 'redeem'
  | 'auction_start'
  | 'auction_fill'
  | 'fee_accrual'
  | 'treasury'
  | 'governance';

export interface FlywheelEventRow {
  id: number;
  kind: FlywheelKind;
  ts: string;
  sig: string;
  amounts: Record<string, unknown>;
  note: string | null;
}

export interface NavSnapshotRow {
  id: number;
  ts: string;
  nav_usd: number;
  nav_per_unit_usd: number;
  index_level: number;
  divisor: number;
  market_price_usd: number | null;
  premium_bps: number | null;
  supply: string;
  epoch: string;
  sol_price_usd: number | null;
}

export interface HoldingSnapshotInput {
  slot: number;
  mint: string;
  balance: bigint;
  priceUsd: number;
  valueUsd: number;
  weightBps: number;
  targetWeightBps: number;
}

export interface AuctionRow {
  pda: string;
  nonce: string;
  sell_mint: string;
  buy_mint: string;
  sell_total: string;
  sell_remaining: string;
  start_price: string;
  end_price: string;
  start_slot: string;
  end_slot: string;
  status: AuctionStatus;
  mid_price: number | null;
  reason: string | null;
  start_sig: string | null;
  created_ts: string;
  updated_ts: string;
}

export interface AuctionFillRow {
  id: number;
  auction_pda: string;
  sig: string;
  filler: string;
  sell_amount: string;
  buy_amount: string;
  price: string;
  slot: number;
  ts: string;
}

export interface AirdropRoundRow {
  id: number;
  ts: string;
  total_units: string;
  holders: number;
  paid: number;
  skipped: number;
  carried_units: string;
  tx_count: number;
  status: string;
}

export interface AirdropPayoutRow {
  id: number;
  round_id: number;
  wallet: string;
  units: string;
  sig: string;
  ts: string;
}

export interface AnnouncementRow {
  id: number;
  ts: string;
  title: string;
  body: string;
  key: string | null;
}

export interface MethodologyRunRow {
  id: number;
  ts: string;
  config_version: string;
  config: string;
  eligible: string;
  selected: string;
  weights: string;
  dry: number;
  applied: number;
}

export interface QueuedTradeRow {
  id: number;
  ts: string;
  sell_mint: string;
  buy_mint: string;
  sell_amount: string;
  reason: string;
  status: string;
}

export class Repo {
  readonly governance: GovernanceRepo;
  /** Holder governance (token-weighted voting). */
  readonly gov: GovRepo;
  constructor(readonly db: Db) {
    this.governance = new GovernanceRepo(db);
    this.gov = new GovRepo(db);
  }

  // ---- kv ----
  getKv(key: string): string | undefined {
    return this.db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?').get(key)?.value;
  }

  getKvJson<T>(key: string, fallback: T): T {
    return parseJson(this.getKv(key), fallback);
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv(key, value, updated_ts) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ts = excluded.updated_ts')
      .run(key, value, nowIso());
  }

  setKvJson(key: string, value: unknown): void {
    this.setKv(key, stringifyBig(value));
  }

  // ---- nav ----
  insertNavSnapshot(s: {
    ts: string;
    navUsd: number;
    navPerUnitUsd: number;
    indexLevel: number;
    divisor: number;
    marketPriceUsd: number | null;
    premiumBps: number | null;
    supply: bigint;
    epoch: bigint;
    solPriceUsd: number | null;
    holdings: HoldingSnapshotInput[];
  }): number {
    const tx = this.db.transaction(() => {
      const r = this.db
        .prepare(
          `INSERT INTO nav_snapshots(ts, nav_usd, nav_per_unit_usd, index_level, divisor, market_price_usd, premium_bps, supply, epoch, sol_price_usd)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(s.ts, s.navUsd, s.navPerUnitUsd, s.indexLevel, s.divisor, s.marketPriceUsd, s.premiumBps, s.supply.toString(), s.epoch.toString(), s.solPriceUsd);
      const id = Number(r.lastInsertRowid);
      const ins = this.db.prepare(
        `INSERT INTO holdings_snapshots(snapshot_id, slot, mint, balance, price_usd, value_usd, weight_bps, target_weight_bps) VALUES(?,?,?,?,?,?,?,?)`,
      );
      for (const h of s.holdings) ins.run(id, h.slot, h.mint, h.balance.toString(), h.priceUsd, h.valueUsd, h.weightBps, h.targetWeightBps);
      return id;
    });
    return tx();
  }

  latestNav(): NavSnapshotRow | undefined {
    return this.db.prepare<[], NavSnapshotRow>('SELECT * FROM nav_snapshots ORDER BY id DESC LIMIT 1').get();
  }

  navHistory(sinceIso: string | null, maxPoints = 2000): NavSnapshotRow[] {
    const rows = sinceIso
      ? this.db.prepare<[string], NavSnapshotRow>('SELECT * FROM nav_snapshots WHERE ts >= ? ORDER BY ts ASC').all(sinceIso)
      : this.db.prepare<[], NavSnapshotRow>('SELECT * FROM nav_snapshots ORDER BY ts ASC').all();
    if (rows.length <= maxPoints) return rows;
    const step = rows.length / maxPoints;
    const out: NavSnapshotRow[] = [];
    for (let i = 0; i < rows.length; i += step) {
      const r = rows[Math.floor(i)];
      if (r) out.push(r);
    }
    const last = rows[rows.length - 1];
    if (last && out[out.length - 1] !== last) out.push(last);
    return out;
  }

  pruneNav(olderThanIso: string): number {
    return this.db.prepare('DELETE FROM nav_snapshots WHERE ts < ?').run(olderThanIso).changes;
  }

  // ---- auctions ----
  upsertAuction(a: Omit<AuctionRow, 'created_ts' | 'updated_ts'>): void {
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO auctions(pda, nonce, sell_mint, buy_mint, sell_total, sell_remaining, start_price, end_price, start_slot, end_slot, status, mid_price, reason, start_sig, created_ts, updated_ts)
         VALUES(@pda,@nonce,@sell_mint,@buy_mint,@sell_total,@sell_remaining,@start_price,@end_price,@start_slot,@end_slot,@status,@mid_price,@reason,@start_sig,@ts,@ts)
         ON CONFLICT(pda) DO UPDATE SET sell_remaining = excluded.sell_remaining, status = excluded.status, updated_ts = excluded.updated_ts,
           mid_price = COALESCE(auctions.mid_price, excluded.mid_price), reason = COALESCE(auctions.reason, excluded.reason), start_sig = COALESCE(auctions.start_sig, excluded.start_sig)`,
      )
      .run({ ...a, ts });
  }

  listAuctions(status: 'open' | 'all', limit = 200): AuctionRow[] {
    return status === 'open'
      ? this.db.prepare<[number], AuctionRow>("SELECT * FROM auctions WHERE status = 'open' ORDER BY created_ts DESC LIMIT ?").all(limit)
      : this.db.prepare<[number], AuctionRow>('SELECT * FROM auctions ORDER BY created_ts DESC LIMIT ?').all(limit);
  }

  getAuction(pda: string): AuctionRow | undefined {
    return this.db.prepare<[string], AuctionRow>('SELECT * FROM auctions WHERE pda = ?').get(pda);
  }

  insertFill(f: { auctionPda: string; sig: string; filler: string; sellAmount: bigint; buyAmount: bigint; price: bigint; slot: number; ts?: string }): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO auction_fills(auction_pda, sig, filler, sell_amount, buy_amount, price, slot, ts) VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(f.auctionPda, f.sig, f.filler, f.sellAmount.toString(), f.buyAmount.toString(), f.price.toString(), f.slot, f.ts ?? nowIso());
    return r.changes > 0;
  }

  fillsFor(auctionPda: string): AuctionFillRow[] {
    return this.db.prepare<[string], AuctionFillRow>('SELECT * FROM auction_fills WHERE auction_pda = ? ORDER BY slot ASC').all(auctionPda);
  }

  // ---- rebalance queue ----
  enqueueTrade(t: { sellMint: string; buyMint: string; sellAmount: bigint; reason: string }): number {
    const r = this.db
      .prepare('INSERT INTO rebalance_queue(ts, sell_mint, buy_mint, sell_amount, reason) VALUES(?,?,?,?,?)')
      .run(nowIso(), t.sellMint, t.buyMint, t.sellAmount.toString(), t.reason);
    return Number(r.lastInsertRowid);
  }

  queuedTrades(): QueuedTradeRow[] {
    return this.db.prepare<[], QueuedTradeRow>("SELECT * FROM rebalance_queue WHERE status = 'queued' ORDER BY id ASC").all();
  }

  setQueuedStatus(id: number, status: 'opened' | 'dropped'): void {
    this.db.prepare('UPDATE rebalance_queue SET status = ? WHERE id = ?').run(status, id);
  }

  clearQueue(): void {
    this.db.prepare("UPDATE rebalance_queue SET status = 'dropped' WHERE status = 'queued'").run();
  }

  // ---- flywheel ----
  insertFlywheelEvent(e: { kind: FlywheelKind; sig: string; amounts: Record<string, unknown>; note?: string; ts?: string }): number {
    const r = this.db
      .prepare('INSERT INTO flywheel_events(kind, ts, sig, amounts, note) VALUES(?,?,?,?,?)')
      .run(e.kind, e.ts ?? nowIso(), e.sig, stringifyBig(e.amounts), e.note ?? null);
    return Number(r.lastInsertRowid);
  }

  flywheelEvents(limit = 50, cursor?: number, kind?: FlywheelKind): FlywheelEventRow[] {
    type Raw = Omit<FlywheelEventRow, 'amounts'> & { amounts: string };
    const where: string[] = [];
    const params: (number | string)[] = [];
    if (cursor !== undefined) {
      where.push('id < ?');
      params.push(cursor);
    }
    if (kind) {
      where.push('kind = ?');
      params.push(kind);
    }
    params.push(limit);
    const sql = `SELECT * FROM flywheel_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    return this.db
      .prepare<(number | string)[], Raw>(sql)
      .all(...params)
      .map((r) => ({ ...r, amounts: parseJson<Record<string, unknown>>(r.amounts, {}) }));
  }

  /** Sum of a numeric field across events of a kind (sig != dry-run optional). */
  sumFlywheel(kind: FlywheelKind, field: string): number {
    const rows = this.db.prepare<[string], { amounts: string }>('SELECT amounts FROM flywheel_events WHERE kind = ?').all(kind);
    let s = 0;
    for (const r of rows) {
      const v = parseJson<Record<string, unknown>>(r.amounts, {})[field];
      const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0;
      if (Number.isFinite(n)) s += n;
    }
    return s;
  }

  countFlywheel(kind: FlywheelKind): number {
    return this.db.prepare<[string], { n: number }>('SELECT COUNT(*) n FROM flywheel_events WHERE kind = ?').get(kind)?.n ?? 0;
  }

  // ---- airdrops ----
  insertAirdropRound(r: { totalUnits: bigint; holders: number; paid: number; skipped: number; carriedUnits: bigint; txCount: number; status: string }): number {
    const res = this.db
      .prepare('INSERT INTO airdrop_rounds(ts, total_units, holders, paid, skipped, carried_units, tx_count, status) VALUES(?,?,?,?,?,?,?,?)')
      .run(nowIso(), r.totalUnits.toString(), r.holders, r.paid, r.skipped, r.carriedUnits.toString(), r.txCount, r.status);
    return Number(res.lastInsertRowid);
  }

  insertPayouts(roundId: number, payouts: { wallet: string; units: bigint; sig: string }[]): void {
    const ins = this.db.prepare('INSERT INTO airdrop_payouts(round_id, wallet, units, sig, ts) VALUES(?,?,?,?,?)');
    const ts = nowIso();
    this.db.transaction(() => {
      for (const p of payouts) ins.run(roundId, p.wallet, p.units.toString(), p.sig, ts);
    })();
  }

  payoutsFor(wallet: string, limit = 200): AirdropPayoutRow[] {
    return this.db.prepare<[string, number], AirdropPayoutRow>('SELECT * FROM airdrop_payouts WHERE wallet = ? ORDER BY id DESC LIMIT ?').all(wallet, limit);
  }

  airdropRounds(limit = 100): AirdropRoundRow[] {
    return this.db.prepare<[number], AirdropRoundRow>('SELECT * FROM airdrop_rounds ORDER BY id DESC LIMIT ?').all(limit);
  }

  airdropTotals(): { rounds: number; units: bigint } {
    // Units = confirmed payouts only (a round whose batches failed re-pays those shares in a later round).
    const r = this.db.prepare<[], { n: number }>('SELECT COUNT(*) n FROM airdrop_rounds').get();
    const p = this.db.prepare<[], { total: string | null }>("SELECT SUM(CAST(units AS INTEGER)) total FROM airdrop_payouts WHERE sig != 'failed' AND sig != 'dry-run'").get();
    return { rounds: r?.n ?? 0, units: BigInt(Math.round(Number(p?.total ?? 0))) };
  }

  // ---- carry ----
  getCarry(): Map<string, bigint> {
    const rows = this.db.prepare<[], { wallet: string; units: string }>('SELECT wallet, units FROM carry').all();
    return new Map(rows.map((r) => [r.wallet, BigInt(r.units)]));
  }

  setCarry(entries: ReadonlyMap<string, bigint>): void {
    const ts = nowIso();
    const up = this.db.prepare('INSERT INTO carry(wallet, units, updated_ts) VALUES(?,?,?) ON CONFLICT(wallet) DO UPDATE SET units = excluded.units, updated_ts = excluded.updated_ts');
    const del = this.db.prepare('DELETE FROM carry WHERE wallet = ?');
    this.db.transaction(() => {
      for (const [w, u] of entries) {
        if (u > 0n) up.run(w, u.toString(), ts);
        else del.run(w);
      }
    })();
  }

  // ---- announcements ----
  insertAnnouncement(a: { title: string; body: string; key?: string; ts?: string }): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO announcements(ts, title, body, key) VALUES(?,?,?,?)').run(a.ts ?? nowIso(), a.title, a.body, a.key ?? null);
    return r.changes > 0;
  }

  announcements(limit = 50): AnnouncementRow[] {
    return this.db.prepare<[number], AnnouncementRow>('SELECT * FROM announcements ORDER BY ts DESC LIMIT ?').all(limit);
  }

  // ---- methodology ----
  insertMethodologyRun(r: { ts: string; configVersion: string; config: unknown; eligible: unknown; selected: unknown; weights: unknown; dry: boolean; applied: boolean }): number {
    const res = this.db
      .prepare('INSERT INTO methodology_runs(ts, config_version, config, eligible, selected, weights, dry, applied) VALUES(?,?,?,?,?,?,?,?)')
      .run(r.ts, r.configVersion, stringifyBig(r.config), stringifyBig(r.eligible), stringifyBig(r.selected), stringifyBig(r.weights), r.dry ? 1 : 0, r.applied ? 1 : 0);
    return Number(res.lastInsertRowid);
  }

  latestMethodologyRun(): MethodologyRunRow | undefined {
    return this.db.prepare<[], MethodologyRunRow>('SELECT * FROM methodology_runs ORDER BY id DESC LIMIT 1').get();
  }

  // ---- market observations (for 7d avg volume) ----
  recordObservation(mint: string, day: string, volume24h: number, fdvUsd: number, priceUsd: number): void {
    this.db
      .prepare('INSERT INTO market_observations(mint, day, volume24h, fdv_usd, price_usd) VALUES(?,?,?,?,?) ON CONFLICT(mint, day) DO UPDATE SET volume24h = excluded.volume24h, fdv_usd = excluded.fdv_usd, price_usd = excluded.price_usd')
      .run(mint, day, volume24h, fdvUsd, priceUsd);
  }

  avgVolume7d(mint: string): { avg: number; days: number } | null {
    const r = this.db
      .prepare<[string], { avg: number | null; days: number }>(
        "SELECT AVG(volume24h) avg, COUNT(*) days FROM (SELECT volume24h FROM market_observations WHERE mint = ? ORDER BY day DESC LIMIT 7)",
      )
      .get(mint);
    if (!r || r.days === 0 || r.avg === null) return null;
    return { avg: r.avg, days: r.days };
  }

  // ---- holder snapshots ----
  insertHolderSnapshot(mint: string, supply: bigint, holders: { owner: string; amount: bigint }[], keepTop = 500): number {
    const r = this.db
      .prepare('INSERT INTO holder_snapshots(ts, mint, holders, supply, data) VALUES(?,?,?,?,?)')
      .run(nowIso(), mint, holders.length, supply.toString(), stringifyBig(holders.slice(0, keepTop)));
    return Number(r.lastInsertRowid);
  }
}

// ---------------------------------------------------------------------------
// Governance: reconstitution proposals + timelocked action mirror
// ---------------------------------------------------------------------------

export type ProposalAction = 'add' | 'remove';
export type ProposalStatus = 'proposed' | 'approved' | 'rejected' | 'queued' | 'executed';

export interface ProposalRow {
  id: number;
  mint: string;
  symbol: string | null;
  action: ProposalAction;
  reason: string;
  status: ProposalStatus;
  weight_bps: number | null;
  proposed_ts: string;
  decided_ts: string | null;
  queued_ts: string | null;
  executed_ts: string | null;
  action_pda: string | null;
  queued_sig: string | null;
  note: string | null;
}

export interface GovernanceActionRow {
  pda: string;
  nonce: string;
  kind: number;
  payload: string;
  eta_slot: string;
  proposer: string;
  queued_sig: string | null;
  executed_sig: string | null;
  status: 'queued' | 'executed' | 'cancelled';
  label: string | null;
  created_ts: string;
  updated_ts: string;
}

export class GovernanceRepo {
  constructor(readonly db: Db) {}

  // ---- proposals ----
  insertProposal(p: { mint: string; symbol?: string | null; action: ProposalAction; reason: unknown; status?: ProposalStatus; weightBps?: number | null; note?: string | null; ts?: string }): number {
    const r = this.db
      .prepare('INSERT INTO reconstitution_proposals(mint, symbol, action, reason, status, weight_bps, proposed_ts, note) VALUES(?,?,?,?,?,?,?,?)')
      .run(p.mint, p.symbol ?? null, p.action, stringifyBig(p.reason), p.status ?? 'proposed', p.weightBps ?? null, p.ts ?? nowIso(), p.note ?? null);
    return Number(r.lastInsertRowid);
  }

  proposals(status?: ProposalStatus | ProposalStatus[], limit = 500): ProposalRow[] {
    if (!status) return this.db.prepare<[number], ProposalRow>('SELECT * FROM reconstitution_proposals ORDER BY id DESC LIMIT ?').all(limit);
    const list = Array.isArray(status) ? status : [status];
    const q = list.map(() => '?').join(',');
    return this.db.prepare<(string | number)[], ProposalRow>(`SELECT * FROM reconstitution_proposals WHERE status IN (${q}) ORDER BY id DESC LIMIT ?`).all(...list, limit);
  }

  proposalsForMint(mint: string): ProposalRow[] {
    return this.db.prepare<[string], ProposalRow>('SELECT * FROM reconstitution_proposals WHERE mint = ? ORDER BY id DESC').all(mint);
  }

  /** The open (proposed/approved/queued) proposal for a mint, if any. */
  openProposal(mint: string): ProposalRow | undefined {
    return this.db
      .prepare<[string], ProposalRow>("SELECT * FROM reconstitution_proposals WHERE mint = ? AND status IN ('proposed','approved','queued') ORDER BY id DESC LIMIT 1")
      .get(mint);
  }

  latestRejection(mint: string, action: ProposalAction): ProposalRow | undefined {
    return this.db
      .prepare<[string, string], ProposalRow>("SELECT * FROM reconstitution_proposals WHERE mint = ? AND action = ? AND status = 'rejected' ORDER BY decided_ts DESC LIMIT 1")
      .get(mint, action);
  }

  getProposal(id: number): ProposalRow | undefined {
    return this.db.prepare<[number], ProposalRow>('SELECT * FROM reconstitution_proposals WHERE id = ?').get(id);
  }

  updateProposal(id: number, patch: Partial<Pick<ProposalRow, 'status' | 'weight_bps' | 'decided_ts' | 'queued_ts' | 'executed_ts' | 'action_pda' | 'queued_sig' | 'note'>>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE reconstitution_proposals SET ${sets} WHERE id = @id`).run({ ...patch, id });
  }

  // ---- governance actions ----
  insertGovernanceAction(a: { pda: string; nonce: bigint; kind: number; payload: unknown; etaSlot: bigint; proposer: string; queuedSig: string | null; label?: string | null }): void {
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO governance_actions(pda, nonce, kind, payload, eta_slot, proposer, queued_sig, executed_sig, status, label, created_ts, updated_ts)
         VALUES(?,?,?,?,?,?,?,NULL,'queued',?,?,?) ON CONFLICT(pda) DO UPDATE SET queued_sig = COALESCE(governance_actions.queued_sig, excluded.queued_sig), updated_ts = excluded.updated_ts`,
      )
      .run(a.pda, a.nonce.toString(), a.kind, stringifyBig(a.payload), a.etaSlot.toString(), a.proposer, a.queuedSig, a.label ?? null, ts, ts);
  }

  setGovernanceActionStatus(pda: string, status: 'executed' | 'cancelled', sig: string | null): void {
    this.db.prepare('UPDATE governance_actions SET status = ?, executed_sig = COALESCE(?, executed_sig), updated_ts = ? WHERE pda = ?').run(status, sig, nowIso(), pda);
  }

  governanceAction(pda: string): GovernanceActionRow | undefined {
    return this.db.prepare<[string], GovernanceActionRow>('SELECT * FROM governance_actions WHERE pda = ?').get(pda);
  }

  governanceActions(status?: GovernanceActionRow['status'], limit = 200): GovernanceActionRow[] {
    return status
      ? this.db.prepare<[string, number], GovernanceActionRow>('SELECT * FROM governance_actions WHERE status = ? ORDER BY CAST(nonce AS INTEGER) DESC LIMIT ?').all(status, limit)
      : this.db.prepare<[number], GovernanceActionRow>('SELECT * FROM governance_actions ORDER BY CAST(nonce AS INTEGER) DESC LIMIT ?').all(limit);
  }
}
