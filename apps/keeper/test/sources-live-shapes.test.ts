/**
 * Offline tests for the parsers/adapters that were (re)written against the live API shapes captured on
 * 2026-10-03 (see test/live/*.live.test.ts for the online versions).
 */
import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY_CONFIG } from '../src/config/methodology.config.js';
import { evaluateEligibility } from '../src/methodology/eligibility.js';
import { flagsFor, renderLaunchReport, type ReportCandidate } from '../src/methodology/launch-report.js';
import { runMethodology } from '../src/methodology/run.js';
import { decodeSlicedTokenAccounts } from '../src/sources/helius.js';
import { JUPITER_LITE_BASE, JUPITER_PRO_BASE, resolveJupiterEndpoints } from '../src/sources/jupiter-endpoints.js';
import { parseJupiterPriceResponse } from '../src/sources/jupiter-price.js';
import { parseQuote } from '../src/sources/jupiter-quote.js';
import { parseTokenList, toInfoV2, type JupTokenV2 } from '../src/sources/jupiter-tokens.js';
import { CompositeMarketData } from '../src/sources/market-data.js';
import type { TokenInfo, TokenMarketData } from '../src/sources/types.js';
import { RateLimiter } from '../src/util/rate-limit.js';

const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

describe('jupiter endpoints', () => {
  it('remaps the retired defaults to lite-api without a key', () => {
    const ep = resolveJupiterEndpoints({
      JUPITER_API_BASE: 'https://api.jup.ag',
      JUPITER_QUOTE_BASE: 'https://quote-api.jup.ag/v6',
      JUPITER_TOKEN_LIST_URL: 'https://tokens.jup.ag/tokens?tags=verified',
      JUPITER_API_KEY: undefined,
      JUPITER_MIN_INTERVAL_MS: undefined,
    });
    expect(ep.apiBase).toBe(JUPITER_LITE_BASE);
    expect(ep.swapBase).toBe(`${JUPITER_LITE_BASE}/swap/v1`);
    expect(ep.tokensBase).toBe(`${JUPITER_LITE_BASE}/tokens/v2`);
    expect(ep.headers).toEqual({});
    expect(ep.limiter.intervalMs).toBe(2_000);
  });
  it('uses api.jup.ag + x-api-key when a key is set', () => {
    const ep = resolveJupiterEndpoints({ JUPITER_API_BASE: 'https://lite-api.jup.ag', JUPITER_QUOTE_BASE: '', JUPITER_TOKEN_LIST_URL: '', JUPITER_API_KEY: 'k', JUPITER_MIN_INTERVAL_MS: 0 });
    expect(ep.apiBase).toBe(JUPITER_PRO_BASE);
    expect(ep.swapBase).toBe(`${JUPITER_PRO_BASE}/swap/v1`);
    expect(ep.headers).toEqual({ 'x-api-key': 'k' });
    expect(ep.limiter.intervalMs).toBe(0);
  });
  it('keeps an explicit proxy', () => {
    const ep = resolveJupiterEndpoints({ JUPITER_API_BASE: 'https://proxy.example', JUPITER_QUOTE_BASE: 'https://proxy.example/swap/v1', JUPITER_TOKEN_LIST_URL: 'https://proxy.example/tokens/v2/tag?query=verified', JUPITER_API_KEY: undefined, JUPITER_MIN_INTERVAL_MS: 5 });
    expect(ep.swapBase).toBe('https://proxy.example/swap/v1');
    expect(ep.tokensBase).toBe('https://proxy.example/tokens/v2');
    expect(ep.limiter.intervalMs).toBe(5);
  });
});

describe('rate limiter', () => {
  it('spaces requests by the interval and serves them in order', async () => {
    const l = new RateLimiter(20);
    const t0 = Date.now();
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((i) => l.run(async () => order.push(i))));
    expect(order).toEqual([1, 2, 3]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
});

describe('live shapes', () => {
  it('price v3 shape', () => {
    const p = parseJupiterPriceResponse({ [WIF]: { usdPrice: 0.254, decimals: 6, liquidity: 7.3e6, priceChange24h: -0.4, blockId: 1 }, X: null } as never);
    expect(p.get(WIF)).toBe(0.254);
    expect(p.size).toBe(1);
  });
  it('swap/v1 quote shape (priceImpactPct as a decimal string)', () => {
    const q = parseQuote({ inputMint: 'A', outputMint: 'B', inAmount: '100000000', outAmount: '314228048307', otherAmountThreshold: '312656908066', swapMode: 'ExactIn', slippageBps: 50, priceImpactPct: '0.0005033126463067982814709382', routePlan: [{ swapInfo: { label: 'Whirlpool', ammKey: 'x' }, percent: 100 }] });
    expect(q.priceImpactPct).toBeCloseTo(0.000503, 6);
    expect(q.routeLabels).toEqual(['Whirlpool']);
  });
  it('tokens/v2 record -> TokenInfo with stats', () => {
    const t: JupTokenV2 = {
      id: WIF,
      name: 'dogwifhat',
      symbol: '$WIF',
      icon: 'https://x/wif.png',
      decimals: 6,
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      holderCount: 264696,
      fdv: 253649495.7,
      mcap: 253649495.7,
      usdPrice: 0.2539,
      liquidity: 7296944.3,
      stats24h: { buyVolume: 523787.3, sellVolume: 513327.5 },
      firstPool: { id: 'p', createdAt: '2023-12-19T18:33:23Z' },
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 31.4, devBalancePercentage: 0 },
      organicScore: 79.3,
      organicScoreLabel: 'medium',
      isVerified: true,
      tags: ['community', 'verified', 'meme'],
    };
    const info = toInfoV2(t);
    expect(info.dailyVolumeUsd).toBeCloseTo(1_037_114.8, 0);
    expect(info.stats?.firstPoolCreatedAt).toBe(Date.parse('2023-12-19T18:33:23Z'));
    expect(info.stats?.audit?.mintAuthorityDisabled).toBe(true);
    expect(info.logo).toBe('https://x/wif.png');
    expect(parseTokenList([t, { address: 'L', symbol: 'L', name: 'L', decimals: 9, daily_volume: 5 }])[1]?.dailyVolumeUsd).toBe(5);
  });
  it('gPA dataSlice decode (owner + amount)', () => {
    const owner = new PublicKey('wifq4CRwpXCK8NYtKNsQAYoDethT1aR7R1DaKCLFgAd');
    const data = Buffer.concat([owner.toBuffer(), Buffer.from([0x40, 0x4b, 0x4c, 0, 0, 0, 0, 0])]);
    const out = decodeSlicedTokenAccounts([{ pubkey: PublicKey.default, account: { data } }, { pubkey: PublicKey.default, account: { data: Buffer.concat([owner.toBuffer(), Buffer.alloc(8)]) } }]);
    expect(out).toEqual([{ owner: owner.toBase58(), tokenAccount: PublicKey.default.toBase58(), amount: 5_000_000n }]);
  });
});

describe('composite merge', () => {
  const md = (o: Partial<TokenMarketData>): TokenMarketData => ({ mint: WIF, priceUsd: 0.25, volume24hUsd: 280_000, liquidityUsd: 180_000, fdvUsd: 2.5e8, marketCapUsd: 2.5e8, change24hPct: -0.3, pairCreatedAt: 1_716_065_147_000, symbol: '$WIF', source: 'dexscreener', ...o });
  const info: TokenInfo = { mint: WIF, symbol: '$WIF', name: 'dogwifhat', logo: 'i', decimals: 6, tags: ['meme'], dailyVolumeUsd: 1_037_000, stats: { usdPrice: 0.254, marketCapUsd: 2.53e8, fdvUsd: 2.53e8, liquidityUsd: 7.3e6, volume24hUsd: 1_037_000, holderCount: 1, firstPoolCreatedAt: Date.parse('2023-12-19T18:33:23Z'), organicScore: 79, organicScoreLabel: 'medium', isVerified: true, audit: null, tokenProgram: null } };
  it('takes the larger volume/liquidity, the earliest age and the Jupiter price', async () => {
    const c = new CompositeMarketData(
      { getPrices: async () => new Map([[WIF, 0.254]]) },
      { getMarketData: async () => new Map([[WIF, md({})]]), getPrices: async () => new Map(), getAggregated: async () => md({ volume24hUsd: 886_000, liquidityUsd: 7.23e6, pairCreatedAt: 1_700_510_070_000 }) },
      { getTokenInfo: async () => new Map([[WIF, info]]) },
      150,
    );
    const plain = (await c.getMarketData([WIF])).get(WIF)!;
    expect(plain.volume24hUsd).toBe(1_037_000);
    expect(plain.liquidityUsd).toBe(7.3e6);
    expect(plain.pairCreatedAt).toBe(Date.parse('2023-12-19T18:33:23Z'));
    expect(plain.priceUsd).toBe(0.254);
    expect(plain.logo).toBe('i');
    const all = (await c.getMarketData([WIF], { allPairs: true })).get(WIF)!;
    expect(all.pairCreatedAt).toBe(1_700_510_070_000);
    expect(all.volume24hUsd).toBe(1_037_000);
  });
});

describe('excluded tags + launch report', () => {
  const cand = (o: Partial<ReportCandidate>): ReportCandidate => ({
    mint: WIF,
    symbol: 'WIF',
    name: 'dogwifhat',
    decimals: 6,
    priceUsd: 0.25,
    fdvUsd: 2.5e8,
    marketCapUsd: 2.5e8,
    volume24hUsd: 1e6,
    avgVolume7dUsd: null,
    firstTradeAt: Date.now() - 400 * 86_400_000,
    mintAuthority: null,
    freezeAuthority: null,
    sellImpactBps: 30,
    tags: ['meme', 'verified'],
    liquidityUsd: 7e6,
    holderCount: 264_000,
    topHoldersPct: 31,
    organicScore: 79,
    tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    stats: null,
    ...o,
  });
  it('Jupiter taxonomy tags (stocks, rwa, major, stable) make a token ineligible', () => {
    const now = Date.now();
    expect(evaluateEligibility(cand({ tags: ['stocks', 'xstocks', 'verified'] }), DEFAULT_METHODOLOGY_CONFIG, now).reasons).toContain('excluded_tag');
    expect(evaluateEligibility(cand({ tags: ['major', 'verified'] }), DEFAULT_METHODOLOGY_CONFIG, now).reasons).toContain('excluded_tag');
    expect(evaluateEligibility(cand({ tags: ['stable'] }), DEFAULT_METHODOLOGY_CONFIG, now).reasons).toContain('excluded_tag');
    expect(evaluateEligibility(cand({}), DEFAULT_METHODOLOGY_CONFIG, now).eligible).toBe(true);
  });
  it('flags and renders', () => {
    expect(flagsFor(cand({ tags: ['defi', 'verified'], freezeAuthority: 'F'.repeat(32), topHoldersPct: 70 })).join(';')).toMatch(/freeze authority present.*not tagged meme.*tagged defi.*top holders 70%/);
    expect(flagsFor(cand({ tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }))).toEqual(['Token-2022 mint (check transfer-fee / hook extensions)']);
    const other = cand({ mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'Bonk', marketCapUsd: 3.3e8, fdvUsd: 3.4e8 });
    const bad = cand({ mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: 'POPCAT', freezeAuthority: 'F'.repeat(32) });
    const cands = [cand({}), other, bad];
    const run = runMethodology(cands, new Set(), DEFAULT_METHODOLOGY_CONFIG);
    expect(run.selection.selected.map((s) => s.symbol)).toEqual(['Bonk', 'WIF']);
    const md = renderLaunchReport({
      generatedAt: new Date().toISOString(),
      rpc: 'https://mainnet.helius-rpc.com/?api-key=SECRET',
      jupiterBase: 'https://lite-api.jup.ag',
      solPriceUsd: 120,
      run,
      candidates: cands,
      alternates: 20,
      seeds: [{ seedSol: 10, perAssetSol: 5, impactBps: new Map([[WIF, 12], [other.mint, null]]) }],
    });
    expect(md).not.toContain('SECRET');
    expect(md).toContain('| 1 | Bonk');
    expect(md).toContain('5000 bps each');
    expect(md).toContain('freeze_authority');
    expect(md).toContain('| WIF | 0.12% |');
    expect(md).toContain('| Bonk | — |');
  });
});
