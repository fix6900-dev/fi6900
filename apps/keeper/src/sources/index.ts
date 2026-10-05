import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Connection } from '@solana/web3.js';
import type { Env } from '../config/env.js';
import type { UniverseSourceName } from './types.js';
import { CoinGeckoSource, createCoinGeckoSource } from './coingecko.js';
import { CompositeUniverseSource } from './universe.js';
import { DexScreenerSource } from './dexscreener.js';
import { FallbackHolderSource, GpaHolderSource, HeliusHolderSource } from './helius.js';
import { resolveJupiterEndpoints, type JupiterEndpoints } from './jupiter-endpoints.js';
import { JupiterPriceSource } from './jupiter-price.js';
import { JupiterQuoteSource } from './jupiter-quote.js';
import { JupiterTokenListSource, type TokenUniverseSource } from './jupiter-tokens.js';
import { CompositeMarketData } from './market-data.js';
import { StaticMarketSource, StaticQuoteSource } from './static.js';
import type { HolderSource, QuoteSource } from './types.js';

export * from './types.js';
export * from './jupiter-endpoints.js';
export * from './jupiter-price.js';
export * from './dexscreener.js';
export * from './jupiter-quote.js';
export * from './jupiter-tokens.js';
export * from './market-data.js';
export * from './helius.js';
export * from './static.js';
export * from './coingecko.js';
export * from './universe.js';

export interface Sources {
  market: CompositeMarketData;
  quotes: QuoteSource;
  holders: HolderSource;
  tokens: TokenUniverseSource;
  /** Resolved Jupiter endpoints (undefined for PRICE_SOURCE=static). */
  jupiter?: JupiterEndpoints;
  dex?: DexScreenerSource;
  /** CoinGecko category source (undefined for PRICE_SOURCE=static or universe.source=jupiter). */
  coingecko?: CoinGeckoSource;
}

export interface SourcesOptions {
  /** Which candidate universe to build (methodology.config `universe.source`). */
  universeSource?: UniverseSourceName;
  coingeckoCategory?: string;
}

/** CoinGecko client from env (free tier without a key; pro host when COINGECKO_PRO=true and a key is set). */
export function createCoinGeckoFromEnv(env: Env, category?: string): CoinGeckoSource {
  const dataDir = env.DB_PATH === ':memory:' ? './data' : dirname(env.DB_PATH);
  return createCoinGeckoSource({ apiKey: env.COINGECKO_API_KEY, pro: env.COINGECKO_PRO, base: env.COINGECKO_BASE, category, dataDir, minIntervalMs: env.COINGECKO_MIN_INTERVAL_MS });
}

export function createSources(env: Env, connection: Connection, opts: SourcesOptions = {}): Sources {
  const holderSources: HolderSource[] = [];
  if (env.HELIUS_API_KEY) holderSources.push(new HeliusHolderSource(env.HELIUS_API_KEY));
  holderSources.push(new GpaHolderSource(connection));
  const holders = new FallbackHolderSource(holderSources);

  if (env.PRICE_SOURCE === 'static') {
    let path = env.STATIC_PRICES_JSON;
    if (env.STATIC_PRICES_JSON_INLINE) {
      // Hosted deploys ship the file contents in an env var; materialise it next to the DB so hot-reload still works.
      const dir = env.DB_PATH === ':memory:' ? '.' : dirname(env.DB_PATH);
      mkdirSync(dir, { recursive: true });
      path = join(dir, 'static-prices.json');
      const inline = env.STATIC_PRICES_JSON_INLINE.trim();
      writeFileSync(path, inline.startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8'));
    }
    if (!path) throw new Error('PRICE_SOURCE=static requires STATIC_PRICES_JSON or STATIC_PRICES_JSON_INLINE');
    const stat = new StaticMarketSource(path);
    const market = new CompositeMarketData(stat, stat, stat, env.SOL_PRICE_FALLBACK_USD);
    return { market, quotes: new StaticQuoteSource(stat), holders, tokens: stat };
  }

  const jupiter = resolveJupiterEndpoints(env);
  const jup = new JupiterPriceSource(jupiter.apiBase, 15_000, jupiter.headers, jupiter.limiter);
  const dex = new DexScreenerSource(env.DEXSCREENER_BASE);
  const jupTokens = new JupiterTokenListSource(jupiter.tokensBase, jupiter.headers, jupiter.limiter);
  const universeSource = opts.universeSource ?? 'coingecko';
  const coingecko = universeSource === 'jupiter' ? undefined : createCoinGeckoFromEnv(env, opts.coingeckoCategory);
  const tokens = new CompositeUniverseSource(universeSource, jupTokens, coingecko ?? null);
  // Market data keeps Jupiter tokens/v2 as its metadata source; the composite only adds CoinGecko membership on top.
  const market = new CompositeMarketData(jup, dex, tokens, env.SOL_PRICE_FALLBACK_USD);
  const quotes = new JupiterQuoteSource(jupiter.swapBase, jupiter.headers, 'auto', jupiter.limiter);
  return { market, quotes, holders, tokens, jupiter, dex, coingecko };
}
