/**
 * Candidate-universe composition (methodology.config `universe.source`):
 *
 *   coingecko  CoinGecko "Solana Meme Coins" category ranked by market cap (default). Membership is the memecoin
 *              classification; Jupiter is still consulted for decimals, tags, audit and aggregate stats.
 *   jupiter    Jupiter tokens/v2 `verified` list ranked by 24h volume (the v1.0.0 behaviour).
 *   merged     union of both; a token nominated by both is tagged 'merged'.
 *
 * `getTokenInfo` always answers from Jupiter (any mint) and overlays the CoinGecko membership for category members.
 */
import { childLogger } from '../util/logger.js';
import type { CoinGeckoSource } from './coingecko.js';
import type { TokenUniverseSource } from './jupiter-tokens.js';
import type { TokenInfo, TokenUniverseCandidate, UniverseSourceName } from './types.js';

const log = childLogger('sources.universe');

/** Jupiter info (decimals, tags, stats) wins; CoinGecko supplies the membership and fills name/symbol/logo gaps. */
export function mergeInfo(cg: TokenUniverseCandidate, jup: TokenInfo | undefined, source: UniverseSourceName): TokenUniverseCandidate {
  if (!jup) return { ...cg, universeSource: source };
  return {
    ...jup,
    symbol: jup.symbol || cg.symbol,
    name: jup.name || cg.name,
    logo: jup.logo ?? cg.logo,
    cg: cg.cg,
    universeSource: source,
  };
}

export class CompositeUniverseSource implements TokenUniverseSource {
  constructor(
    readonly mode: UniverseSourceName,
    private readonly jupiter: TokenUniverseSource,
    private readonly coingecko: CoinGeckoSource | null,
  ) {
    if (mode !== 'jupiter' && !coingecko) throw new Error(`universe.source=${mode} requires a CoinGecko source`);
  }

  async universe(n: number): Promise<TokenUniverseCandidate[]> {
    if (this.mode === 'jupiter' || !this.coingecko) {
      const top = await this.jupiter.topByVolume(n);
      return top.map((t) => ({ ...t, universeSource: 'jupiter' as const }));
    }
    const cg = await this.coingecko.universe(n);
    const jupInfos = await this.jupiter.getTokenInfo(cg.map((c) => c.mint)).catch((err: Error) => {
      log.warn({ err: err.message }, 'jupiter token info unavailable; CoinGecko-only metadata (decimals default to 6)');
      return new Map<string, TokenInfo>();
    });
    if (this.mode === 'coingecko') return cg.map((c) => mergeInfo(c, jupInfos.get(c.mint), 'coingecko'));

    // merged: CoinGecko members first (their order), then Jupiter-only names by volume.
    const jupTop = await this.jupiter.topByVolume(n).catch((err: Error) => {
      log.warn({ err: err.message }, 'jupiter universe unavailable; merged universe is CoinGecko only');
      return [] as TokenInfo[];
    });
    const jupSet = new Set(jupTop.map((t) => t.mint));
    const out: TokenUniverseCandidate[] = cg.map((c) => mergeInfo(c, jupInfos.get(c.mint), jupSet.has(c.mint) ? 'merged' : 'coingecko'));
    const cgSet = new Set(cg.map((c) => c.mint));
    for (const t of jupTop) if (!cgSet.has(t.mint)) out.push({ ...t, universeSource: 'jupiter' });
    return out;
  }

  async topByVolume(n: number): Promise<TokenInfo[]> {
    const u = await this.universe(n);
    return [...u].sort((a, b) => (b.dailyVolumeUsd ?? 0) - (a.dailyVolumeUsd ?? 0)).slice(0, n);
  }

  async getTokenInfo(mints: readonly string[]): Promise<Map<string, TokenInfo>> {
    const jup = await this.jupiter.getTokenInfo(mints);
    if (!this.coingecko) return jup;
    const cg = await this.coingecko.getTokenInfo(mints).catch(() => new Map<string, TokenInfo>());
    const out = new Map<string, TokenInfo>(jup);
    for (const [m, c] of cg) {
      const j = out.get(m);
      out.set(m, j ? { ...j, cg: c.cg, logo: j.logo ?? c.logo } : c);
    }
    return out;
  }
}
