/**
 * Daily methodology run: build the candidate universe, gather eligibility inputs, run the pure
 * engine, persist the run, record reconstitution PROPOSALS (never applies directly), publish the
 * reconstitution announcement 48 h ahead, and on the effective date queue the approved items as
 * timelocked actions (RECONSTITUTION_MODE=auto approves them itself; manual needs the committee).
 *
 * Data sources (verified live 2026-10-03, see docs/methodology.md 6.4 and apps/keeper/src/sources):
 *   universe   methodology.config universe.source: CoinGecko "Solana Meme Coins" category ranked by market cap
 *              (default; membership = memecoin classification), or Jupiter tokens/v2 `verified` by 24h volume,
 *              or the union of both (+ incumbents always)
 *   market     Jupiter tokens/v2 aggregates and DexScreener (all pools for the names that pass the cheap screen)
 *   authority  mint accounts via getMultipleAccounts (cross-checked against Jupiter `audit`)
 *   impact     Jupiter swap/v1 quote of a $10k sell into USDC (rate-limited; ~1 req/s on the free tier)
 */
import type { ChainClient } from '../chain/types.js';
import type { TxSender } from '../chain/tx.js';
import type { MintInfoSource } from '../chain/accounts.js';
import type { Env } from '../config/env.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import type { Repo } from '../db/repo.js';
import type { ReconstitutionService } from '../governance/reconstitution.js';
import type { IndicatedChange } from '../governance/proposals.js';
import type { ReportCandidate } from '../methodology/launch-report.js';
import { runMethodology } from '../methodology/run.js';
import { isInAnnouncementWindow, isReconstitutionDue, nextReconstitution } from '../methodology/schedule.js';
import type { CandidateToken, MethodologyRunResult } from '../methodology/types.js';
import type { TokenUniverseSource } from '../sources/jupiter-tokens.js';
import type { CompositeMarketData } from '../sources/market-data.js';
import { USDC_MINT, type QuoteSource, type TokenUniverseCandidate } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import { uiToBigint } from '../util/math.js';

const log = childLogger('methodology-job');
const LAST_RECON_KEY = 'last_reconstitution_ts';

export interface MethodologyJobDeps {
  chain: ChainClient;
  tx: TxSender;
  market: CompositeMarketData;
  tokens: TokenUniverseSource;
  quotes: QuoteSource;
  mints: MintInfoSource;
  repo: Repo;
  cfg: MethodologyConfig;
  env: Env;
  reconstitution: ReconstitutionService;
}

export interface MethodologyJobResult {
  run: MethodologyRunResult;
  universe: number;
  announced: boolean;
  /** true when approved proposals were queued on-chain (timelock) in this run */
  applied: boolean;
  proposals: { created: number; alreadyOpen: number; suppressed: number };
  mode: 'manual' | 'auto';
  /** Full candidate rows (inputs to the engine) for reports. */
  candidates: ReportCandidate[];
}

export class MethodologyJob {
  constructor(private readonly d: MethodologyJobDeps) {}

  /** The raw universe (before incumbents / denylist), in the source's order. */
  async universe(universeSize = this.d.cfg.universe.maxCandidates): Promise<TokenUniverseCandidate[]> {
    const t = this.d.tokens;
    if (t.universe) return t.universe(universeSize);
    const top = await t.topByVolume(universeSize);
    return top.map((x) => ({ ...x, universeSource: 'jupiter' as const }));
  }

  /** Candidate universe: current constituents + the configured universe (CoinGecko category by market cap, or Jupiter by volume). */
  async buildCandidates(incumbents: readonly string[], universeSize = this.d.cfg.universe.maxCandidates): Promise<ReportCandidate[]> {
    const top = await this.universe(universeSize).catch((e: Error) => {
      log.warn({ err: e.message }, 'token universe unavailable; using incumbents only');
      return [] as TokenUniverseCandidate[];
    });
    const nominated = new Map(top.map((t) => [t.mint, t]));
    const mints = [...new Set([...incumbents, ...top.map((t) => t.mint)])].filter((m) => !this.d.cfg.eligibility.denylist.includes(m));
    const [md0, infos0, mintInfos] = await Promise.all([this.d.market.getMarketData(mints), this.d.tokens.getTokenInfo(mints), this.d.mints.getMintInfo(mints)]);
    // Universe rows already carry merged Jupiter+CoinGecko info; prefer them over the plain lookup.
    const infos = new Map(infos0);
    for (const [m, t] of nominated) if (!infos.has(m) || !infos.get(m)?.cg) infos.set(m, { ...(infos.get(m) ?? t), cg: t.cg ?? infos.get(m)?.cg });

    // Cheap screens first (FDV, 24h volume, price) so the per-token DexScreener pool scan and the Jupiter impact
    // quote only run for plausible names.
    const e = this.d.cfg.eligibility;
    const pre = mints.filter((m) => {
      const d = md0.get(m);
      const cg = infos.get(m)?.cg;
      const fdv = Math.max(d?.fdvUsd ?? 0, cg?.fdvUsd ?? 0, cg?.marketCapUsd ?? 0);
      // CoinGecko volume is CEX+DEX; it is only used to decide whether the deeper DEX scan is worth running.
      const vol = Math.max(d?.volume24hUsd ?? 0, cg?.volume24hUsd ?? 0);
      return d && fdv >= e.minFdvUsd && vol >= e.minVolume24hUsd * 0.5 && d.priceUsd > 0;
    });
    const md = new Map(md0);
    if (pre.length) {
      const refined = await this.d.market.getMarketData(pre, { allPairs: true });
      for (const [m, d] of refined) md.set(m, d);
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const [m, d] of md) this.d.repo.recordObservation(m, today, d.volume24hUsd, d.fdvUsd, d.priceUsd);

    const impact = new Map<string, number>();
    await Promise.all(
      pre.map(async (m) => {
        const d = md.get(m);
        const info = infos.get(m) ?? { decimals: mintInfos.get(m)?.decimals ?? 6 };
        // Quote everything that passed the cheap screen (volume >= 0.5x the floor) so report variants with a lower
        // volume floor (launch-report: $150k) see a real impact figure instead of `price_impact_unknown`.
        if (!d || !(d.volume24hUsd >= e.minVolume24hUsd * 0.5)) return;
        try {
          const amount = uiToBigint(e.impactQuoteUsd / d.priceUsd, info.decimals);
          const q = await this.d.quotes.quote({ inputMint: m, outputMint: USDC_MINT, amount, slippageBps: 500 });
          impact.set(m, Math.round(q.priceImpactPct * 10_000));
        } catch (err) {
          log.warn({ mint: m, symbol: infos.get(m)?.symbol, err: (err as Error).message.slice(0, 160) }, 'impact quote failed');
        }
      }),
    );

    return mints.map((m) => {
      const d = md.get(m);
      const info = infos.get(m);
      const mi = mintInfos.get(m);
      const st = info?.stats ?? null;
      const avg = this.d.repo.avgVolume7d(m);
      // Authorities: the mint account is the source of truth; Jupiter `audit` only fills in when the RPC read failed.
      const mintAuthority = mi ? mi.mintAuthority : st?.audit?.mintAuthorityDisabled === true ? null : 'unknown';
      const freezeAuthority = mi ? mi.freezeAuthority : st?.audit?.freezeAuthorityDisabled === true ? null : 'unknown';
      const cg = info?.cg ?? null;
      const nom = nominated.get(m);
      // Ranking market cap: CoinGecko (circulating) first, Jupiter/DexScreener when CoinGecko has none.
      const marketCapUsd = (cg?.marketCapUsd ?? 0) > 0 ? (cg?.marketCapUsd as number) : (d?.marketCapUsd ?? d?.fdvUsd ?? cg?.fdvUsd ?? 0);
      const c: ReportCandidate = {
        mint: m,
        symbol: info?.symbol ?? d?.symbol ?? m.slice(0, 4),
        name: info?.name ?? d?.name ?? m,
        decimals: mi?.decimals ?? info?.decimals ?? 6,
        priceUsd: d?.priceUsd ?? 0,
        fdvUsd: Math.max(d?.fdvUsd ?? 0, cg?.fdvUsd ?? 0),
        marketCapUsd,
        volume24hUsd: d?.volume24hUsd ?? 0,
        avgVolume7dUsd: avg && avg.days >= 3 ? avg.avg : null,
        firstTradeAt: d?.pairCreatedAt ?? null,
        mintAuthority,
        freezeAuthority,
        transferFeeBps: mi?.transferFeeBps,
        transferHookProgram: mi?.transferHookProgram ?? null,
        sellImpactBps: impact.get(m) ?? null,
        tags: info?.tags ?? [],
        liquidityUsd: d?.liquidityUsd ?? 0,
        holderCount: st?.holderCount ?? null,
        topHoldersPct: st?.audit?.topHoldersPercentage ?? null,
        organicScore: st?.organicScore ?? null,
        tokenProgram: mi?.tokenProgram ?? st?.tokenProgram ?? null,
        stats: st,
        cgRank: cg?.rank ?? null,
        cgId: cg?.id ?? null,
        source: nom?.universeSource ?? 'incumbent',
        cgMarketCapUsd: cg?.marketCapUsd ?? null,
        cgVolume24hUsd: cg?.volume24hUsd ?? null,
      };
      return c;
    });
  }

  /** The adds/removes a run indicates, with the metrics that justify them (stored in the proposal). */
  static indicatedChanges(run: MethodologyRunResult, candidates: readonly CandidateToken[]): IndicatedChange[] {
    const byMint = new Map(candidates.map((c) => [c.mint, c]));
    const metrics = (mint: string): Record<string, unknown> => {
      const c = byMint.get(mint);
      const e = run.eligible.find((x) => x.mint === mint);
      const r = run.selection.selected.find((x) => x.mint === mint);
      return {
        rank: r?.rank ?? null,
        cgRank: c?.cgRank ?? e?.cgRank ?? null,
        cgId: c?.cgId ?? null,
        universeSource: c?.source ?? e?.source ?? null,
        marketCapUsd: c?.marketCapUsd ?? e?.marketCapUsd ?? null,
        fdvUsd: c?.fdvUsd ?? null,
        volume24hUsd: c?.volume24hUsd ?? null,
        avgVolume7dUsd: c?.avgVolume7dUsd ?? null,
        sellImpactBps: c?.sellImpactBps ?? null,
        eligible: e?.eligible ?? null,
        reasons: e?.reasons ?? [],
        configVersion: run.configVersion,
        runTs: run.ts,
      };
    };
    const sym = (m: string): string => byMint.get(m)?.symbol ?? run.eligible.find((e) => e.mint === m)?.symbol ?? m.slice(0, 6);
    const out: IndicatedChange[] = [];
    for (const m of run.selection.added) out.push({ mint: m, symbol: sym(m), action: 'add', weightBps: run.weights.find((w) => w.mint === m)?.weightBps ?? null, metrics: metrics(m) });
    for (const m of run.selection.removed) out.push({ mint: m, symbol: sym(m), action: 'remove', weightBps: null, metrics: metrics(m) });
    return out;
  }

  async run(opts: { dry?: boolean; universeSize?: number } = {}): Promise<MethodologyJobResult> {
    const dry = opts.dry ?? this.d.env.DRY_RUN;
    const recon = this.d.reconstitution;
    const assets = await this.d.chain.readAssets().catch((e: Error) => {
      log.warn({ err: e.message }, 'could not read on-chain assets; treating the fund as empty (no incumbents)');
      return [];
    });
    const incumbents = assets.filter((a) => a.status === 'active').map((a) => a.mint);
    const candidates = await this.buildCandidates(incumbents, opts.universeSize);
    const run = runMethodology(candidates, new Set(incumbents), this.d.cfg);
    log.info(
      { universe: candidates.length, eligible: run.eligible.filter((e) => e.eligible).length, selected: run.selection.selected.length, added: run.selection.added.length, removed: run.selection.removed.length, dry, mode: recon.mode },
      'methodology run complete',
    );

    // 1) proposals (never applied directly)
    const indicated = MethodologyJob.indicatedChanges(run, candidates);
    const rec = dry ? { created: [], alreadyOpen: [], suppressed: [] } : recon.recordIndicated(indicated);
    await recon.reconcileExecuted().catch((e: Error) => log.debug({ err: e.message }, 'reconcile executed proposals failed'));

    // 2) announcement 48h ahead: what is APPROVED for the next window
    const now = new Date();
    const next = nextReconstitution(now, this.d.cfg);
    const key = `recon-${next.toISOString().slice(0, 7)}`;
    let announced = false;
    const approved = recon.list('approved');
    if (isInAnnouncementWindow(now, this.d.cfg) && approved.length > 0) {
      const name = (p: { symbol: string | null; mint: string }): string => p.symbol ?? p.mint.slice(0, 6);
      announced = this.d.repo.insertAnnouncement({
        key,
        title: `Reconstitution effective ${next.toISOString().slice(0, 10)} 00:00 UTC`,
        body: `Additions: ${approved.filter((p) => p.action === 'add').map(name).join(', ') || 'none'}. Deletions: ${approved.filter((p) => p.action === 'remove').map(name).join(', ') || 'none'}. Weights: ${this.d.cfg.weighting.scheme}. Changes are queued through the on-chain timelock and execute after it elapses.`,
      });
    }

    // 3) on the effective date: queue approved proposals through the timelock
    let applied = false;
    const lastRecon = this.d.repo.getKv(LAST_RECON_KEY);
    const due = isReconstitutionDue(now, lastRecon ? Date.parse(lastRecon) : null, this.d.cfg) && now.getTime() >= next.getTime() - 24 * 3600_000 && now.getUTCDate() === this.d.cfg.reconstitution.dayOfMonth;
    if (due && !dry) {
      if (approved.length === 0) {
        log.info({ mode: recon.mode }, 'reconstitution window: nothing approved to queue');
      } else {
        try {
          const q = await recon.queueApproved();
          applied = q.queued.length > 0;
          if (applied) this.d.repo.setKv(LAST_RECON_KEY, now.toISOString());
        } catch (err) {
          log.warn({ err: (err as Error).message }, 'could not queue reconstitution (keeper not authority?); queue from the multisig');
        }
      }
    } else if (due) {
      log.info('reconstitution due but DRY_RUN; not queueing on-chain');
    }

    this.d.repo.insertMethodologyRun({ ts: run.ts, configVersion: run.configVersion, config: this.d.cfg, eligible: run.eligible, selected: run.selection, weights: run.weights, dry, applied });
    return { run, universe: candidates.length, announced, applied, proposals: { created: rec.created.length, alreadyOpen: rec.alreadyOpen.length, suppressed: rec.suppressed.length }, mode: recon.mode, candidates };
  }
}
