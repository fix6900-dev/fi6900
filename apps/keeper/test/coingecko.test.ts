/**
 * Offline tests for the CoinGecko universe source. Fixtures under test/fixtures/coingecko were captured live on
 * 2026-10-03 (`/coins/markets?category=solana-meme-coins`, `/coins/list?include_platform=true`, `/coins/bonk`) and
 * trimmed; a few synthetic rows exercise the drop paths (no Solana platform, malformed mint, duplicate mint).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG, methodologyConfigFromEnv, withMethodologyOverrides } from '../src/config/methodology.config.js';
import { MethodologyJob } from '../src/jobs/methodology-job.js';
import { extractCommitteeNotes, renderLaunchReport, type ReportCandidate } from '../src/methodology/launch-report.js';
import { runMethodology } from '../src/methodology/run.js';
import {
  COINGECKO_FREE_BASE,
  COINGECKO_PRO_BASE,
  CoinGeckoSource,
  isValidSolanaMint,
  parseCoinsList,
  parseMarkets,
  resolveCandidates,
  solanaMintOf,
  toUniverseCandidate,
  type CgListCoin,
  type CgMarket,
} from '../src/sources/coingecko.js';
import type { TokenUniverseSource } from '../src/sources/jupiter-tokens.js';
import type { TokenInfo } from '../src/sources/types.js';
import { CompositeUniverseSource, mergeInfo } from '../src/sources/universe.js';
import { RateLimiter } from '../src/util/rate-limit.js';
import type { FetchJsonOptions } from '../src/util/retry.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/coingecko/${name}`, import.meta.url), 'utf8'));
const MARKETS = fixture('markets.json');
const LIST = fixture('coins-list.json');
const BONK_DETAIL = fixture('coin-bonk.json');
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PENGU = '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv';
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

/** fetchJson stub routing by URL; records every call. */
function stubFetch(overrides: Partial<Record<'markets' | 'list' | 'bonk', unknown>> = {}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchJson = async <T>(url: string, opts: FetchJsonOptions = {}): Promise<T> => {
    calls.push({ url, headers: opts.headers ?? {} });
    if (url.includes('/coins/markets')) {
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '1');
      return (page === 1 ? (overrides.markets ?? MARKETS) : []) as T;
    }
    if (url.includes('/coins/list')) return (overrides.list ?? LIST) as T;
    if (url.includes('/coins/bonk')) return (overrides.bonk ?? BONK_DETAIL) as T;
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, fetchJson };
}

describe('coingecko parsing', () => {
  it('validates Solana mints as 32-byte base58', () => {
    expect(isValidSolanaMint(BONK)).toBe(true);
    expect(isValidSolanaMint('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isValidSolanaMint('0xdeadbeefnotbase58')).toBe(false);
    expect(isValidSolanaMint('0x1151cb3d861920e07a38e03eead12c32178567f6')).toBe(false); // EVM address
    expect(isValidSolanaMint('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263DezX')).toBe(false); // 33+ bytes
    expect(isValidSolanaMint('')).toBe(false);
    expect(isValidSolanaMint(null)).toBe(false);
    expect(solanaMintOf({ ethereum: '0x59f4' })).toBeNull();
    expect(solanaMintOf({ solana: BONK })).toBe(BONK);
  });

  it('parses the markets page in order and drops malformed rows', () => {
    const rows = parseMarkets(MARKETS);
    expect(rows.length).toBe(15); // 16 fixture rows, one without a symbol
    expect(rows[0]!.id).toBe('pudgy-penguins');
    expect(rows[0]!.market_cap).toBeGreaterThan(rows[1]!.market_cap!);
    expect(parseMarkets({ error: 'rate limited' })).toEqual([]);
  });

  it('parses the coins list into an id map', () => {
    const list = parseCoinsList(LIST);
    expect(list.get('pudgy-penguins')?.platforms?.solana).toBe(PENGU);
    expect(list.has('bonk')).toBe(false); // deliberately missing from the fixture
    expect(parseCoinsList(null).size).toBe(0);
  });

  it('resolves mints, ranks by position, and drops rows without a valid Solana mint (dedupes by mint)', () => {
    const markets = parseMarkets(MARKETS);
    const list = parseCoinsList(LIST);
    const platforms = new Map<string, { platforms?: Record<string, string | null> | null }>();
    for (const m of markets) {
      const row = list.get(m.id);
      if (row) platforms.set(m.id, { platforms: row.platforms });
    }
    const r = resolveCandidates(markets, platforms);
    const ids = r.candidates.map((c) => c.cgId);
    expect(ids).not.toContain('bonk'); // unresolved: not in the list, no detail lookup in this pure call
    expect(ids).not.toContain('catcoin-eth');
    expect(ids).not.toContain('badmint-coin');
    expect(ids).toContain('bonk-duplicate'); // same mint as bonk, but bonk is unresolved in this pure call, so the duplicate survives
    expect(r.dropped.map((d) => `${d.cgId}:${d.reason}`)).toEqual(expect.arrayContaining(['bonk:no_solana_mint', 'catcoin-eth:no_solana_mint', 'badmint-coin:invalid_mint']));
    const pengu = r.candidates.find((c) => c.cgId === 'pudgy-penguins')!;
    expect(pengu.cgRank).toBe(1);
    expect(pengu.mint).toBe(PENGU);
    expect(pengu.symbol).toBe('PENGU');
    expect(pengu.marketCapUsd).toBeGreaterThan(1e8);
    expect(pengu.fdvUsd).toBeGreaterThan(pengu.marketCapUsd!);
    expect(pengu.volume24hUsd).toBeGreaterThan(0);
    expect(pengu.logo).toMatch(/^https:\/\//);
    // ranks are positions in the raw order, so a dropped row leaves a gap rather than renumbering
    const wif = r.candidates.find((c) => c.cgId === 'dogwifcoin')!;
    expect(wif.cgRank).toBe(4);
    expect(wif.mint).toBe(WIF);
  });

  it('dedupes by mint keeping the higher-ranked entry', () => {
    const markets: CgMarket[] = [
      { id: 'a', symbol: 'a', name: 'A', market_cap: 10 },
      { id: 'b', symbol: 'b', name: 'B', market_cap: 5 },
    ];
    const r = resolveCandidates(markets, new Map([['a', { platforms: { solana: BONK } }], ['b', { platforms: { solana: BONK } }]]));
    expect(r.candidates.map((c) => c.cgId)).toEqual(['a']);
  });

  it('maps a candidate to TokenInfo with the CoinGecko membership attached', () => {
    const c = resolveCandidates(parseMarkets(MARKETS).slice(0, 1), new Map([['pudgy-penguins', { platforms: { solana: PENGU }, decimals: 6 }]])).candidates[0]!;
    const u = toUniverseCandidate(c);
    expect(u.mint).toBe(PENGU);
    expect(u.decimals).toBe(6);
    expect(u.universeSource).toBe('coingecko');
    expect(u.cg).toEqual({ id: 'pudgy-penguins', rank: 1, marketCapUsd: c.marketCapUsd, fdvUsd: c.fdvUsd, volume24hUsd: c.volume24hUsd, change24hPct: c.change24hPct });
  });
});

describe('CoinGeckoSource', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'cg-'));
    dirs.push(d);
    return d;
  };

  it('fetches markets + list, falls back to /coins/{id} for list misses, caches 10 min and the list on disk', async () => {
    const dir = tmp();
    let now = 1_000_000;
    const { calls, fetchJson } = stubFetch();
    const src = new CoinGeckoSource({ dataDir: dir, fetchJson, limiter: new RateLimiter(0), now: () => now });
    const first = await src.candidates(150);
    const urls = calls.map((c) => c.url);
    expect(urls.filter((u) => u.includes('/coins/markets')).length).toBe(1); // 150 <= 250 -> one page
    expect(urls.filter((u) => u.includes('/coins/list?include_platform=true')).length).toBe(1);
    expect(urls.filter((u) => u.includes('/coins/bonk?')).length).toBe(1); // bonk missing from the list
    // rows whose list entry has no (valid) Solana platform are re-checked via /coins/{id} (the list can lag); the stub throws -> dropped
    expect(urls.filter((u) => u.includes('/coins/catcoin-eth')).length).toBe(1);
    expect(urls.filter((u) => u.includes('/coins/badmint-coin')).length).toBe(1);
    expect(urls[0]).toContain(COINGECKO_FREE_BASE);
    expect(calls[0]!.headers).toEqual({});

    const bonk = first.find((c) => c.cgId === 'bonk')!;
    expect(bonk.mint).toBe(BONK);
    expect(bonk.decimals).toBe(5); // from detail_platforms.solana.decimal_place
    expect(bonk.cgRank).toBe(3);
    expect(first.find((c) => c.cgId === 'bonk-duplicate')).toBeUndefined(); // same mint as bonk, lower rank
    expect(first.map((c) => c.cgId)).not.toContain('catcoin-eth');
    expect(first.map((c) => c.cgId)).not.toContain('badmint-coin');
    expect(first.length).toBe(12);
    // list cached on disk
    const cacheFile = join(dir, 'coingecko-coins-list.json');
    expect(existsSync(cacheFile)).toBe(true);

    // second call within 10 min: no network
    const before = calls.length;
    await src.candidates(150);
    expect(calls.length).toBe(before);

    // 11 min later: markets refetched, the list (24 h) and detail (memoised) are not
    now += 11 * 60_000;
    await src.candidates(150);
    const extra = calls.slice(before).map((c) => c.url);
    expect(extra.filter((u) => u.includes('/coins/markets')).length).toBe(1);
    expect(extra.filter((u) => u.includes('/coins/list')).length).toBe(0);
    expect(extra.filter((u) => u.includes('/coins/bonk')).length).toBe(0);

    // a new process reads the list from disk when it is < 24 h old
    const again = stubFetch();
    const src2 = new CoinGeckoSource({ dataDir: dir, fetchJson: again.fetchJson, limiter: new RateLimiter(0), now: () => now });
    await src2.candidates(150);
    expect(again.calls.map((c) => c.url).filter((u) => u.includes('/coins/list')).length).toBe(0);

    // ... and refetches it after 24 h (stale copy kept if the refresh fails)
    now += 25 * 3600_000;
    const stale = stubFetch();
    const src3 = new CoinGeckoSource({ dataDir: dir, fetchJson: stale.fetchJson, limiter: new RateLimiter(0), now: () => now });
    await src3.candidates(150);
    expect(stale.calls.map((c) => c.url).filter((u) => u.includes('/coins/list')).length).toBe(1);
  });

  it('keeps the stale disk list when the refresh fails', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'coingecko-coins-list.json'), JSON.stringify({ fetchedAt: 0, coins: LIST }));
    const fetchJson = async <T>(url: string): Promise<T> => {
      if (url.includes('/coins/list')) throw new Error('HTTP 429');
      if (url.includes('/coins/markets')) return (/[?&]page=1/.test(url) ? MARKETS : []) as T;
      if (url.includes('/coins/bonk')) return BONK_DETAIL as T;
      throw new Error(`unexpected ${url}`);
    };
    const src = new CoinGeckoSource({ dataDir: dir, fetchJson, limiter: new RateLimiter(0), now: () => 48 * 3600_000 });
    const c = await src.candidates(50);
    expect(c.find((x) => x.cgId === 'pudgy-penguins')?.mint).toBe(PENGU);
  });

  it('pages when more than 250 candidates are requested and sends the right auth header per tier', async () => {
    const { calls, fetchJson } = stubFetch();
    const demo = new CoinGeckoSource({ apiKey: 'demo-key', fetchJson, limiter: new RateLimiter(0) });
    await demo.candidates(300);
    expect(calls.filter((c) => c.url.includes('/coins/markets')).map((c) => /[?&]page=(\d+)/.exec(c.url)![1])).toEqual(['1']); // page 1 returned < 250 rows -> stop
    expect(calls[0]!.headers).toEqual({ 'x-cg-demo-api-key': 'demo-key' });
    expect(calls[0]!.url.startsWith(COINGECKO_FREE_BASE)).toBe(true);

    const pro = stubFetch();
    const proSrc = new CoinGeckoSource({ apiKey: 'pro-key', pro: true, fetchJson: pro.fetchJson, limiter: new RateLimiter(0) });
    await proSrc.candidates(10);
    expect(pro.calls[0]!.headers).toEqual({ 'x-cg-pro-api-key': 'pro-key' });
    expect(pro.calls[0]!.url.startsWith(COINGECKO_PRO_BASE)).toBe(true);
    expect(pro.calls[0]!.url).toContain('category=solana-meme-coins');
    expect(pro.calls[0]!.url).toContain('order=market_cap_desc');
    expect(pro.calls[0]!.url).toContain('per_page=250');

    // pro flag without a key stays on the free host
    const noKey = new CoinGeckoSource({ pro: true, fetchJson: stubFetch().fetchJson, limiter: new RateLimiter(0) });
    expect(noKey.base).toBe(COINGECKO_FREE_BASE);
    expect(noKey.headers).toEqual({});
  });

  it('serves TokenInfo / market data for category members only', async () => {
    const src = new CoinGeckoSource({ fetchJson: stubFetch().fetchJson, limiter: new RateLimiter(0) });
    const info = await src.getTokenInfo([PENGU, 'So11111111111111111111111111111111111111112']);
    expect(info.size).toBe(1);
    expect(info.get(PENGU)?.cg?.rank).toBe(1);
    const md = await src.getMarketData([WIF]);
    expect(md.get(WIF)?.source).toBe('coingecko');
    expect(md.get(WIF)?.marketCapUsd).toBeGreaterThan(1e8);
    expect(md.get(WIF)?.liquidityUsd).toBe(0);
    expect(md.get(WIF)?.pairCreatedAt).toBeNull();
    const byVol = await src.topByVolume(5);
    expect(byVol.length).toBe(5);
    expect((byVol[0]!.dailyVolumeUsd ?? 0) >= (byVol[4]!.dailyVolumeUsd ?? 0)).toBe(true);
  });
});

/** Minimal Jupiter stand-in. */
function fakeJupiter(known: Record<string, Partial<TokenInfo>>, top: string[] = []): TokenUniverseSource & { calls: string[][] } {
  const calls: string[][] = [];
  const info = (m: string): TokenInfo => ({ mint: m, symbol: `J-${m.slice(0, 3)}`, name: `Jup ${m.slice(0, 3)}`, logo: null, decimals: 9, tags: ['verified', 'meme'], dailyVolumeUsd: 1e6, ...known[m] });
  return {
    calls,
    async getTokenInfo(mints) {
      calls.push([...mints]);
      return new Map(mints.filter((m) => m in known).map((m) => [m, info(m)]));
    },
    async topByVolume(n) {
      return top.slice(0, n).map(info);
    },
  };
}

describe('CompositeUniverseSource', () => {
  const cg = () => new CoinGeckoSource({ fetchJson: stubFetch().fetchJson, limiter: new RateLimiter(0) });

  it('coingecko mode: CoinGecko order and membership, Jupiter metadata (decimals, tags) on top', async () => {
    const jup = fakeJupiter({ [PENGU]: { decimals: 6, tags: ['verified', 'meme'] }, [WIF]: { decimals: 6, tags: ['verified'] } }, [WIF, 'XnotInCg11111111111111111111111111111111111']);
    const u = new CompositeUniverseSource('coingecko', jup, cg());
    const list = await u.universe(150);
    expect(list[0]!.mint).toBe(PENGU);
    expect(list[0]!.decimals).toBe(6);
    expect(list[0]!.cg?.rank).toBe(1);
    expect(list[0]!.universeSource).toBe('coingecko');
    expect(list.every((c) => c.universeSource === 'coingecko')).toBe(true);
    expect(list.some((c) => c.mint.startsWith('XnotInCg'))).toBe(false);
    // unknown to Jupiter: CoinGecko metadata is kept, decimals default
    const bonk = list.find((c) => c.mint === BONK)!;
    expect(bonk.symbol).toBe('BONK');
    expect(bonk.decimals).toBe(5);
    expect(bonk.tags).toEqual([]);
    // getTokenInfo answers from Jupiter and overlays cg
    const info = await u.getTokenInfo([WIF, 'Y1111111111111111111111111111111111111111111']);
    expect(info.get(WIF)?.tags).toEqual(['verified']);
    expect(info.get(WIF)?.cg?.id).toBe('dogwifcoin');
  });

  it('merged mode: union, Jupiter-only names appended, double nominees tagged merged', async () => {
    const extra = 'XnotInCg11111111111111111111111111111111111';
    const jup = fakeJupiter({ [WIF]: { decimals: 6 }, [extra]: { decimals: 9 } }, [WIF, extra]);
    const u = new CompositeUniverseSource('merged', jup, cg());
    const list = await u.universe(150);
    expect(list.find((c) => c.mint === WIF)?.universeSource).toBe('merged');
    expect(list.find((c) => c.mint === PENGU)?.universeSource).toBe('coingecko');
    const last = list[list.length - 1]!;
    expect(last.mint).toBe(extra);
    expect(last.universeSource).toBe('jupiter');
    expect(last.cg).toBeUndefined();
  });

  it('jupiter mode: Jupiter volume order, no CoinGecko required', async () => {
    const jup = fakeJupiter({ [WIF]: {} }, [WIF, BONK]);
    const u = new CompositeUniverseSource('jupiter', jup, null);
    const list = await u.universe(10);
    expect(list.map((c) => c.mint)).toEqual([WIF, BONK]);
    expect(list.every((c) => c.universeSource === 'jupiter')).toBe(true);
    expect(() => new CompositeUniverseSource('coingecko', jup, null)).toThrow(/requires a CoinGecko source/);
  });

  it('mergeInfo keeps Jupiter fields and fills gaps from CoinGecko', () => {
    const cgc = toUniverseCandidate({ mint: WIF, symbol: 'WIF', name: 'dogwifhat', logo: 'https://cg/wif.png', priceUsd: 1, marketCapUsd: 2, fdvUsd: 2, volume24hUsd: 3, change24hPct: 0, cgId: 'dogwifcoin', cgRank: 4, cgGlobalRank: 200, decimals: null });
    const merged = mergeInfo(cgc, { mint: WIF, symbol: '$WIF', name: 'dogwifhat', logo: null, decimals: 6, tags: ['meme'], dailyVolumeUsd: 5 }, 'merged');
    expect(merged.symbol).toBe('$WIF');
    expect(merged.decimals).toBe(6);
    expect(merged.logo).toBe('https://cg/wif.png');
    expect(merged.cg?.rank).toBe(4);
    expect(merged.universeSource).toBe('merged');
  });
});

describe('methodology config: universe', () => {
  it('defaults to the CoinGecko category with 150 candidates and can be overridden from env', () => {
    expect(DEFAULT_METHODOLOGY_CONFIG.universe).toEqual({ source: 'coingecko', coingeckoCategory: 'solana-meme-coins', maxCandidates: 150 });
    const cfg = methodologyConfigFromEnv({ UNIVERSE_SOURCE: 'merged', COINGECKO_CATEGORY: 'meme-token', UNIVERSE_MAX_CANDIDATES: '80' });
    expect(cfg.universe).toEqual({ source: 'merged', coingeckoCategory: 'meme-token', maxCandidates: 80 });
    expect(methodologyConfigFromEnv({ UNIVERSE_SOURCE: 'bogus' }).universe.source).toBe('coingecko');
    expect(withMethodologyOverrides(DEFAULT_METHODOLOGY_CONFIG, { minVolume24hUsd: 150_000 }).eligibility.minVolume24hUsd).toBe(150_000);
  });
});

describe('methodology run carries cgRank / source', () => {
  const cand = (o: Partial<ReportCandidate> & { mint: string }): ReportCandidate => ({
    symbol: o.mint.slice(0, 4),
    name: o.mint,
    decimals: 6,
    priceUsd: 1,
    fdvUsd: 1e8,
    marketCapUsd: 1e8,
    volume24hUsd: 1e6,
    avgVolume7dUsd: null,
    firstTradeAt: Date.parse('2024-01-01'),
    mintAuthority: null,
    freezeAuthority: null,
    sellImpactBps: 10,
    tags: [],
    liquidityUsd: 1e6,
    holderCount: null,
    topHoldersPct: null,
    organicScore: null,
    tokenProgram: null,
    stats: null,
    ...o,
  });

  it('ranks by the (CoinGecko) market cap given and records cgRank/source in eligibility, selection and proposals', () => {
    const cands = [
      cand({ mint: 'A', marketCapUsd: 5e8, cgRank: 1, cgId: 'a', source: 'coingecko' }),
      cand({ mint: 'B', marketCapUsd: 9e8, cgRank: 2, cgId: 'b', source: 'coingecko' }), // CoinGecko rank 2 but a larger ranking mcap here: ranking uses marketCapUsd
      cand({ mint: 'C', marketCapUsd: 1e8, source: 'incumbent' }),
      cand({ mint: 'D', marketCapUsd: 3e8, cgRank: 7, cgId: 'd', source: 'coingecko', volume24hUsd: 1000 }),
    ];
    const run = runMethodology(cands, new Set(['C']), DEFAULT_METHODOLOGY_CONFIG, new Date('2026-10-03T00:00:00Z'));
    expect(run.universe?.source).toBe('coingecko');
    expect(run.selection.selected.map((s) => s.mint)).toEqual(['B', 'A', 'C']);
    expect(run.selection.selected[0]).toMatchObject({ rank: 1, cgRank: 2, source: 'coingecko' });
    expect(run.selection.selected[2]).toMatchObject({ rank: 3, cgRank: null, source: 'incumbent' });
    const d = run.eligible.find((e) => e.mint === 'D')!;
    expect(d.eligible).toBe(false);
    expect(d.cgRank).toBe(7);
    const changes = MethodologyJob.indicatedChanges(run, cands);
    const add = changes.find((c) => c.mint === 'B')!;
    expect(add.action).toBe('add');
    expect(add.metrics).toMatchObject({ rank: 1, cgRank: 2, cgId: 'b', universeSource: 'coingecko' });
    expect('source' in add.metrics).toBe(false); // `source: 'methodology'` is set by the reconstitution service and must not be clobbered
  });

  it('launch report renders the Source column, the CoinGecko top-N comparison and preserves committee notes', () => {
    const cands = [cand({ mint: 'A', marketCapUsd: 5e8, cgRank: 1, cgId: 'a', source: 'coingecko', cgMarketCapUsd: 5e8, cgVolume24hUsd: 2e6 }), cand({ mint: 'B', marketCapUsd: 2e8, cgRank: 2, cgId: 'b', source: 'coingecko', volume24hUsd: 1000 })];
    const run = runMethodology(cands, new Set(), DEFAULT_METHODOLOGY_CONFIG, new Date('2026-10-03T00:00:00Z'));
    const md = renderLaunchReport({
      generatedAt: '2026-10-03T00:00:00Z',
      rpc: 'https://rpc',
      jupiterBase: 'https://lite-api.jup.ag',
      solPriceUsd: 100,
      run,
      candidates: cands,
      alternates: 5,
      seeds: [{ seedSol: 5, perAssetSol: 2.5, impactBps: new Map([['A', 10]]) }],
      committeeNotes: ['- keep me'],
      cgTop: [
        { cgRank: 1, cgId: 'a', symbol: 'A', name: 'A', mint: 'A', marketCapUsd: 5e8, volume24hUsd: 2e6 },
        { cgRank: 2, cgId: 'b', symbol: 'B', name: 'B', mint: 'B', marketCapUsd: 2e8, volume24hUsd: 1e6 },
        { cgRank: 3, cgId: 'c', symbol: 'C', name: 'C', mint: null, marketCapUsd: 1e8, volume24hUsd: 1e6 },
      ],
    });
    expect(md).toContain('Universe: CoinGecko category `solana-meme-coins` ranked by market cap (top 150)');
    expect(md).toContain('## 0. Committee notes on this run (hand-written)\n\n- keep me');
    expect(md).toContain('1 of 3 are in the proposed basket');
    expect(md).toMatch(/\| 1 \| A .*\| `a` \| .*\*\*selected\*\* #1 \|/);
    expect(md).toMatch(/\| 2 \| B .*fails: volume_24h_too_low, volume_7d_too_low \|/);
    expect(md).toContain('no Solana mint on CoinGecko (dropped)');
    expect(md).toMatch(/\| 1 \| A \[.*\| CG #1 \|/);
    expect(md).not.toContain('not tagged meme by Jupiter');
    expect(extractCommitteeNotes(md)).toEqual(['- keep me']);
    expect(extractCommitteeNotes('# nothing\n\n## 1. x\n')).toBeNull();
  });
});
