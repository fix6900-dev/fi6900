/**
 * Shared helpers for the LIVE integration suites (test/live/*.live.test.ts).
 *
 *   LIVE=1 pnpm --filter @fi6900/keeper exec vitest run test/live
 *
 * Without LIVE=1 every suite is skipped, so `pnpm test` stays offline and deterministic. The suites hit the
 * real Jupiter / DexScreener APIs and a mainnet RPC (read-only; transactions are only *simulated* with
 * sigVerify:false and never sent). Optional env: RPC_URL, HELIUS_API_KEY, JUPITER_API_KEY.
 */
import { Connection } from '@solana/web3.js';
import { config as loadDotenv } from 'dotenv';
import { resolveJupiterEndpoints } from '../../src/sources/jupiter-endpoints.js';

loadDotenv({ path: process.env.ENV_FILE ?? '.env' });

export const LIVE = process.env.LIVE === '1' || process.env.LIVE === 'true';
export const RPC_URL = process.env.RPC_URL && !/localhost|127\.0\.0\.1/.test(process.env.RPC_URL) ? process.env.RPC_URL : 'https://api.mainnet-beta.solana.com';
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

export const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
export const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
export const POPCAT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
export const TRIO = [WIF, BONK, POPCAT];

export function connection(): Connection {
  const url = HELIUS_API_KEY && /mainnet-beta\.solana\.com/.test(RPC_URL) ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` : RPC_URL;
  return new Connection(url, 'confirmed');
}

export function jupiter() {
  return resolveJupiterEndpoints({
    JUPITER_API_BASE: process.env.JUPITER_API_BASE ?? '',
    JUPITER_QUOTE_BASE: process.env.JUPITER_QUOTE_BASE ?? '',
    JUPITER_TOKEN_LIST_URL: process.env.JUPITER_TOKEN_LIST_URL ?? '',
    JUPITER_API_KEY: process.env.JUPITER_API_KEY || undefined,
    JUPITER_MIN_INTERVAL_MS: process.env.JUPITER_MIN_INTERVAL_MS ? Number(process.env.JUPITER_MIN_INTERVAL_MS) : undefined,
  });
}

export const LIVE_TIMEOUT = 120_000;
