import type { MethodologyConfig } from '../config/methodology.config.js';
import { DAY, HOUR } from '../util/time.js';

/** Next reconstitution effective date strictly after `now`. */
export function nextReconstitution(now: Date, cfg: MethodologyConfig): Date {
  const { dayOfMonth, hourUtc } = cfg.reconstitution;
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, hourUtc));
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dayOfMonth, hourUtc));
}

/** The announcement for the next reconstitution should be published at this instant. */
export function announcementTime(now: Date, cfg: MethodologyConfig): Date {
  return new Date(nextReconstitution(now, cfg).getTime() - cfg.reconstitution.announceHoursAhead * HOUR);
}

/** True inside the announcement window (between announce time and effective time). */
export function isInAnnouncementWindow(now: Date, cfg: MethodologyConfig): boolean {
  const next = nextReconstitution(now, cfg);
  return now.getTime() >= next.getTime() - cfg.reconstitution.announceHoursAhead * HOUR;
}

/** True once per reconstitution date: the previous effective instant is within the last `graceMs`. */
export function isReconstitutionDue(now: Date, lastReconstitutionMs: number | null, cfg: MethodologyConfig): boolean {
  const next = nextReconstitution(now, cfg);
  const prev = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() - 1, cfg.reconstitution.dayOfMonth, cfg.reconstitution.hourUtc));
  return lastReconstitutionMs === null || lastReconstitutionMs < prev.getTime();
}

export function isScheduledRebalanceDue(now: Date, lastRebalanceMs: number | null, cfg: MethodologyConfig): boolean {
  if (lastRebalanceMs === null) return true;
  return now.getTime() - lastRebalanceMs >= cfg.rebalance.intervalDays * DAY;
}

export interface DriftCheck {
  mint: string;
  weightBps: number;
  targetWeightBps: number;
  driftBps: number;
}

/** Relative drift of one holding in bps: |actual - target| / target. Infinity when target is 0 and weight > 0. */
export function relativeDriftBps(d: Pick<DriftCheck, 'weightBps' | 'targetWeightBps'>): number {
  if (d.targetWeightBps <= 0) return d.weightBps > 0 ? Number.POSITIVE_INFINITY : 0;
  return Math.round((Math.abs(d.weightBps - d.targetWeightBps) / d.targetWeightBps) * 10_000);
}

/** Holdings whose weight is more than driftRelativeBps away from target, relative to the target. */
export function driftTriggered(drifts: readonly DriftCheck[], cfg: MethodologyConfig): DriftCheck[] {
  return drifts.filter((d) => relativeDriftBps(d) > cfg.rebalance.driftRelativeBps);
}

export function nextScheduledRebalance(lastRebalanceMs: number | null, cfg: MethodologyConfig, now = new Date()): Date {
  if (lastRebalanceMs === null) return now;
  return new Date(lastRebalanceMs + cfg.rebalance.intervalDays * DAY);
}
