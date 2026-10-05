import type { MethodologyConfig } from '../config/methodology.config.js';
import { DAY } from '../util/time.js';
import type { CandidateToken, EligibilityResult, IneligibilityReason } from './types.js';

export function evaluateEligibility(c: CandidateToken, cfg: MethodologyConfig, nowMs: number): EligibilityResult {
  const e = cfg.eligibility;
  const reasons: IneligibilityReason[] = [];

  if (e.denylist.includes(c.mint)) reasons.push('denylisted');
  const sym = c.symbol.toUpperCase();
  if (e.excludedSymbolPatterns.some((p) => new RegExp(p, 'i').test(sym))) reasons.push('excluded_symbol');
  const excludedTags = new Set((e.excludedTags ?? []).map((t) => t.toLowerCase()));
  if (c.tags.some((t) => excludedTags.has(t.toLowerCase()))) reasons.push('excluded_tag');
  if (e.requireAnyTag && e.requireAnyTag.length > 0) {
    const need = new Set(e.requireAnyTag.map((t) => t.toLowerCase()));
    if (!c.tags.some((t) => need.has(t.toLowerCase()))) reasons.push('missing_tag');
  }

  if (e.requireAuthoritiesRevoked) {
    if (c.mintAuthority) reasons.push('mint_authority');
    if (c.freezeAuthority) reasons.push('freeze_authority');
  }
  // Rule 2.7: a transfer fee taxes every vault deposit, withdrawal and auction fill (ineligible by rule; the committee
  // may override with `add-asset --force` / basket `allowTransferFee` since the program credits received amounts);
  // a transfer hook can intercept or refuse vault transfers and is never admissible.
  if ((c.transferFeeBps ?? 0) > 0) reasons.push('transfer_fee');
  if (c.transferHookProgram) reasons.push('transfer_hook');

  if (!(c.priceUsd > 0)) reasons.push('no_price');

  if (c.firstTradeAt === null) reasons.push('age_unknown');
  else if (nowMs - c.firstTradeAt < e.minAgeDays * DAY) reasons.push('too_young');

  if (c.fdvUsd < e.minFdvUsd) reasons.push('fdv_too_low');
  if (c.volume24hUsd < e.minVolume24hUsd) reasons.push('volume_24h_too_low');
  // With too few observations we fall back to today's volume as the proxy (documented in methodology.md).
  const avg7 = c.avgVolume7dUsd ?? c.volume24hUsd;
  if (avg7 < e.minAvgVolume7dUsd) reasons.push('volume_7d_too_low');

  if (c.sellImpactBps === null) reasons.push('price_impact_unknown');
  else if (c.sellImpactBps > e.maxPriceImpactBps) reasons.push('price_impact_too_high');

  return { mint: c.mint, symbol: c.symbol, eligible: reasons.length === 0, reasons, marketCapUsd: c.marketCapUsd, cgRank: c.cgRank ?? null, source: c.source };
}

export function filterEligible(cands: readonly CandidateToken[], cfg: MethodologyConfig, nowMs: number): EligibilityResult[] {
  return cands.map((c) => evaluateEligibility(c, cfg, nowMs));
}
