import { TtlCache } from '../util/cache.js';
import { fetchJson } from '../util/retry.js';
import { childLogger } from '../util/logger.js';
import { RateLimiter } from '../util/rate-limit.js';
import type { MarketDataSource, PriceSource, TokenMarketData } from './types.js';

const log = childLogger('sources.dexscreener');

/**
 * DexScreener (live, verified 2026-10-03; no key, 300 req/min):
 *   GET /tokens/v1/solana/{m1,m2,…}   up to 30 mints -> DexPair[]  (ONE pair per token: the primary pool only)
 *   GET /token-pairs/v1/solana/{mint} -> DexPair[]  (all pools of one token, up to ~30)
 * Fields used: priceUsd, volume.h24, liquidity.usd, fdv, marketCap, pairCreatedAt, priceChange.h24, info.imageUrl.
 */
export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; header?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}

/** Aggregates all pairs of each base token: price from deepest pool, volume & liquidity summed. */
export function aggregatePairs(pairs: readonly DexPair[], wanted: ReadonlySet<string>): Map<string, TokenMarketData> {
  const byMint = new Map<string, DexPair[]>();
  for (const p of pairs) {
    if (p.chainId !== 'solana') continue;
    const mint = p.baseToken?.address;
    if (!mint || !wanted.has(mint)) continue;
    const arr = byMint.get(mint) ?? [];
    arr.push(p);
    byMint.set(mint, arr);
  }
  const out = new Map<string, TokenMarketData>();
  for (const [mint, ps] of byMint) {
    const sorted = [...ps].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = sorted[0];
    if (!best) continue;
    const price = Number(best.priceUsd ?? 0);
    let volume = 0;
    let liquidity = 0;
    let created: number | null = null;
    for (const p of ps) {
      volume += p.volume?.h24 ?? 0;
      liquidity += p.liquidity?.usd ?? 0;
      if (p.pairCreatedAt && (created === null || p.pairCreatedAt < created)) created = p.pairCreatedAt;
    }
    out.set(mint, {
      mint,
      priceUsd: price,
      volume24hUsd: volume,
      liquidityUsd: liquidity,
      fdvUsd: best.fdv ?? 0,
      marketCapUsd: best.marketCap ?? best.fdv ?? 0,
      change24hPct: best.priceChange?.h24 ?? 0,
      pairCreatedAt: created,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      logo: ps.find((p) => p.info?.imageUrl)?.info?.imageUrl ?? null,
      source: 'dexscreener',
    });
  }
  return out;
}

export class DexScreenerSource implements MarketDataSource, PriceSource {
  private readonly cache: TtlCache<TokenMarketData>;
  private readonly pairsCache: TtlCache<DexPair[]>;
  private readonly limiter: RateLimiter;

  constructor(
    private readonly base: string,
    ttlMs = 30_000,
    /** 300 req/min documented; 250 ms keeps a comfortable margin. */
    minIntervalMs = 250,
  ) {
    this.cache = new TtlCache<TokenMarketData>(ttlMs);
    this.pairsCache = new TtlCache<DexPair[]>(5 * 60_000);
    this.limiter = new RateLimiter(minIntervalMs);
  }

  /**
   * Primary-pool snapshot for up to 30 mints per call. Note: `tokens/v1` returns only the main pair per token,
   * so `volume24hUsd`/`liquidityUsd` here are the deepest pool's, not the token's total (see getAllPairs).
   */
  async getMarketData(mints: readonly string[]): Promise<Map<string, TokenMarketData>> {
    const out = new Map<string, TokenMarketData>();
    const missing: string[] = [];
    for (const m of mints) {
      const hit = this.cache.get(m);
      if (hit) out.set(m, hit);
      else missing.push(m);
    }
    for (let i = 0; i < missing.length; i += 30) {
      const chunk = missing.slice(i, i + 30);
      const url = `${this.base}/tokens/v1/solana/${chunk.join(',')}`;
      try {
        const pairs = await this.limiter.run(() => fetchJson<DexPair[]>(url, { retries: 2 }));
        for (const [mint, md] of aggregatePairs(Array.isArray(pairs) ? pairs : [], new Set(chunk))) {
          this.cache.set(mint, md);
          out.set(mint, md);
        }
      } catch (err) {
        log.warn({ err: (err as Error).message, n: chunk.length }, 'dexscreener fetch failed');
      }
    }
    return out;
  }

  /** Every Solana pool of one token (one request per mint). Used for total volume / earliest pair age. */
  async getAllPairs(mint: string): Promise<DexPair[]> {
    return this.pairsCache.getOrLoad(mint, async () => {
      const pairs = await this.limiter.run(() => fetchJson<DexPair[]>(`${this.base}/token-pairs/v1/solana/${mint}`, { retries: 2 }));
      return Array.isArray(pairs) ? pairs.filter((p) => p.chainId === 'solana' && p.baseToken?.address === mint) : [];
    });
  }

  /** Token-level aggregate across all pools (sum volume/liquidity, min pairCreatedAt). */
  async getAggregated(mint: string): Promise<TokenMarketData | undefined> {
    const pairs = await this.getAllPairs(mint).catch((err: Error) => {
      log.debug({ err: err.message, mint }, 'token-pairs fetch failed');
      return [] as DexPair[];
    });
    return aggregatePairs(pairs, new Set([mint])).get(mint);
  }

  async getPrices(mints: readonly string[]): Promise<Map<string, number>> {
    const md = await this.getMarketData(mints);
    const out = new Map<string, number>();
    for (const [m, d] of md) if (d.priceUsd > 0) out.set(m, d.priceUsd);
    return out;
  }
}
