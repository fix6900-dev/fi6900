/**
 * Offline market data for localnet / e2e runs (`PRICE_SOURCE=static`).
 *
 * Reads a JSON file mapping mint -> market record and serves it through the same interfaces the
 * Jupiter / DexScreener sources implement, so NAV, index level, holdings, methodology and rebalance
 * planning run without any network access. The file is re-read whenever its mtime changes, so a
 * running keeper picks up price perturbations immediately (used to trigger drift rebalances).
 *
 * File shape (every field except priceUsd optional):
 * {
 *   "<mint>": { "symbol": "WIF", "name": "dogwifhat", "priceUsd": 1.25, "volume24hUsd": 5e7,
 *               "marketCapUsd": 1.2e9, "liquidityUsd": 2e7, "change24hPct": 3.1, "decimals": 6,
 *               "fdvUsd": 1.2e9, "pairCreatedAt": 1700000000000, "logo": null, "tags": [] },
 *   "So11111111111111111111111111111111111111112": { "symbol": "SOL", "priceUsd": 150 }
 * }
 */
import { readFileSync, statSync } from 'node:fs';
import { PublicKey, type VersionedTransaction } from '@solana/web3.js';
import { childLogger } from '../util/logger.js';
import type { MarketDataSource, PriceSource, QuoteSource, SwapQuote, TokenInfo, TokenInfoSource, TokenMarketData } from './types.js';
import type { TokenUniverseSource } from './jupiter-tokens.js';

const log = childLogger('sources.static');
const DAY = 86_400_000;

export interface StaticPriceRecord {
  symbol?: string;
  name?: string;
  priceUsd: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  change24hPct?: number;
  decimals?: number;
  /** Unix ms of first trade; defaults to 30 days ago so the age rule passes. */
  pairCreatedAt?: number;
  logo?: string | null;
  tags?: string[];
}

export type StaticPricesFile = Record<string, StaticPriceRecord>;

export function parseStaticPrices(raw: string): StaticPricesFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('static prices file must be an object keyed by mint');
  const out: StaticPricesFile = {};
  for (const [mint, rec] of Object.entries(parsed as Record<string, unknown>)) {
    new PublicKey(mint); // validate key
    if (!rec || typeof rec !== 'object') throw new Error(`static prices: ${mint} must be an object`);
    const r = rec as StaticPriceRecord;
    if (!(typeof r.priceUsd === 'number' && Number.isFinite(r.priceUsd) && r.priceUsd >= 0)) throw new Error(`static prices: ${mint}.priceUsd must be a non-negative number`);
    out[mint] = r;
  }
  return out;
}

export class StaticMarketSource implements PriceSource, MarketDataSource, TokenInfoSource, TokenUniverseSource {
  private data: StaticPricesFile = {};
  private mtimeMs = -1;

  constructor(private readonly path: string) {
    this.reload(true);
  }

  /** Re-reads the file if it changed. Throws on first load, warns (keeping the old data) afterwards. */
  private reload(strict = false): void {
    try {
      const st = statSync(this.path);
      if (st.mtimeMs === this.mtimeMs) return;
      this.data = parseStaticPrices(readFileSync(this.path, 'utf8'));
      this.mtimeMs = st.mtimeMs;
      log.info({ path: this.path, mints: Object.keys(this.data).length }, 'static prices loaded');
    } catch (err) {
      if (strict) throw new Error(`cannot load STATIC_PRICES_JSON ${this.path}: ${(err as Error).message}`);
      log.warn({ err: (err as Error).message }, 'static prices reload failed; keeping previous data');
    }
  }

  get(mint: string): StaticPriceRecord | undefined {
    this.reload();
    return this.data[mint];
  }

  async getPrices(mints: readonly string[]): Promise<Map<string, number>> {
    this.reload();
    const out = new Map<string, number>();
    for (const m of mints) {
      const r = this.data[m];
      if (r && r.priceUsd > 0) out.set(m, r.priceUsd);
    }
    return out;
  }

  async getMarketData(mints: readonly string[]): Promise<Map<string, TokenMarketData>> {
    this.reload();
    const out = new Map<string, TokenMarketData>();
    for (const m of mints) {
      const r = this.data[m];
      if (!r) continue;
      const fdv = r.fdvUsd ?? r.marketCapUsd ?? 0;
      out.set(m, {
        mint: m,
        priceUsd: r.priceUsd,
        volume24hUsd: r.volume24hUsd ?? 0,
        liquidityUsd: r.liquidityUsd ?? 0,
        fdvUsd: fdv,
        marketCapUsd: r.marketCapUsd ?? fdv,
        change24hPct: r.change24hPct ?? 0,
        pairCreatedAt: r.pairCreatedAt ?? Date.now() - 30 * DAY,
        symbol: r.symbol,
        name: r.name,
        source: 'mock',
      });
    }
    return out;
  }

  async getTokenInfo(mints: readonly string[]): Promise<Map<string, TokenInfo>> {
    this.reload();
    const out = new Map<string, TokenInfo>();
    for (const m of mints) {
      const r = this.data[m];
      if (!r) continue;
      out.set(m, {
        mint: m,
        symbol: r.symbol ?? m.slice(0, 4),
        name: r.name ?? r.symbol ?? m,
        logo: r.logo ?? null,
        decimals: r.decimals ?? 6,
        tags: r.tags ?? [],
        dailyVolumeUsd: r.volume24hUsd ?? null,
      });
    }
    return out;
  }

  /** Candidate universe = every mint in the file, by volume. */
  async topByVolume(n: number): Promise<TokenInfo[]> {
    this.reload();
    const infos = await this.getTokenInfo(Object.keys(this.data));
    return [...infos.values()].sort((a, b) => (b.dailyVolumeUsd ?? 0) - (a.dailyVolumeUsd ?? 0)).slice(0, n);
  }
}

/**
 * Quote source for offline runs: quotes are synthesised from static prices with zero price impact
 * (enough for the methodology's liquidity screen); building a swap transaction is impossible without
 * a DEX, so `swapTx` throws and every Jupiter-dependent leg (AP arbitrage, self-fill acquisition,
 * fee recycling) fails loudly but is caught by its caller.
 */
export class StaticQuoteSource implements QuoteSource {
  constructor(private readonly market: StaticMarketSource) {}

  async quote(p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; swapMode?: 'ExactIn' | 'ExactOut' }): Promise<SwapQuote> {
    const inp = this.market.get(p.inputMint);
    const out = this.market.get(p.outputMint);
    if (!inp || !out || !(inp.priceUsd > 0) || !(out.priceUsd > 0)) throw new Error(`static quote: no price for ${p.inputMint} -> ${p.outputMint}`);
    const inDec = inp.decimals ?? 6;
    const outDec = out.decimals ?? 6;
    // out = in * pIn / pOut, adjusted for decimals
    const ratio = (inp.priceUsd / out.priceUsd) * 10 ** (outDec - inDec);
    const exactOut = p.swapMode === 'ExactOut';
    const inAmount = exactOut ? BigInt(Math.ceil(Number(p.amount) / ratio)) : p.amount;
    const outAmount = exactOut ? p.amount : BigInt(Math.floor(Number(p.amount) * ratio));
    return {
      inputMint: p.inputMint,
      outputMint: p.outputMint,
      inAmount,
      outAmount,
      otherAmountThreshold: exactOut ? inAmount : outAmount,
      priceImpactPct: 0,
      slippageBps: p.slippageBps,
      routeLabels: ['static'],
      raw: { static: true },
    };
  }

  async swapTx(_quote: SwapQuote, _user: string): Promise<VersionedTransaction> {
    throw new Error('PRICE_SOURCE=static: swaps are unavailable offline (no DEX on localnet)');
  }
}
