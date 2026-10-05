import { TtlCache } from '../util/cache.js';
import { fetchJson } from '../util/retry.js';
import { childLogger } from '../util/logger.js';
import { NO_LIMIT, type RateLimiter } from '../util/rate-limit.js';
import type { TokenInfo, TokenInfoSource, TokenListStats, TokenUniverseCandidate } from './types.js';

const log = childLogger('sources.jupiter-tokens');

/**
 * Jupiter Tokens API v2 (live, verified 2026-10-03). tokens.jup.ag (v1 list) is gone.
 *   GET {tokensBase}/tag?query=verified           ~3.9k tokens
 *   GET {tokensBase}/search?query=m1,m2,…          up to 100 mints per call (also accepts symbols/names)
 *   GET {tokensBase}/toptraded/24h?limit=100
 */
export interface JupTokenV2 {
  id: string;
  name: string;
  symbol: string;
  icon?: string | null;
  decimals: number;
  dev?: string | null;
  circSupply?: number | null;
  totalSupply?: number | null;
  tokenProgram?: string;
  holderCount?: number | null;
  fdv?: number | null;
  mcap?: number | null;
  usdPrice?: number | null;
  liquidity?: number | null;
  stats24h?: { buyVolume?: number; sellVolume?: number; priceChange?: number; numTraders?: number } | null;
  firstPool?: { id?: string; createdAt?: string } | null;
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; devBalancePercentage?: number } | null;
  organicScore?: number | null;
  organicScoreLabel?: string | null;
  isVerified?: boolean | null;
  tags?: string[] | null;
  createdAt?: string;
}

/** Legacy v1 list entry (kept so recorded fixtures / the static source still parse). */
export interface JupTokenV1 {
  address: string;
  symbol: string;
  name: string;
  logoURI?: string | null;
  decimals: number;
  tags?: string[];
  daily_volume?: number | null;
}

export const JUPITER_TOKENS_SEARCH_BATCH = 100;

/** Token metadata + candidate universe (implemented by Jupiter's list and by the static source). */
export interface TokenUniverseSource extends TokenInfoSource {
  topByVolume(n: number): Promise<TokenInfo[]>;
  /**
   * Candidate universe in the source's own ranking (CoinGecko: market cap; Jupiter: 24h volume), tagged with the
   * nominating source. Sources without it fall back to `topByVolume`.
   */
  universe?(n: number): Promise<TokenUniverseCandidate[]>;
}

export function volume24h(t: JupTokenV2): number | null {
  const s = t.stats24h;
  if (!s) return null;
  const v = (s.buyVolume ?? 0) + (s.sellVolume ?? 0);
  return Number.isFinite(v) ? v : null;
}

export function toInfoV2(t: JupTokenV2): TokenInfo {
  const num = (x: number | null | undefined): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const first = t.firstPool?.createdAt ? Date.parse(t.firstPool.createdAt) : NaN;
  const stats: TokenListStats = {
    usdPrice: num(t.usdPrice),
    marketCapUsd: num(t.mcap),
    fdvUsd: num(t.fdv),
    liquidityUsd: num(t.liquidity),
    volume24hUsd: volume24h(t),
    holderCount: num(t.holderCount),
    firstPoolCreatedAt: Number.isFinite(first) ? first : null,
    organicScore: num(t.organicScore),
    organicScoreLabel: t.organicScoreLabel ?? null,
    isVerified: t.isVerified ?? null,
    audit: t.audit
      ? {
          mintAuthorityDisabled: t.audit.mintAuthorityDisabled ?? null,
          freezeAuthorityDisabled: t.audit.freezeAuthorityDisabled ?? null,
          topHoldersPercentage: num(t.audit.topHoldersPercentage),
          devBalancePercentage: num(t.audit.devBalancePercentage),
        }
      : null,
    tokenProgram: t.tokenProgram ?? null,
  };
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name,
    logo: t.icon ?? null,
    decimals: t.decimals,
    tags: t.tags ?? [],
    dailyVolumeUsd: stats.volume24hUsd,
    stats,
  };
}

export function toInfoV1(t: JupTokenV1): TokenInfo {
  return {
    mint: t.address,
    symbol: t.symbol,
    name: t.name,
    logo: t.logoURI ?? null,
    decimals: t.decimals,
    tags: t.tags ?? [],
    dailyVolumeUsd: typeof t.daily_volume === 'number' ? t.daily_volume : null,
  };
}

/** Accepts either list shape. */
export function parseTokenList(arr: unknown): TokenInfo[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => ('id' in (t as object) ? toInfoV2(t as JupTokenV2) : toInfoV1(t as JupTokenV1)));
}

export class JupiterTokenListSource implements TokenUniverseSource {
  private readonly listCache = new TtlCache<Map<string, TokenInfo>>(10 * 60_000);
  private readonly single = new TtlCache<TokenInfo>(10 * 60_000);

  /**
   * @param tokensBase  e.g. https://lite-api.jup.ag/tokens/v2
   * @param universeTag tag used for the candidate universe (`verified`)
   */
  constructor(
    private readonly tokensBase: string,
    private readonly headers: Record<string, string> = {},
    private readonly limiter: RateLimiter = NO_LIMIT,
    private readonly universeTag = 'verified',
  ) {}

  private async list(): Promise<Map<string, TokenInfo>> {
    return this.listCache.getOrLoad('list', async () => {
      const url = `${this.tokensBase}/tag?query=${encodeURIComponent(this.universeTag)}`;
      const arr = await this.limiter.run(() => fetchJson<unknown>(url, { retries: 2, timeoutMs: 30_000, headers: this.headers }));
      const map = new Map<string, TokenInfo>();
      for (const t of parseTokenList(arr)) map.set(t.mint, t);
      log.debug({ n: map.size }, 'token list loaded');
      return map;
    });
  }

  /** Candidate universe: verified tokens ranked by Jupiter 24h volume. */
  async topByVolume(n: number): Promise<TokenInfo[]> {
    const list = await this.list();
    return [...list.values()]
      .filter((t) => (t.dailyVolumeUsd ?? 0) > 0)
      .sort((a, b) => (b.dailyVolumeUsd ?? 0) - (a.dailyVolumeUsd ?? 0))
      .slice(0, n);
  }

  /** Metadata for arbitrary mints: verified list first, then `search` in batches of 100 (unverified tokens included). */
  async getTokenInfo(mints: readonly string[]): Promise<Map<string, TokenInfo>> {
    const out = new Map<string, TokenInfo>();
    let list: Map<string, TokenInfo> | undefined;
    try {
      list = await this.list();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'token list unavailable; falling back to search lookups');
    }
    const missing: string[] = [];
    for (const m of mints) {
      const hit = list?.get(m) ?? this.single.get(m);
      if (hit) out.set(m, hit);
      else missing.push(m);
    }
    for (let i = 0; i < missing.length; i += JUPITER_TOKENS_SEARCH_BATCH) {
      const chunk = missing.slice(i, i + JUPITER_TOKENS_SEARCH_BATCH);
      try {
        const arr = await this.limiter.run(() => fetchJson<unknown>(`${this.tokensBase}/search?query=${chunk.join(',')}`, { retries: 1, timeoutMs: 15_000, headers: this.headers }));
        for (const info of parseTokenList(arr)) {
          if (!chunk.includes(info.mint)) continue; // search also matches by symbol/name
          this.single.set(info.mint, info);
          out.set(info.mint, info);
        }
      } catch (err) {
        log.debug({ err: (err as Error).message, n: chunk.length }, 'token search failed');
      }
    }
    return out;
  }
}
