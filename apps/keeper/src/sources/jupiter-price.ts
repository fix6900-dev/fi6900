import { TtlCache } from '../util/cache.js';
import { fetchJson } from '../util/retry.js';
import { childLogger } from '../util/logger.js';
import { NO_LIMIT, type RateLimiter } from '../util/rate-limit.js';
import type { PriceSource } from './types.js';

const log = childLogger('sources.jupiter-price');

/**
 * Price API v3 (live, verified 2026-10-03): GET {base}/price/v3?ids=a,b,c  (max 50 ids per call; extra ids are
 * silently dropped) -> { [mint]: { usdPrice, decimals, liquidity, priceChange24h, blockId } | null }.
 * The retired v2 shape ({ data: { [mint]: { price } } }) is still parsed for compatibility with recorded fixtures.
 */
export const JUPITER_PRICE_IDS_PER_CALL = 50;

export interface PriceV3Entry {
  usdPrice?: number;
  decimals?: number;
  liquidity?: number;
  priceChange24h?: number;
  blockId?: number;
}

interface PriceResponse {
  data?: Record<string, { id: string; price: string | number | null } | null>;
  [mint: string]: unknown;
}

export function parseJupiterPriceResponse(body: PriceResponse): Map<string, number> {
  const out = new Map<string, number>();
  const data = body.data && typeof body.data === 'object' ? body.data : (body as Record<string, unknown>);
  for (const [mint, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;
    const rec = v as { price?: string | number | null; usdPrice?: number };
    const p = rec.usdPrice ?? (rec.price === null || rec.price === undefined ? undefined : Number(rec.price));
    if (p !== undefined && Number.isFinite(p) && p > 0) out.set(mint, p);
  }
  return out;
}

export class JupiterPriceSource implements PriceSource {
  private readonly cache: TtlCache<number>;

  constructor(
    private readonly apiBase: string,
    ttlMs = 15_000,
    private readonly headers: Record<string, string> = {},
    private readonly limiter: RateLimiter = NO_LIMIT,
  ) {
    this.cache = new TtlCache<number>(ttlMs);
  }

  async getPrices(mints: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const missing: string[] = [];
    for (const m of mints) {
      const hit = this.cache.get(m);
      if (hit !== undefined) out.set(m, hit);
      else missing.push(m);
    }
    for (let i = 0; i < missing.length; i += JUPITER_PRICE_IDS_PER_CALL) {
      const chunk = missing.slice(i, i + JUPITER_PRICE_IDS_PER_CALL);
      const url = `${this.apiBase}/price/v3?ids=${chunk.join(',')}`;
      try {
        const body = await this.limiter.run(() => fetchJson<PriceResponse>(url, { retries: 2, headers: this.headers }));
        for (const [mint, p] of parseJupiterPriceResponse(body)) {
          this.cache.set(mint, p);
          out.set(mint, p);
        }
      } catch (err) {
        log.warn({ err: (err as Error).message, n: chunk.length }, 'jupiter price fetch failed');
      }
    }
    return out;
  }
}
