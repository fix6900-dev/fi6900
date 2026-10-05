import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG } from '../src/config/methodology.config.js';
import { announcementTime, driftTriggered, isInAnnouncementWindow, isScheduledRebalanceDue, nextReconstitution, relativeDriftBps } from '../src/methodology/schedule.js';
import { DAY } from '../src/util/time.js';

const cfg = DEFAULT_METHODOLOGY_CONFIG;

describe('reconstitution schedule', () => {
  it('next reconstitution is the 1st of next month 00:00 UTC', () => {
    expect(nextReconstitution(new Date(Date.UTC(2026, 9, 15, 12)), cfg).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(nextReconstitution(new Date(Date.UTC(2026, 11, 31, 23, 59)), cfg).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('on the 1st at exactly 00:00 the next one is a month later', () => {
    expect(nextReconstitution(new Date(Date.UTC(2026, 10, 1, 0, 0)), cfg).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
  it('announcement is 48h ahead', () => {
    const now = new Date(Date.UTC(2026, 9, 20));
    expect(announcementTime(now, cfg).toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(isInAnnouncementWindow(new Date(Date.UTC(2026, 9, 29)), cfg)).toBe(false);
    expect(isInAnnouncementWindow(new Date(Date.UTC(2026, 9, 30, 1)), cfg)).toBe(true);
  });
});

describe('rebalance triggers', () => {
  it('scheduled every intervalDays', () => {
    const now = new Date(Date.UTC(2026, 9, 10));
    expect(isScheduledRebalanceDue(now, null, cfg)).toBe(true);
    expect(isScheduledRebalanceDue(now, now.getTime() - 6 * DAY, cfg)).toBe(false);
    expect(isScheduledRebalanceDue(now, now.getTime() - 7 * DAY, cfg)).toBe(true);
  });
  it('drift band is relative to the target (|actual-target|/target > driftRelativeBps)', () => {
    const d = driftTriggered(
      [
        { mint: 'a', weightBps: 260, targetWeightBps: 250, driftBps: 10 }, // +4%
        { mint: 'b', weightBps: 520, targetWeightBps: 250, driftBps: 270 }, // +108% -> triggers
        { mint: 'c', weightBps: 375, targetWeightBps: 250, driftBps: 125 }, // exactly +50% -> not triggered
        { mint: 'd', weightBps: 124, targetWeightBps: 250, driftBps: -126 }, // -50.4% -> triggers
        { mint: 'e', weightBps: 10, targetWeightBps: 0, driftBps: 10 }, // removing asset with weight -> triggers
        { mint: 'f', weightBps: 0, targetWeightBps: 0, driftBps: 0 },
      ],
      cfg,
    );
    expect(d.map((x) => x.mint)).toEqual(['b', 'd', 'e']);
    expect(relativeDriftBps({ weightBps: 375, targetWeightBps: 250 })).toBe(5000);
    expect(relativeDriftBps({ weightBps: 10, targetWeightBps: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(cfg.rebalance.driftRelativeBps).toBe(5000);
    expect(cfg.rebalance.intervalDays).toBe(7);
  });
});
