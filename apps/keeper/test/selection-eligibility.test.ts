import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG, withMethodologyOverrides } from '../src/config/methodology.config.js';
import { evaluateEligibility } from '../src/methodology/eligibility.js';
import { rankByMarketCap, selectConstituents } from '../src/methodology/selection.js';
import { runMethodology } from '../src/methodology/run.js';
import type { CandidateToken, EligibilityResult } from '../src/methodology/types.js';
import { DAY } from '../src/util/time.js';

const now = Date.UTC(2026, 9, 2);

function cand(o: Partial<CandidateToken> & { mint: string }): CandidateToken {
  return {
    symbol: o.mint,
    name: o.mint,
    decimals: 6,
    priceUsd: 1,
    fdvUsd: 50_000_000,
    marketCapUsd: 50_000_000,
    volume24hUsd: 1_000_000,
    avgVolume7dUsd: 800_000,
    firstTradeAt: now - 100 * DAY,
    mintAuthority: null,
    freezeAuthority: null,
    sellImpactBps: 50,
    tags: [],
    ...o,
  };
}

describe('eligibility', () => {
  const cfg = DEFAULT_METHODOLOGY_CONFIG;
  it('accepts a clean memecoin', () => {
    expect(evaluateEligibility(cand({ mint: 'WIF' }), cfg, now).eligible).toBe(true);
  });
  it('rejects for each rule with the right reason', () => {
    const cases: [Partial<CandidateToken>, string][] = [
      [{ mintAuthority: 'X' }, 'mint_authority'],
      [{ freezeAuthority: 'X' }, 'freeze_authority'],
      [{ firstTradeAt: now - 3 * DAY }, 'too_young'],
      [{ firstTradeAt: null }, 'age_unknown'],
      [{ fdvUsd: 1_000_000 }, 'fdv_too_low'],
      [{ volume24hUsd: 100_000 }, 'volume_24h_too_low'],
      [{ avgVolume7dUsd: 50_000 }, 'volume_7d_too_low'],
      [{ sellImpactBps: 350 }, 'price_impact_too_high'],
      [{ sellImpactBps: null }, 'price_impact_unknown'],
      [{ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }, 'denylisted'],
      [{ symbol: 'USDT' }, 'excluded_symbol'],
      [{ symbol: 'JITOSOL' }, 'excluded_symbol'],
      [{ tags: ['stablecoin'] }, 'excluded_tag'],
      [{ priceUsd: 0 }, 'no_price'],
    ];
    for (const [patch, reason] of cases) {
      const r = evaluateEligibility(cand({ mint: 'T', ...patch }), cfg, now);
      expect(r.eligible, reason).toBe(false);
      expect(r.reasons, reason).toContain(reason);
    }
  });
  it('uses 24h volume as the 7d proxy when history is missing', () => {
    expect(evaluateEligibility(cand({ mint: 'T', avgVolume7dUsd: null, volume24hUsd: 300_000 }), cfg, now).eligible).toBe(true);
  });
});

describe('selection with buffer rule', () => {
  const cfg = withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { targetCount: 5, bufferRank: 7 });
  const mk = (n: number): EligibilityResult[] =>
    Array.from({ length: n }, (_, i) => ({ mint: `T${i + 1}`, symbol: `T${i + 1}`, eligible: true, reasons: [], marketCapUsd: (n - i) * 1e6 }));

  it('picks top N when there are no incumbents', () => {
    const sel = selectConstituents(rankByMarketCap(mk(12)), new Set(), cfg);
    expect(sel.selected.map((s) => s.mint)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(sel.added).toHaveLength(5);
    expect(sel.removed).toHaveLength(0);
  });

  it('keeps an incumbent ranked between N and buffer; drops one past the buffer', () => {
    const ranked = rankByMarketCap(mk(12));
    const incumbents = new Set(['T1', 'T2', 'T3', 'T7', 'T9']); // T7 rank 7 (<= buffer), T9 rank 9 (> buffer)
    const sel = selectConstituents(ranked, incumbents, cfg);
    const mints = sel.selected.map((s) => s.mint);
    expect(mints).toContain('T7');
    expect(mints).not.toContain('T9');
    expect(sel.bufferKept).toEqual(['T7']);
    expect(sel.removed).toEqual(['T9']);
    // one open seat filled by best non-incumbent (T4)
    expect(mints).toContain('T4');
    expect(mints).toHaveLength(5);
  });

  it('drops the lowest-ranked incumbents when more than N survive the buffer', () => {
    const ranked = rankByMarketCap(mk(12));
    const incumbents = new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
    const sel = selectConstituents(ranked, incumbents, cfg);
    expect(sel.selected.map((s) => s.mint)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(sel.removed.sort()).toEqual(['T6', 'T7']);
  });

  it('drops incumbents that became ineligible', () => {
    const list = mk(8);
    const t2 = list[1];
    if (t2) {
      t2.eligible = false;
      t2.reasons = ['freeze_authority'];
    }
    const sel = selectConstituents(rankByMarketCap(list), new Set(['T1', 'T2']), cfg);
    expect(sel.removed).toEqual(['T2']);
  });
});

describe('runMethodology end-to-end', () => {
  it('produces equal weights summing to 10_000 for the selected set', () => {
    const cfg = withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { targetCount: 7, bufferRank: 9 });
    const cands = Array.from({ length: 20 }, (_, i) => cand({ mint: `C${i}`, marketCapUsd: (20 - i) * 3e6, fdvUsd: (20 - i) * 3e6 }));
    const r = runMethodology(cands, new Set(), cfg, new Date(now));
    expect(r.selection.selected).toHaveLength(7);
    expect(r.weights.reduce((s, w) => s + w.weightBps, 0)).toBe(10_000);
    expect(new Set(r.weights.map((w) => w.weightBps)).size).toBeLessThanOrEqual(2);
  });
});
