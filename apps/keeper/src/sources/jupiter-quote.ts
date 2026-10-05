import { VersionedTransaction } from '@solana/web3.js';
import { fetchJson } from '../util/retry.js';
import { TtlCache } from '../util/cache.js';
import { NO_LIMIT, type RateLimiter } from '../util/rate-limit.js';
import type { QuoteSource, SwapQuote } from './types.js';

/**
 * Jupiter Swap API v1 (live, verified 2026-10-03):
 *   GET  {swapBase}/quote?inputMint&outputMint&amount&slippageBps&swapMode&restrictIntermediateTokens
 *   POST {swapBase}/swap  { quoteResponse, userPublicKey, wrapAndUnwrapSol, dynamicComputeUnitLimit, prioritizationFeeLamports }
 * swapBase = https://lite-api.jup.ag/swap/v1 (free) or https://api.jup.ag/swap/v1 (x-api-key).
 * The legacy https://quote-api.jup.ag/v6 host is gone.
 */
export interface JupQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode?: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  /** v1 returns a decimal string, e.g. "0.00050331" (== 0.05%) */
  priceImpactPct: string | number;
  routePlan?: { swapInfo?: { label?: string; ammKey?: string }; percent?: number }[];
  contextSlot?: number;
  swapUsdValue?: string;
}

interface JupSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
}

export function parseQuote(q: JupQuoteResponse): SwapQuote {
  return {
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    inAmount: BigInt(q.inAmount),
    outAmount: BigInt(q.outAmount),
    otherAmountThreshold: BigInt(q.otherAmountThreshold ?? q.outAmount),
    priceImpactPct: Number(q.priceImpactPct ?? 0),
    slippageBps: q.slippageBps,
    routeLabels: (q.routePlan ?? []).map((r) => r.swapInfo?.label ?? '?'),
    raw: q,
  };
}

export type PriorityFee = number | 'auto' | { priorityLevelWithMaxLamports: { maxLamports: number; priorityLevel: 'medium' | 'high' | 'veryHigh' } };

export class JupiterQuoteSource implements QuoteSource {
  private readonly cache = new TtlCache<SwapQuote>(5_000);

  constructor(
    private readonly swapBase: string,
    private readonly headers: Record<string, string> = {},
    private readonly priorityFeeLamports: PriorityFee = 'auto',
    private readonly limiter: RateLimiter = NO_LIMIT,
  ) {}

  async quote(p: {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    slippageBps: number;
    swapMode?: 'ExactIn' | 'ExactOut';
    maxAccounts?: number;
  }): Promise<SwapQuote> {
    const params = new URLSearchParams({
      inputMint: p.inputMint,
      outputMint: p.outputMint,
      amount: p.amount.toString(),
      slippageBps: String(p.slippageBps),
      swapMode: p.swapMode ?? 'ExactIn',
      restrictIntermediateTokens: 'true',
    });
    if (p.maxAccounts) params.set('maxAccounts', String(p.maxAccounts));
    const url = `${this.swapBase}/quote?${params.toString()}`;
    return this.cache.getOrLoad(url, async () => parseQuote(await this.limiter.run(() => fetchJson<JupQuoteResponse>(url, { retries: 2, headers: this.headers }))));
  }

  async swapTx(quote: SwapQuote, user: string): Promise<VersionedTransaction> {
    const body = {
      quoteResponse: quote.raw,
      userPublicKey: user,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: this.priorityFeeLamports,
    };
    const res = await this.limiter.run(() => fetchJson<JupSwapResponse>(`${this.swapBase}/swap`, { method: 'POST', body, retries: 2, headers: this.headers }));
    return VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, 'base64'));
  }
}

/** Mid price (output per input, in UI units) from a pair of quotes in both directions. */
export function midPriceFromQuotes(
  buy: { inAmount: bigint; outAmount: bigint },
  sell: { inAmount: bigint; outAmount: bigint },
  inDecimals: number,
  outDecimals: number,
): { buyPrice: number; sellPrice: number; mid: number } {
  // buy: pay `in` of base currency to receive `out` of token  -> price = in/out
  const buyPrice = Number(buy.inAmount) / 10 ** inDecimals / (Number(buy.outAmount) / 10 ** outDecimals);
  // sell: give `in` token to receive `out` base              -> price = out/in
  const sellPrice = Number(sell.outAmount) / 10 ** inDecimals / (Number(sell.inAmount) / 10 ** outDecimals);
  return { buyPrice, sellPrice, mid: (buyPrice + sellPrice) / 2 };
}
