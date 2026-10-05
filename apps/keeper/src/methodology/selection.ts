import type { MethodologyConfig } from '../config/methodology.config.js';
import type { EligibilityResult, RankedToken, SelectionResult } from './types.js';

/** Ranks eligible tokens by market cap (desc). Ties broken by mint for determinism. */
export function rankByMarketCap(eligible: readonly EligibilityResult[]): RankedToken[] {
  return eligible
    .filter((e) => e.eligible)
    .sort((a, b) => b.marketCapUsd - a.marketCapUsd || a.mint.localeCompare(b.mint))
    .map((e, i) => ({ mint: e.mint, symbol: e.symbol, marketCapUsd: e.marketCapUsd, rank: i + 1, cgRank: e.cgRank ?? null, source: e.source }));
}

/**
 * S&P-style buffer selection:
 *  - incumbents stay while rank <= bufferRank (and still eligible);
 *  - open seats are filled by the highest-ranked non-incumbents;
 *  - if more incumbents than seats survive, the lowest ranked are dropped.
 */
export function selectConstituents(
  ranked: readonly RankedToken[],
  incumbents: ReadonlySet<string>,
  cfg: MethodologyConfig,
): SelectionResult {
  const { targetCount, bufferRank } = cfg.selection;
  const byMint = new Map(ranked.map((r) => [r.mint, r]));

  const survivors = [...incumbents]
    .map((m) => byMint.get(m))
    .filter((r): r is RankedToken => r !== undefined && r.rank <= bufferRank)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, targetCount);

  const chosen = new Map<string, RankedToken>(survivors.map((r) => [r.mint, r]));
  for (const r of ranked) {
    if (chosen.size >= targetCount) break;
    if (!chosen.has(r.mint) && !incumbents.has(r.mint)) chosen.set(r.mint, r);
  }
  // If still short (few eligible), allow incumbents beyond buffer? No: fewer constituents is acceptable.

  const selected = [...chosen.values()].sort((a, b) => a.rank - b.rank);
  const selectedSet = new Set(selected.map((s) => s.mint));
  return {
    selected,
    added: selected.filter((s) => !incumbents.has(s.mint)).map((s) => s.mint),
    removed: [...incumbents].filter((m) => !selectedSet.has(m)),
    bufferKept: selected.filter((s) => incumbents.has(s.mint) && s.rank > targetCount).map((s) => s.mint),
  };
}
