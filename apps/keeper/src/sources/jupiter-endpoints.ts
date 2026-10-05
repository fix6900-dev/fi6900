/**
 * Jupiter API surface as verified live on 2026-10-03 (see test/live/jupiter.live.test.ts):
 *
 *   Price      GET  {base}/price/v3?ids=<=50 mints>        -> { [mint]: { usdPrice, decimals, liquidity, priceChange24h, blockId } }
 *   Quote      GET  {base}/swap/v1/quote?...               -> quote response (priceImpactPct is a string)
 *   Swap       POST {base}/swap/v1/swap                    -> { swapTransaction (base64 v0) }
 *   Tokens     GET  {base}/tokens/v2/tag?query=verified    -> TokenV2[] (~3.9k, with stats24h, audit, firstPool, mcap, fdv, liquidity)
 *              GET  {base}/tokens/v2/search?query=m1,m2,…  -> TokenV2[] (<=100 mints per call)
 *              GET  {base}/tokens/v2/toptraded/24h?limit=  -> TokenV2[]
 *
 *   base = https://lite-api.jup.ag   free tier, no key; nominally 60 req/min per IP but sustained 55/min still 429s, 30/min (2 s spacing) is stable
 *   base = https://api.jup.ag        requires `x-api-key` from https://portal.jup.ag (worked unauthenticated
 *                                    on 2026-10-03 with a 5-request burst window, but Jupiter documents it as key-only)
 *
 *   DEAD (connection refused on 2026-10-03): https://quote-api.jup.ag/v6, https://tokens.jup.ag/*, .../price/v2 (404).
 *
 * Env keeps the historical variable names. Legacy defaults that point at dead hosts are remapped here so a
 * stale .env keeps working; set JUPITER_API_KEY to switch every call to api.jup.ag with the key header.
 */
import type { Env } from '../config/env.js';
import { childLogger } from '../util/logger.js';
import { RateLimiter } from '../util/rate-limit.js';

const log = childLogger('sources.jupiter');

export const JUPITER_LITE_BASE = 'https://lite-api.jup.ag';
export const JUPITER_PRO_BASE = 'https://api.jup.ag';

/** Hosts/paths that no longer exist; any configured value matching one is treated as "unset". */
const DEAD_PATTERNS = [/quote-api\.jup\.ag/i, /tokens\.jup\.ag/i, /\/price\/v2/i, /\/v6\/?$/i];

export interface JupiterEndpoints {
  /** Host prefix for price + tokens, e.g. https://lite-api.jup.ag */
  apiBase: string;
  /** Prefix for quote/swap, e.g. https://lite-api.jup.ag/swap/v1 */
  swapBase: string;
  /** Prefix for tokens v2, e.g. https://lite-api.jup.ag/tokens/v2 */
  tokensBase: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  limiter: RateLimiter;
}

function isDead(url: string | undefined): boolean {
  return !url || DEAD_PATTERNS.some((p) => p.test(url));
}

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

/** Resolve the effective endpoints from env (pure apart from the warning log). */
export function resolveJupiterEndpoints(env: Pick<Env, 'JUPITER_API_BASE' | 'JUPITER_QUOTE_BASE' | 'JUPITER_TOKEN_LIST_URL' | 'JUPITER_API_KEY' | 'JUPITER_MIN_INTERVAL_MS'>): JupiterEndpoints {
  const apiKey = env.JUPITER_API_KEY;
  const defaultBase = apiKey ? JUPITER_PRO_BASE : JUPITER_LITE_BASE;

  let apiBase = trimSlash(env.JUPITER_API_BASE || defaultBase);
  // The historical default `https://api.jup.ag` without a key is remapped to the free tier so the
  // keeper does not depend on Jupiter tolerating unauthenticated calls on the paid host.
  if (!apiKey && apiBase === JUPITER_PRO_BASE) apiBase = JUPITER_LITE_BASE;
  if (apiKey && apiBase === JUPITER_LITE_BASE) apiBase = JUPITER_PRO_BASE;

  let swapBase: string;
  if (isDead(env.JUPITER_QUOTE_BASE)) {
    if (env.JUPITER_QUOTE_BASE) log.warn({ configured: env.JUPITER_QUOTE_BASE }, 'JUPITER_QUOTE_BASE points at a retired endpoint; using swap/v1');
    swapBase = `${apiBase}/swap/v1`;
  } else {
    swapBase = trimSlash(env.JUPITER_QUOTE_BASE as string);
    if (!/\/swap\/v\d+$/.test(swapBase)) swapBase = `${swapBase}/swap/v1`;
  }

  let tokensBase: string;
  if (isDead(env.JUPITER_TOKEN_LIST_URL)) {
    if (env.JUPITER_TOKEN_LIST_URL) log.warn({ configured: env.JUPITER_TOKEN_LIST_URL }, 'JUPITER_TOKEN_LIST_URL points at a retired endpoint; using tokens/v2');
    tokensBase = `${apiBase}/tokens/v2`;
  } else {
    tokensBase = trimSlash(env.JUPITER_TOKEN_LIST_URL as string).replace(/\/(tag|search|toptraded).*$/, '');
    if (!/\/tokens\/v2$/.test(tokensBase)) tokensBase = `${apiBase}/tokens/v2`;
  }

  const interval = env.JUPITER_MIN_INTERVAL_MS ?? (apiKey ? 100 : 2_000);
  return {
    apiBase,
    swapBase,
    tokensBase,
    apiKey,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
    limiter: new RateLimiter(interval),
  };
}
