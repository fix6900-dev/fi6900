import type { MethodologyConfig } from '../config/methodology.config.js';
import { filterEligible } from './eligibility.js';
import { rankByMarketCap, selectConstituents } from './selection.js';
import type { CandidateToken, MethodologyRunResult } from './types.js';
import { computeTargetWeights } from './weighting.js';

/** One full methodology pass: eligibility -> ranking -> buffer selection -> weights. Pure. */
export function runMethodology(
  candidates: readonly CandidateToken[],
  incumbents: ReadonlySet<string>,
  cfg: MethodologyConfig,
  now: Date = new Date(),
): MethodologyRunResult {
  const eligible = filterEligible(candidates, cfg, now.getTime());
  const ranked = rankByMarketCap(eligible);
  const selection = selectConstituents(ranked, incumbents, cfg);
  const weights = computeTargetWeights(
    selection.selected.map((s) => ({ mint: s.mint, symbol: s.symbol, marketCapUsd: s.marketCapUsd })),
    cfg,
  );
  return { ts: now.toISOString(), configVersion: cfg.version, universe: { ...cfg.universe }, eligible, selection, weights };
}
