/**
 * Launch constituent report (docs/launch-constituents.md): the ranked eligible universe, the proposed
 * equal-weight basket, alternates, exclusions with reasons, suspicious flags and seed sizing
 * (per-asset buy size and Jupiter price impact for several seed amounts). Pure formatting; the data is
 * gathered by `MethodologyJob` + the quote source in cli.ts (`keeper launch-report`).
 */
import type { TokenListStats } from '../sources/types.js';
import type { CandidateToken, MethodologyRunResult } from './types.js';

export interface SeedImpact {
  seedSol: number;
  /** per-asset buy in SOL (seed / N) */
  perAssetSol: number;
  /** mint -> price impact in bps (null = no route / quote failed) */
  impactBps: Map<string, number | null>;
}

export interface ReportCandidate extends CandidateToken {
  liquidityUsd: number;
  holderCount: number | null;
  topHoldersPct: number | null;
  organicScore: number | null;
  tokenProgram: string | null;
  tags: readonly string[];
  stats: TokenListStats | null;
  /** CoinGecko category figures as reported (CEX+DEX volume), for the raw-list comparison. */
  cgMarketCapUsd?: number | null;
  cgVolume24hUsd?: number | null;
}

export interface LaunchReportInput {
  generatedAt: string;
  rpc: string;
  jupiterBase: string;
  solPriceUsd: number;
  run: MethodologyRunResult;
  candidates: readonly ReportCandidate[];
  alternates: number;
  seeds: readonly SeedImpact[];
  /** Optional second selection computed from the same candidates under a different rule (e.g. a lower volume floor). */
  variant?: { label: string; description: string; run: MethodologyRunResult };
  notes?: readonly string[];
  /** Hand-written committee notes (markdown lines) preserved / inserted as section 0. */
  committeeNotes?: readonly string[];
  /** Raw CoinGecko category rows (top N by market cap, before any screen) for comparison with the website. */
  cgTop?: readonly CgTopRow[];
}

export interface CgTopRow {
  cgRank: number;
  cgId: string;
  symbol: string;
  name: string;
  mint: string | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
}

/** Section-0 committee notes from a previously generated report (null when absent). */
export function extractCommitteeNotes(md: string): string[] | null {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## 0\. /.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  while (body.length && body[0]!.trim() === '') body.shift();
  while (body.length && body[body.length - 1]!.trim() === '') body.pop();
  return body;
}

const usd = (x: number | null | undefined): string => {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(0)}k`;
  return `$${x.toFixed(2)}`;
};
const pct = (bps: number | null | undefined): string => (bps === null || bps === undefined ? '—' : `${(bps / 100).toFixed(2)}%`);
const days = (ts: number | null, now: number): string => (ts === null ? '—' : `${Math.floor((now - ts) / 86_400_000)}d`);
const short = (m: string): string => `${m.slice(0, 4)}…${m.slice(-4)}`;
const link = (m: string): string => `[${short(m)}](https://solscan.io/token/${m})`;
const auth = (c: CandidateToken): string => {
  const mint = c.mintAuthority === null ? 'revoked' : c.mintAuthority === 'unknown' ? '?' : `SET ${short(c.mintAuthority)}`;
  const freeze = c.freezeAuthority === null ? 'revoked' : c.freezeAuthority === 'unknown' ? '?' : `SET ${short(c.freezeAuthority)}`;
  return `${mint} / ${freeze}`;
};

/** Heuristic warnings for the committee; these do not change eligibility. */
export function flagsFor(c: ReportCandidate, universe: 'coingecko' | 'jupiter' | 'merged' = 'jupiter'): string[] {
  const f: string[] = [];
  if (c.mintAuthority && c.mintAuthority !== 'unknown') f.push('mint authority present');
  if (c.freezeAuthority && c.freezeAuthority !== 'unknown') f.push('freeze authority present');
  if (c.mintAuthority === 'unknown' || c.freezeAuthority === 'unknown') f.push('authorities not read');
  if ((c.transferFeeBps ?? 0) > 0) f.push(`Token-2022 transfer fee ${c.transferFeeBps} bps (ineligible by rule 2.7; committee override only)`);
  if (c.transferHookProgram) f.push('Token-2022 transfer hook (never admissible)');
  // With the CoinGecko universe the category membership is the meme classification; Jupiter's tag is only informative.
  if (universe === 'jupiter' && !c.tags.map((t) => t.toLowerCase()).includes('meme')) f.push(`not tagged meme by Jupiter (${c.tags.join(',') || 'no tags'})`);
  if (universe !== 'jupiter' && !c.cgRank && c.source !== 'incumbent') f.push('not in the CoinGecko category (Jupiter-only nominee)');
  if (universe !== 'jupiter' && c.cgMarketCapUsd && c.marketCapUsd > 0 && Math.abs(c.cgMarketCapUsd - c.marketCapUsd) / c.marketCapUsd > 0.5) f.push(`CoinGecko mcap ${usd(c.cgMarketCapUsd)} differs from ranking mcap ${usd(c.marketCapUsd)}`);
  if (c.tags.map((t) => t.toLowerCase()).includes('defi')) f.push('tagged defi (protocol/utility token?)');
  if (c.topHoldersPct !== null && c.topHoldersPct >= 50) f.push(`top holders ${c.topHoldersPct.toFixed(0)}% of supply`);
  if (c.organicScore !== null && c.organicScore < 30) f.push(`low organic score ${c.organicScore.toFixed(0)}`);
  if (c.marketCapUsd > 0 && c.fdvUsd > c.marketCapUsd * 1.5) f.push(`FDV ${usd(c.fdvUsd)} vs mcap ${usd(c.marketCapUsd)} (large non-circulating supply)`);
  if (c.tokenProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') f.push('Token-2022 mint (check transfer-fee / hook extensions)');
  if (/^(W|C|SO|WH)(BTC|ETH|BNB|SOL|NEAR|AVAX|MATIC|XRP|DOGE|ADA|TRX|LTC)/i.test(c.symbol.replace(/^\$/, ''))) f.push('looks like a wrapped/bridged asset');
  if (/USD|EUR|STABLE/i.test(c.symbol)) f.push('looks like a stablecoin');
  if (c.liquidityUsd > 0 && c.volume24hUsd > 0 && c.volume24hUsd / c.liquidityUsd > 20) f.push(`volume/liquidity ${(c.volume24hUsd / c.liquidityUsd).toFixed(0)}x (wash-trading?)`);
  return f;
}

export function renderLaunchReport(i: LaunchReportInput): string {
  const now = Date.parse(i.generatedAt);
  const byMint = new Map(i.candidates.map((c) => [c.mint, c]));
  const eligible = i.run.eligible.filter((e) => e.eligible).sort((a, b) => b.marketCapUsd - a.marketCapUsd || a.mint.localeCompare(b.mint));
  const selected = i.run.selection.selected;
  const selectedSet = new Set(selected.map((s) => s.mint));
  const alternates = eligible.filter((e) => !selectedSet.has(e.mint)).slice(0, i.alternates);
  const excluded = i.run.eligible.filter((e) => !e.eligible).sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  const weightOf = (m: string): number => i.run.weights.find((w) => w.mint === m)?.weightBps ?? 0;

  const uni = i.run.universe;
  const universeLabel = !uni || uni.source === 'jupiter' ? 'Jupiter `verified` list ranked by 24h volume' : uni.source === 'coingecko' ? `CoinGecko category \`${uni.coingeckoCategory}\` ranked by market cap (top ${uni.maxCandidates})` : `union of CoinGecko \`${uni.coingeckoCategory}\` and the Jupiter verified list (top ${uni.maxCandidates})`;
  const out: string[] = [];
  out.push('# FI6900 launch constituents (methodology dry run on live data)');
  out.push('');
  out.push(`Generated ${i.generatedAt} by \`keeper launch-report\` against live sources (CoinGecko, Jupiter ${i.jupiterBase}, DexScreener, RPC ${i.rpc.replace(/api-key=[^&]+/, 'api-key=…')}). SOL = ${usd(i.solPriceUsd)}. Methodology v${i.run.configVersion}. Universe: ${universeLabel}.`);
  out.push('');
  out.push('**This is the list the index committee approves as the launch index.** Nothing here has been sent on-chain. Re-run before `init-fund`; prices, volumes and impacts move.');
  out.push('');
  out.push(`Universe ${i.run.eligible.length} tokens → ${eligible.length} eligible → ${selected.length} selected (equal weight, ${selected.length ? weightOf(selected[0]!.mint) : 0} bps each) + ${alternates.length} alternates.`);
  if (i.notes?.length) {
    out.push('');
    for (const n of i.notes) out.push(`> ${n}`);
  }
  if (i.committeeNotes?.length) {
    out.push('', `## 0. Committee notes on this run (hand-written)`, '', ...i.committeeNotes);
  }

  if (i.cgTop?.length) {
    const status = (r: CgTopRow): string => {
      if (!r.mint) return 'no Solana mint on CoinGecko (dropped)';
      const e = i.run.eligible.find((x) => x.mint === r.mint);
      if (!e) return 'not evaluated (denylist / universe cut)';
      if (selectedSet.has(r.mint)) return `**selected** #${selected.find((s) => s.mint === r.mint)?.rank}`;
      if (e.eligible) return 'eligible (alternate)';
      return `fails: ${e.reasons.join(', ')}`;
    };
    const passing = i.cgTop.filter((r) => r.mint && selectedSet.has(r.mint)).length;
    const cat = uni?.coingeckoCategory ?? 'solana-meme-coins';
    out.push('', `## 0b. CoinGecko "${cat}" top ${i.cgTop.length} by market cap vs the screens`, '');
    out.push(`Raw category order as served by \`/coins/markets?category=${cat}&order=market_cap_desc\` at generation time (compare with https://www.coingecko.com/en/categories/${cat}). CoinGecko volume is CEX+DEX; the methodology volume floor uses Solana DEX volume (Jupiter/DexScreener), hence the differences. ${passing} of ${i.cgTop.length} are in the proposed basket.`, '');
    out.push('| CG # | Token | CG id | CG mcap | CG 24h vol | DEX 24h vol | Result |', '|---|---|---|---|---|---|---|');
    for (const r of i.cgTop) {
      const c = r.mint ? byMint.get(r.mint) : undefined;
      out.push(`| ${r.cgRank} | ${r.symbol}${r.mint ? ' ' + link(r.mint) : ''} | \`${r.cgId}\` | ${usd(r.marketCapUsd)} | ${usd(r.volume24hUsd)} | ${usd(c?.volume24hUsd ?? null)} | ${status(r)} |`);
    }
  }

  const uniMode = uni?.source ?? 'jupiter';
  const cgCol = (c: CandidateToken): string => (c.cgRank ? `CG #${c.cgRank}` : c.source === 'jupiter' ? 'Jup' : c.source === 'incumbent' ? 'inc.' : '—');
  const row = (rank: number | string, m: string): string => {
    const c = byMint.get(m);
    if (!c) return `| ${rank} | ${link(m)} | ? | | | | | | | | | |`;
    const flags = flagsFor(c, uniMode);
    return `| ${rank} | ${c.symbol} ${link(m)} | ${cgCol(c)} | ${usd(c.marketCapUsd)} | ${usd(c.fdvUsd)} | ${usd(c.volume24hUsd)} | ${usd(c.liquidityUsd)} | ${days(c.firstTradeAt, now)} | ${pct(c.sellImpactBps)} | ${auth(c)} | ${c.holderCount ?? '—'} | ${flags.length ? '⚠ ' + flags.join('; ') : ''} |`;
  };
  const header = ['| # | Token | Source | Mcap | FDV | 24h vol | Liquidity | Age | $10k sell impact | Mint / freeze auth | Holders | Flags |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];

  out.push('', `## 1. Proposed basket (top ${selected.length}, ${selected.length ? weightOf(selected[0]!.mint) : 0} bps each)`, '', ...header);
  for (const s of selected) out.push(row(s.rank, s.mint));

  out.push('', `## 2. Alternates (next ${alternates.length} eligible by market cap)`, '', ...header);
  alternates.forEach((e, k) => out.push(row(selected.length + k + 1, e.mint)));

  if (i.variant) {
    const v = i.variant;
    const vSel = v.run.selection.selected;
    const vSet = new Set(vSel.map((s) => s.mint));
    const vElig = v.run.eligible.filter((e) => e.eligible).sort((a, b) => b.marketCapUsd - a.marketCapUsd || a.mint.localeCompare(b.mint));
    const vAlt = vElig.filter((e) => !vSet.has(e.mint)).slice(0, i.alternates);
    const dropped = selected.filter((s) => !vSet.has(s.mint));
    const addedV = vSel.filter((s) => !selectedSet.has(s.mint));
    out.push('', `## 2b. Variant: ${v.label}`, '', v.description, '');
    out.push(`${vElig.length} eligible -> ${vSel.length} selected. Versus section 1: drops ${dropped.map((s) => s.symbol).join(', ') || 'nothing'}; adds ${addedV.map((s) => s.symbol).join(', ') || 'nothing'}.`, '', ...header);
    for (const s of vSel) out.push(row(s.rank, s.mint));
    if (vAlt.length) {
      out.push('', `Alternates under this variant: ${vAlt.map((e) => e.symbol).join(', ')}`);
    }
  }

  out.push('', '## 3. Seed sizing (Jupiter ExactIn quotes SOL → token, per-asset buy = seed / N)', '');
  out.push('Price impact of each constituent buy at launch, for the candidate seed sizes. `—` = quote failed / no route at that size. The runbook treats a seed as safe when every leg is ≤ 1.00% impact; the $10k-sell screen (≤ 2%) is the methodology bound, the buy legs below are what `init-fund --sol` will actually pay.');
  out.push('');
  out.push(`| Token | ${i.seeds.map((s) => `${s.seedSol} SOL (${s.perAssetSol.toFixed(3)} SOL/asset ≈ ${usd(s.perAssetSol * i.solPriceUsd)})`).join(' | ')} |`);
  out.push(`|---|${i.seeds.map(() => '---').join('|')}|`);
  const seedRows = [...selected, ...(i.variant?.run.selection.selected ?? []).filter((s) => !selectedSet.has(s.mint))];
  for (const s of seedRows) {
    const c = byMint.get(s.mint);
    out.push(`| ${c?.symbol ?? short(s.mint)}${selectedSet.has(s.mint) ? '' : ' (variant only)'} | ${i.seeds.map((sd) => pct(sd.impactBps.get(s.mint) ?? null)).join(' | ')} |`);
  }
  const summary = i.seeds.map((sd) => {
    const vals = selected.map((s) => sd.impactBps.get(s.mint) ?? null);
    const known = vals.filter((v): v is number => v !== null);
    const worst = known.length ? Math.max(...known) : null;
    const over100 = known.filter((v) => v > 100).length;
    const over50 = known.filter((v) => v > 50).length;
    return `| ${sd.seedSol} SOL | ${usd(sd.seedSol * i.solPriceUsd)} | ${pct(worst)} | ${over50} | ${over100} | ${vals.length - known.length} |`;
  });
  out.push('', '| Seed | Seed USD | Worst leg impact | legs > 0.50% | legs > 1.00% | legs unquoted |', '|---|---|---|---|---|---|', ...summary);

  out.push('', '## 4. Excluded tokens (and why)', '', '| Token | Source | Mcap | 24h vol | Reasons |', '|---|---|---|---|---|');
  for (const e of excluded) {
    const c = byMint.get(e.mint);
    out.push(`| ${e.symbol} ${link(e.mint)} | ${c ? cgCol(c) : '—'} | ${usd(c?.marketCapUsd ?? e.marketCapUsd)} | ${usd(c?.volume24hUsd ?? null)} | ${e.reasons.join(', ')} |`);
  }

  out.push('', '## 5. Flags on selected / alternate tokens', '');
  const flagged = [...selected.map((s) => s.mint), ...alternates.map((a) => a.mint)].map((m) => byMint.get(m)).filter((c): c is ReportCandidate => !!c && flagsFor(c, uniMode).length > 0);
  if (!flagged.length) out.push('None.');
  for (const c of flagged) out.push(`- **${c.symbol}** (${link(c.mint)}): ${flagsFor(c, uniMode).join('; ')}`);

  out.push('', '## 6. Eligibility reasons legend', '');
  out.push('Source column: `CG #n` = rank in the CoinGecko category by market cap (membership is the memecoin classification, methodology 2.6) · `Jup` = Jupiter verified list only (merged universe) · `inc.` = on-chain incumbent not in the universe.');
  out.push('');
  out.push('`mint_authority` / `freeze_authority` = authority not revoked (read from the mint account) · `too_young` / `age_unknown` = < 14 days since first pool · `fdv_too_low` < $2M · `volume_24h_too_low` < $250k · `volume_7d_too_low` < $100k/day (24h proxy before 3 observations) · `price_impact_too_high` > 2% on a $10k sell into USDC · `price_impact_unknown` = no Jupiter route (or the quote was rate-limited; see the run log) · `missing_tag` = `requireAnyTag` set (jupiter universe only), token lacks the Jupiter `meme` tag · `denylisted` / `excluded_symbol` / `excluded_tag` = stable / LST / wrapped / stock / RWA / manual list.');
  return out.join('\n') + '\n';
}
