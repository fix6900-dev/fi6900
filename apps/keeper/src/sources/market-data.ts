/**
 * Composite market-data source.
 *
 *   price           Jupiter Price v3 (primary) -> DexScreener primary pool (fallback)
 *   volume/liq/mcap Jupiter tokens/v2 aggregate (all venues) and DexScreener, whichever is larger
 *                   (DexScreener `tokens/v1` only reports the deepest pool; `token-pairs/v1` sums all pools
 *                   when `getMarketData(mints, { allPairs: true })` is requested)
 *   age             earliest of DexScreener pairCreatedAt and Jupiter firstPool.createdAt
 *   metadata        Jupiter tokens/v2 (symbol, name, icon, decimals, tags, audit)
 */
import { childLogger } from '../util/logger.js';
import type { MarketDataSource, PriceSource, TokenInfo, TokenInfoSource, TokenMarketData } from './types.js';
import { WSOL_MINT } from './types.js';

const log = childLogger('sources.market');

export interface EnrichedMarketData extends TokenMarketData {
  info: TokenInfo | null;
}

export interface DexAggregator extends MarketDataSource, PriceSource {
  /** Optional: token-level aggregate across every pool (one request per mint). */
  getAggregated?(mint: string): Promise<TokenMarketData | undefined>;
}

export interface MarketDataOptions {
  /** Also query every pool of each token on DexScreener (slower: one request per mint). */
  allPairs?: boolean;
}

const max = (...xs: (number | null | undefined)[]): number => Math.max(0, ...xs.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)));
const minTs = (...xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0);
  return v.length ? Math.min(...v) : null;
};

export class CompositeMarketData implements MarketDataSource, PriceSource {
  constructor(
    private readonly primaryPrices: PriceSource,
    private readonly dex: DexAggregator,
    private readonly tokens: TokenInfoSource,
    private readonly solFallbackUsd: number,
  ) {}

  async getPrices(mints: readonly string[]): Promise<Map<string, number>> {
    const prices = await this.primaryPrices.getPrices(mints);
    const missing = mints.filter((m) => !prices.has(m));
    if (missing.length) {
      const fb = await this.dex.getPrices(missing);
      for (const [m, p] of fb) prices.set(m, p);
      if (fb.size) log.debug({ n: fb.size }, 'prices filled from dexscreener');
    }
    return prices;
  }

  async getSolPrice(): Promise<number> {
    const p = (await this.getPrices([WSOL_MINT])).get(WSOL_MINT);
    if (!p) {
      log.warn({ fallback: this.solFallbackUsd }, 'no SOL price; using fallback');
      return this.solFallbackUsd;
    }
    return p;
  }

  async getMarketData(mints: readonly string[], opts: MarketDataOptions = {}): Promise<Map<string, TokenMarketData>> {
    const [dex, prices, infos] = await Promise.all([
      this.dex.getMarketData(mints),
      this.primaryPrices.getPrices(mints),
      this.tokens.getTokenInfo(mints).catch((err: Error) => {
        log.debug({ err: err.message }, 'token info unavailable for market data merge');
        return new Map<string, TokenInfo>();
      }),
    ]);
    const out = new Map<string, TokenMarketData>();
    for (const m of mints) {
      let d = dex.get(m);
      if (opts.allPairs && this.dex.getAggregated) {
        const agg = await this.dex.getAggregated(m);
        if (agg) d = { ...agg, priceUsd: d?.priceUsd ?? agg.priceUsd };
      }
      const p = prices.get(m);
      const s = infos.get(m)?.stats;
      if (!d && p === undefined && !s) continue;
      out.set(m, {
        mint: m,
        priceUsd: p ?? d?.priceUsd ?? s?.usdPrice ?? 0,
        volume24hUsd: max(d?.volume24hUsd, s?.volume24hUsd),
        liquidityUsd: max(d?.liquidityUsd, s?.liquidityUsd),
        fdvUsd: max(d?.fdvUsd, s?.fdvUsd),
        marketCapUsd: s?.marketCapUsd ?? d?.marketCapUsd ?? s?.fdvUsd ?? d?.fdvUsd ?? 0,
        change24hPct: d?.change24hPct ?? 0,
        pairCreatedAt: minTs(d?.pairCreatedAt, s?.firstPoolCreatedAt),
        symbol: infos.get(m)?.symbol ?? d?.symbol,
        name: infos.get(m)?.name ?? d?.name,
        logo: infos.get(m)?.logo ?? d?.logo ?? null,
        source: d && p !== undefined ? 'mixed' : d ? 'dexscreener' : 'jupiter',
      });
    }
    return out;
  }

  async getEnriched(mints: readonly string[]): Promise<Map<string, EnrichedMarketData>> {
    const [md, infos] = await Promise.all([this.getMarketData(mints), this.tokens.getTokenInfo(mints)]);
    const out = new Map<string, EnrichedMarketData>();
    for (const [m, d] of md) {
      const info = infos.get(m) ?? null;
      out.set(m, { ...d, symbol: info?.symbol ?? d.symbol, name: info?.name ?? d.name, logo: info?.logo ?? d.logo ?? null, info });
    }
    return out;
  }
}
