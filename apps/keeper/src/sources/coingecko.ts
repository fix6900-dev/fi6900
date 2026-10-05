/**
 * CoinGecko "Solana Meme Coins" category as the primary candidate universe (verified live 2026-10-03).
 *
 *   GET {base}/coins/markets?vs_currency=usd&category=solana-meme-coins&order=market_cap_desc&per_page=250&page=N
 *        -> CgMarket[] (id, symbol, name, image, market_cap, fully_diluted_valuation, total_volume, price change ...)
 *   GET {base}/coins/list?include_platform=true    -> { id, symbol, name, platforms: { solana: <mint>, ... } }[]  (~22k, 3.9 MB)
 *   GET {base}/coins/{id}?localization=false&tickers=false&market_data=false&...   -> platforms / detail_platforms (fallback)
 *
 *   base = https://api.coingecko.com/api/v3       free "demo" tier, no key needed; optional `x-cg-demo-api-key`; ~30 req/min
 *   base = https://pro-api.coingecko.com/api/v3   paid tier, `x-cg-pro-api-key` (COINGECKO_PRO=true)
 *
 * CoinGecko membership in the category is the index's memecoin classification (docs/methodology.md 2.5 / 2.6).
 * Market data (mcap, FDV, volume, 24h change) is carried for ranking; liquidity, impact, authorities, aggregated
 * volume and age still come from Jupiter / DexScreener / RPC. The coins list is cached 24 h on disk + in memory,
 * the category pages 10 min in memory; `/coins/{id}` only runs for ids missing from the list.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import bs58 from 'bs58';
import { TtlCache } from '../util/cache.js';
import { childLogger } from '../util/logger.js';
import { RateLimiter } from '../util/rate-limit.js';
import { fetchJson as defaultFetchJson, type FetchJsonOptions } from '../util/retry.js';
import type { TokenInfo, TokenMarketData, TokenUniverseCandidate } from './types.js';
import type { TokenUniverseSource } from './jupiter-tokens.js';

const log = childLogger('sources.coingecko');

export const COINGECKO_FREE_BASE = 'https://api.coingecko.com/api/v3';
export const COINGECKO_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
export const COINGECKO_DEFAULT_CATEGORY = 'solana-meme-coins';
/** Free tier: documented 30 req/min; 2100 ms spacing (~28/min) stays under it with the Retry-After handling as backstop. */
export const COINGECKO_FREE_INTERVAL_MS = 2_100;
export const COINGECKO_KEYED_INTERVAL_MS = 150;
const PER_PAGE = 250;
const LIST_TTL_MS = 24 * 3600_000;
const MARKETS_TTL_MS = 10 * 60_000;
const LIST_CACHE_FILE = 'coingecko-coins-list.json';

/** `/coins/markets` row (only the fields the keeper reads). */
export interface CgMarket {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  current_price?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  fully_diluted_valuation?: number | null;
  total_volume?: number | null;
  price_change_percentage_24h?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  last_updated?: string | null;
}

/** `/coins/list?include_platform=true` row. */
export interface CgListCoin {
  id: string;
  symbol: string;
  name: string;
  platforms?: Record<string, string | null> | null;
}

/** `/coins/{id}` subset. */
export interface CgCoinDetail {
  id: string;
  platforms?: Record<string, string | null> | null;
  detail_platforms?: Record<string, { decimal_place?: number | null; contract_address?: string | null } | null> | null;
}

/** One category member with its resolved Solana mint. `cgRank` is the position in the category by market cap (1-based). */
export interface CoinGeckoCandidate {
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  cgId: string;
  cgRank: number;
  /** Global CoinGecko market-cap rank when reported. */
  cgGlobalRank: number | null;
  /** Decimals when `/coins/{id}` was consulted (detail_platforms); null otherwise. */
  decimals: number | null;
}

export interface CoinGeckoOptions {
  apiKey?: string;
  pro?: boolean;
  /** Override base URL (proxies); defaults depend on `pro`. */
  base?: string;
  category?: string;
  /** Directory for the on-disk coins-list cache (keeper data dir). Omit to keep the list in memory only. */
  dataDir?: string;
  limiter?: RateLimiter;
  /** Injected for tests. */
  fetchJson?: <T>(url: string, opts?: FetchJsonOptions) => Promise<T>;
  now?: () => number;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** A Solana mint is a base58 string decoding to exactly 32 bytes. */
export function isValidSolanaMint(s: unknown): s is string {
  if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

/** Mint from a platforms map (`/coins/list` or `/coins/{id}`), validated; null when absent or malformed. */
export function solanaMintOf(platforms: Record<string, string | null> | null | undefined): string | null {
  const m = platforms?.solana;
  return isValidSolanaMint(m) ? m : null;
}

/** Parses `/coins/markets` rows, keeping order (= category rank) and dropping malformed entries. */
export function parseMarkets(arr: unknown): CgMarket[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((c): c is CgMarket => !!c && typeof c === 'object' && typeof (c as CgMarket).id === 'string' && typeof (c as CgMarket).symbol === 'string');
}

export function parseCoinsList(arr: unknown): Map<string, CgListCoin> {
  const out = new Map<string, CgListCoin>();
  if (!Array.isArray(arr)) return out;
  for (const c of arr) {
    if (c && typeof c === 'object' && typeof (c as CgListCoin).id === 'string') out.set((c as CgListCoin).id, c as CgListCoin);
  }
  return out;
}

export interface MintResolution {
  candidates: CoinGeckoCandidate[];
  /** ids dropped because no (valid) Solana mint could be found. */
  dropped: { cgId: string; symbol: string; reason: 'no_solana_mint' | 'invalid_mint' }[];
}

/**
 * Pure join of category rows with the platforms list. `rank` restarts at 1 for the first row (market_cap_desc order),
 * so ranks are stable across pages when the caller passes the concatenated pages. Duplicate mints keep the
 * higher-ranked entry.
 */
export function resolveCandidates(markets: readonly CgMarket[], platforms: ReadonlyMap<string, { platforms?: Record<string, string | null> | null; decimals?: number | null }>): MintResolution {
  const candidates: CoinGeckoCandidate[] = [];
  const dropped: MintResolution['dropped'] = [];
  const seen = new Set<string>();
  markets.forEach((m, i) => {
    const p = platforms.get(m.id);
    const raw = p?.platforms?.solana;
    const mint = solanaMintOf(p?.platforms);
    if (!mint) {
      dropped.push({ cgId: m.id, symbol: m.symbol, reason: raw ? 'invalid_mint' : 'no_solana_mint' });
      return;
    }
    if (seen.has(mint)) return;
    seen.add(mint);
    candidates.push({
      mint,
      symbol: m.symbol.toUpperCase(),
      name: m.name,
      logo: m.image ?? null,
      priceUsd: num(m.current_price),
      marketCapUsd: num(m.market_cap),
      fdvUsd: num(m.fully_diluted_valuation),
      volume24hUsd: num(m.total_volume),
      change24hPct: num(m.price_change_percentage_24h),
      cgId: m.id,
      cgRank: i + 1,
      cgGlobalRank: num(m.market_cap_rank),
      decimals: p?.decimals ?? null,
    });
  });
  return { candidates, dropped };
}

export function toUniverseCandidate(c: CoinGeckoCandidate): TokenUniverseCandidate {
  return {
    mint: c.mint,
    symbol: c.symbol,
    name: c.name,
    logo: c.logo,
    decimals: c.decimals ?? 6,
    tags: [],
    dailyVolumeUsd: c.volume24hUsd,
    cg: { id: c.cgId, rank: c.cgRank, marketCapUsd: c.marketCapUsd, fdvUsd: c.fdvUsd, volume24hUsd: c.volume24hUsd, change24hPct: c.change24hPct },
    universeSource: 'coingecko',
  };
}

interface ListCacheFile {
  fetchedAt: number;
  coins: CgListCoin[];
}

export class CoinGeckoSource implements TokenUniverseSource {
  readonly base: string;
  readonly category: string;
  readonly headers: Record<string, string>;
  readonly limiter: RateLimiter;
  private readonly fetchJson: <T>(url: string, opts?: FetchJsonOptions) => Promise<T>;
  private readonly now: () => number;
  private readonly dataDir: string | undefined;
  private readonly marketsCache: TtlCache<MintResolution>;
  private listMem: { fetchedAt: number; coins: Map<string, CgListCoin> } | null = null;
  private listInflight: Promise<Map<string, CgListCoin>> | null = null;
  /** `/coins/{id}` results (null = no Solana mint); never expires within a process. */
  private readonly detail = new Map<string, { platforms: Record<string, string | null> | null; decimals: number | null } | null>();

  constructor(opts: CoinGeckoOptions = {}) {
    const pro = Boolean(opts.pro && opts.apiKey);
    this.base = (opts.base ?? (pro ? COINGECKO_PRO_BASE : COINGECKO_FREE_BASE)).replace(/\/+$/, '');
    this.category = opts.category ?? COINGECKO_DEFAULT_CATEGORY;
    this.headers = opts.apiKey ? (pro ? { 'x-cg-pro-api-key': opts.apiKey } : { 'x-cg-demo-api-key': opts.apiKey }) : {};
    this.limiter = opts.limiter ?? new RateLimiter(opts.apiKey ? COINGECKO_KEYED_INTERVAL_MS : COINGECKO_FREE_INTERVAL_MS);
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.now = opts.now ?? Date.now;
    this.dataDir = opts.dataDir;
    this.marketsCache = new TtlCache<MintResolution>(MARKETS_TTL_MS, this.now);
  }

  private get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    const url = `${this.base}${path}`;
    // fetchJson already honours Retry-After on 429 and retries; the limiter spaces request starts.
    return this.limiter.run(() => this.fetchJson<T>(url, { retries: 3, timeoutMs, headers: this.headers, baseMs: 2_000, maxMs: 65_000 }));
  }

  // ---- coins list (id -> platforms), 24 h cache -------------------------------------------------

  private listCachePath(): string | null {
    return this.dataDir ? join(this.dataDir, LIST_CACHE_FILE) : null;
  }

  private readListFromDisk(): ListCacheFile | null {
    const p = this.listCachePath();
    if (!p || !existsSync(p)) return null;
    try {
      const f = JSON.parse(readFileSync(p, 'utf8')) as ListCacheFile;
      if (!Array.isArray(f.coins) || typeof f.fetchedAt !== 'number') return null;
      return f;
    } catch (err) {
      log.warn({ err: (err as Error).message, path: p }, 'coins list cache unreadable; refetching');
      return null;
    }
  }

  private writeListToDisk(f: ListCacheFile): void {
    const p = this.listCachePath();
    if (!p) return;
    try {
      mkdirSync(this.dataDir as string, { recursive: true });
      writeFileSync(p, JSON.stringify(f));
    } catch (err) {
      log.warn({ err: (err as Error).message, path: p }, 'could not write coins list cache');
    }
  }

  /** id -> list row. Memory, then disk (<= 24 h old), then the API. A failed refresh keeps stale data if any. */
  async coinsList(): Promise<Map<string, CgListCoin>> {
    const now = this.now();
    if (this.listMem && now - this.listMem.fetchedAt < LIST_TTL_MS) return this.listMem.coins;
    if (this.listInflight) return this.listInflight;
    this.listInflight = (async () => {
      if (!this.listMem) {
        const disk = this.readListFromDisk();
        if (disk) {
          this.listMem = { fetchedAt: disk.fetchedAt, coins: parseCoinsList(disk.coins) };
          if (now - disk.fetchedAt < LIST_TTL_MS) {
            log.debug({ n: this.listMem.coins.size, ageH: ((now - disk.fetchedAt) / 3600_000).toFixed(1) }, 'coins list from disk cache');
            return this.listMem.coins;
          }
        }
      }
      try {
        const arr = await this.get<unknown>('/coins/list?include_platform=true', 60_000);
        const coins = parseCoinsList(arr);
        if (coins.size === 0) throw new Error('empty coins list');
        this.listMem = { fetchedAt: this.now(), coins };
        this.writeListToDisk({ fetchedAt: this.listMem.fetchedAt, coins: [...coins.values()] });
        log.info({ n: coins.size }, 'coingecko coins list refreshed');
        return coins;
      } catch (err) {
        if (this.listMem) {
          log.warn({ err: (err as Error).message }, 'coins list refresh failed; using stale cache');
          return this.listMem.coins;
        }
        throw err;
      }
    })().finally(() => {
      this.listInflight = null;
    });
    return this.listInflight;
  }

  /** `/coins/{id}` platforms for ids the list does not cover (rate-limited; memoised per process). */
  private async coinDetail(id: string): Promise<{ platforms: Record<string, string | null> | null; decimals: number | null } | null> {
    if (this.detail.has(id)) return this.detail.get(id) ?? null;
    let out: { platforms: Record<string, string | null> | null; decimals: number | null } | null = null;
    try {
      const d = await this.get<CgCoinDetail>(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, 20_000);
      const sol = d.detail_platforms?.solana;
      const platforms = d.platforms ?? (sol?.contract_address ? { solana: sol.contract_address } : null);
      out = { platforms, decimals: num(sol?.decimal_place) };
    } catch (err) {
      log.warn({ id, err: (err as Error).message.slice(0, 160) }, 'coin detail lookup failed');
    }
    this.detail.set(id, out);
    return out;
  }

  // ---- category pages, 10 min cache ---------------------------------------------------------------

  private async fetchMarkets(maxCandidates: number): Promise<CgMarket[]> {
    const pages = Math.max(1, Math.ceil(maxCandidates / PER_PAGE));
    const rows: CgMarket[] = [];
    for (let page = 1; page <= pages; page++) {
      const arr = await this.get<unknown>(`/coins/markets?vs_currency=usd&category=${encodeURIComponent(this.category)}&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}&sparkline=false`);
      const parsed = parseMarkets(arr);
      rows.push(...parsed);
      if (parsed.length < PER_PAGE) break;
    }
    return rows;
  }

  /**
   * The category ranked by market cap with Solana mints resolved. `maxCandidates` bounds how many CoinGecko rows are
   * fetched (pages of 250); entries without a Solana mint are dropped, so slightly fewer may come back.
   */
  async resolve(maxCandidates = PER_PAGE): Promise<MintResolution> {
    const key = `markets:${Math.ceil(maxCandidates / PER_PAGE)}`;
    const res = await this.marketsCache.getOrLoad(key, async () => {
      const [markets, list] = await Promise.all([this.fetchMarkets(maxCandidates), this.coinsList()]);
      const platforms = new Map<string, { platforms?: Record<string, string | null> | null; decimals?: number | null }>();
      const misses: CgMarket[] = [];
      for (const m of markets) {
        const row = list.get(m.id);
        if (row && solanaMintOf(row.platforms)) platforms.set(m.id, { platforms: row.platforms });
        else misses.push(m);
      }
      // Sequential on purpose: one request per miss, through the limiter.
      for (const m of misses) {
        const d = await this.coinDetail(m.id);
        if (d) platforms.set(m.id, d);
      }
      const r = resolveCandidates(markets, platforms);
      log.info({ category: this.category, rows: markets.length, resolved: r.candidates.length, dropped: r.dropped.length, detailLookups: misses.length }, 'coingecko universe resolved');
      if (r.dropped.length) log.debug({ dropped: r.dropped }, 'coingecko rows without a Solana mint');
      return r;
    });
    return { candidates: res.candidates.slice(0, maxCandidates), dropped: res.dropped };
  }

  /** Top-N category members by CoinGecko market cap. */
  async candidates(n: number): Promise<CoinGeckoCandidate[]> {
    return (await this.resolve(n)).candidates;
  }

  // ---- TokenUniverseSource ------------------------------------------------------------------------

  /** Universe in CoinGecko's own order (market cap). */
  async universe(n: number): Promise<TokenUniverseCandidate[]> {
    return (await this.candidates(n)).map(toUniverseCandidate);
  }

  /** Same members as `universe`, ordered by CoinGecko 24h volume (kept for interface parity). */
  async topByVolume(n: number): Promise<TokenInfo[]> {
    const all = await this.universe(n);
    return [...all].sort((a, b) => (b.dailyVolumeUsd ?? 0) - (a.dailyVolumeUsd ?? 0));
  }

  /** Metadata for category members only (CoinGecko cannot look up arbitrary mints cheaply). */
  async getTokenInfo(mints: readonly string[]): Promise<Map<string, TokenInfo>> {
    const out = new Map<string, TokenInfo>();
    let all: TokenUniverseCandidate[];
    try {
      all = await this.universe(PER_PAGE);
    } catch (err) {
      log.debug({ err: (err as Error).message }, 'coingecko universe unavailable for token info');
      return out;
    }
    const byMint = new Map(all.map((c) => [c.mint, c]));
    for (const m of mints) {
      const c = byMint.get(m);
      if (c) out.set(m, c);
    }
    return out;
  }

  /** CoinGecko market data for category members (ranking input; liquidity/age are unknown here). */
  async getMarketData(mints: readonly string[]): Promise<Map<string, TokenMarketData>> {
    const out = new Map<string, TokenMarketData>();
    const byMint = new Map((await this.candidates(PER_PAGE)).map((c) => [c.mint, c]));
    for (const m of mints) {
      const c = byMint.get(m);
      if (!c) continue;
      out.set(m, {
        mint: m,
        priceUsd: c.priceUsd ?? 0,
        volume24hUsd: c.volume24hUsd ?? 0,
        liquidityUsd: 0,
        fdvUsd: c.fdvUsd ?? c.marketCapUsd ?? 0,
        marketCapUsd: c.marketCapUsd ?? c.fdvUsd ?? 0,
        change24hPct: c.change24hPct ?? 0,
        pairCreatedAt: null,
        symbol: c.symbol,
        name: c.name,
        logo: c.logo,
        source: 'coingecko',
      });
    }
    return out;
  }
}

/** Build from env-like settings (keeps env parsing out of this module). */
export function createCoinGeckoSource(o: { apiKey?: string; pro?: boolean; base?: string; category?: string; dataDir?: string; minIntervalMs?: number }): CoinGeckoSource {
  const limiter = o.minIntervalMs !== undefined ? new RateLimiter(o.minIntervalMs) : undefined;
  return new CoinGeckoSource({ apiKey: o.apiKey, pro: o.pro, base: o.base, category: o.category, dataDir: o.dataDir, limiter: limiter ?? (o.apiKey ? new RateLimiter(COINGECKO_KEYED_INTERVAL_MS) : new RateLimiter(COINGECKO_FREE_INTERVAL_MS)) });
}
