/**
 * Pure state machine for reconstitution proposals (the "index committee" mode).
 *
 *   proposed --approve--> approved --queue--> queued --execute--> executed
 *   proposed --reject---> rejected            (rejections suppress re-proposal for rejectCooldownDays)
 *   approved --reject---> rejected
 */
import type { ProposalAction, ProposalRow, ProposalStatus } from '../db/repo.js';

export type ProposalEvent = 'approve' | 'reject' | 'queue' | 'execute';

const TRANSITIONS: Record<ProposalStatus, Partial<Record<ProposalEvent, ProposalStatus>>> = {
  proposed: { approve: 'approved', reject: 'rejected' },
  approved: { queue: 'queued', reject: 'rejected' },
  queued: { execute: 'executed' },
  rejected: {},
  executed: {},
};

export function transition(status: ProposalStatus, event: ProposalEvent): ProposalStatus {
  const next = TRANSITIONS[status][event];
  if (!next) throw new Error(`invalid proposal transition: ${status} --${event}-->`);
  return next;
}

export function canTransition(status: ProposalStatus, event: ProposalEvent): boolean {
  return TRANSITIONS[status][event] !== undefined;
}

/** True while a rejection is still inside its cooldown window. */
export function isSuppressed(rejectedTs: string | null | undefined, nowMs: number, cooldownDays: number): boolean {
  if (!rejectedTs || cooldownDays <= 0) return false;
  const t = Date.parse(rejectedTs);
  return Number.isFinite(t) && nowMs - t < cooldownDays * 86_400_000;
}

export interface IndicatedChange {
  mint: string;
  symbol: string;
  action: ProposalAction;
  /** target weight for adds (bps) */
  weightBps: number | null;
  /** metrics the methodology used (rank, market cap, eligibility flags...) */
  metrics: Record<string, unknown>;
}

export interface ReconcileResult {
  /** New proposals to insert (status proposed, or approved in auto mode). */
  create: IndicatedChange[];
  /** Indicated changes skipped because an open proposal already exists. */
  alreadyOpen: string[];
  /** Indicated changes skipped because a rejection is inside its cooldown. */
  suppressed: string[];
}

/**
 * Decide which indicated changes become new proposals. `existing` is every proposal row for the
 * fund (any status); open rows (proposed/approved/queued) and in-cooldown rejections block.
 */
export function reconcileProposals(indicated: readonly IndicatedChange[], existing: readonly ProposalRow[], nowMs: number, cooldownDays: number): ReconcileResult {
  const out: ReconcileResult = { create: [], alreadyOpen: [], suppressed: [] };
  for (const c of indicated) {
    const rows = existing.filter((r) => r.mint === c.mint);
    const open = rows.find((r) => r.status === 'proposed' || r.status === 'approved' || r.status === 'queued');
    if (open) {
      out.alreadyOpen.push(c.mint);
      continue;
    }
    const rejected = rows
      .filter((r) => r.status === 'rejected' && r.action === c.action)
      .sort((a, b) => Date.parse(b.decided_ts ?? '') - Date.parse(a.decided_ts ?? ''))[0];
    if (rejected && isSuppressed(rejected.decided_ts, nowMs, cooldownDays)) {
      out.suppressed.push(c.mint);
      continue;
    }
    out.create.push(c);
  }
  return out;
}

/** Equal-weight target after the approved adds/removes land (bps, rounded; last slot absorbs rounding). */
export function equalWeightAfter(currentActive: number, adds: number, removes: number): number {
  const n = currentActive + adds - removes;
  return n > 0 ? Math.floor(10_000 / n) : 0;
}
