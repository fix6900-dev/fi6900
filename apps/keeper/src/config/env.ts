import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** `ENV_FILE=.env.localnet` selects an alternate dotenv file (default `.env`). */
loadDotenv({ path: process.env.ENV_FILE ?? '.env' });

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(def ? 'true' : 'false')
    .transform((v) => (typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(v)));

const intEnv = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const numEnv = (def: number, min = 0) => z.coerce.number().min(min).default(def);

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  /** Serve realistic fake data; no RPC / keypairs needed. */
  MOCK_MODE: bool(false),
  /** Simulate every state-changing action; log and record with sig 'dry-run'. */
  DRY_RUN: bool(true),

  // ---- chain ----
  RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  RPC_WS_URL: optionalString,
  HELIUS_API_KEY: optionalString,
  COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
  /** Path to a JSON keypair file, an inline JSON byte array, a base58 secret, or (via *_JSON) base64 of any of those. */
  KEEPER_KEYPAIR: optionalString,
  /** Alternative to KEEPER_KEYPAIR for hosted deploys: the keypair contents (JSON array, base58, or base64 of either). */
  KEEPER_KEYPAIR_JSON: optionalString,
  DEV_WALLET: optionalString,
  DEV_WALLET_KEYPAIR_JSON: optionalString,
  TREASURY_WALLET: optionalString,
  INDEX_MINT: optionalString,
  COIN_MINT: optionalString,
  LOOKUP_TABLE: optionalString,
  METEORA_POOL: optionalString,
  PRIORITY_FEE_MICROLAMPORTS: intEnv(50_000),

  // ---- external APIs ----
  /**
   * `live` = Jupiter + DexScreener (default). `static` = prices/market data/token metadata are read
   * from the JSON file at STATIC_PRICES_JSON (hot-reloaded on change); swaps are unavailable, so the
   * AP loop and Jupiter-dependent flywheel legs degrade gracefully. Used for localnet e2e.
   */
  PRICE_SOURCE: z.enum(['live', 'static']).default('live'),
  STATIC_PRICES_JSON: optionalString,
  /** Inline contents of the static prices file (hosted deploys without a filesystem); written to DB_PATH's directory on boot. */
  STATIC_PRICES_JSON_INLINE: optionalString,
  JUPITER_API_BASE: z.string().url().default('https://api.jup.ag'),
  JUPITER_QUOTE_BASE: z.string().url().default('https://quote-api.jup.ag/v6'),
  JUPITER_TOKEN_LIST_URL: z.string().url().default('https://tokens.jup.ag/tokens?tags=verified'),
  DEXSCREENER_BASE: z.string().url().default('https://api.dexscreener.com'),
  /** Jupiter portal key (https://portal.jup.ag). When set every Jupiter call goes to api.jup.ag with `x-api-key`; otherwise the free lite-api.jup.ag tier is used. */
  JUPITER_API_KEY: optionalString,
  /** Minimum ms between Jupiter requests (client-side limiter). Default 2000 without a key (~30 req/min; 55/min still gets 429s), 100 with one. */
  JUPITER_MIN_INTERVAL_MS: z.coerce.number().int().min(0).optional(),
  SOL_PRICE_FALLBACK_USD: numEnv(150),
  /**
   * CoinGecko (candidate universe = "Solana Meme Coins" category). Optional demo key from
   * https://www.coingecko.com/en/developers/dashboard sent as `x-cg-demo-api-key`; free tier ~30 req/min, 10k calls/month.
   * COINGECKO_PRO=true switches to https://pro-api.coingecko.com with `x-cg-pro-api-key` (paid plans).
   */
  COINGECKO_API_KEY: optionalString,
  COINGECKO_PRO: bool(false),
  /** Override base URL (proxies). Default depends on COINGECKO_PRO. */
  COINGECKO_BASE: optionalString,
  /** Minimum ms between CoinGecko requests. Default 2100 without a key (~28 req/min), 150 with one. */
  COINGECKO_MIN_INTERVAL_MS: z.coerce.number().int().min(0).optional(),
  /** Candidate universe: coingecko (default) | jupiter (verified list by volume) | merged (union). */
  UNIVERSE_SOURCE: z.enum(['coingecko', 'jupiter', 'merged']).optional(),
  /** CoinGecko category slug for the universe (default solana-meme-coins). */
  COINGECKO_CATEGORY: optionalString,
  /** Upper bound on CoinGecko rows considered (default 150). */
  UNIVERSE_MAX_CANDIDATES: z.coerce.number().int().min(1).optional(),

  // ---- storage / api ----
  DB_PATH: z.string().default('./data/keeper.db'),
  PORT: intEnv(8787, 1),
  CORS_ORIGIN: z.string().default('*'),

  // ---- cadence ----
  NAV_SNAPSHOT_SEC: intEnv(60, 5),
  METHODOLOGY_CRON: z.string().default('5 0 * * *'),
  /** Drift check cadence; it reads the cached NAV snapshot so a check is cheap. */
  REBALANCE_CHECK_SEC: intEnv(60, 5),
  /** How often due (eta passed) timelocked actions are executed. */
  ACTION_EXECUTE_SEC: intEnv(60, 5),
  AUCTION_MONITOR_SEC: intEnv(15, 2),
  AP_CHECK_SEC: intEnv(30, 5),
  DIST_INTERVAL_MIN: intEnv(15, 1),
  FEE_PROCESS_CRON: z.string().default('0 * * * *'),

  // ---- governance ----
  /** Bearer token for POST /v1/admin/*; admin endpoints are disabled when unset. */
  ADMIN_TOKEN: optionalString,
  /** manual = methodology stores proposals for the index committee; auto = queues timelocked actions itself. */
  RECONSTITUTION_MODE: z.enum(['manual', 'auto']).default('manual'),
  /** A rejected proposal is not re-proposed for this many days. */
  RECON_REJECT_COOLDOWN_DAYS: intEnv(90, 0),
  /** Push on-chain reference prices after every NAV snapshot (rebalancer role). */
  REF_PRICE_UPDATES: bool(true),
  /** Skip ref-price updates smaller than this (bps) to avoid spamming transactions. */
  REF_PRICE_MIN_CHANGE_BPS: intEnv(25, 0),

  // ---- AP arbitrage ----
  AP_ENABLED: bool(true),
  AP_THRESHOLD_BPS: intEnv(75, 1),
  AP_NOTIONAL_SOL: numEnv(2, 0.01),
  AP_MAX_NOTIONAL_SOL_PER_CYCLE: numEnv(10, 0.01),
  AP_SLIPPAGE_BPS: intEnv(100, 1),
  KILL_SWITCH: bool(false),

  // ---- flywheel ----
  FLYWHEEL_ENABLED: bool(true),
  MIN_CLAIM_SOL: numEnv(0.05, 0),
  AIRDROP_BATCH_SIZE: intEnv(18, 1),
  AIRDROP_DENYLIST: z.string().default(''),
  ATA_RENT_LAMPORTS: intEnv(2_039_280),
  FEE_BURN_PCT: intEnv(75, 0),
  /**
   * Raw index units (6 dp) held by the fee_recipient that are NOT fees (e.g. the bootstrap/seed position
   * minted to the keeper by `init-fund`). Fee processing only redeems balance - reserved.
   */
  FEE_RESERVED_UNITS: z.string().regex(/^\d+$/, 'must be a non-negative integer (raw units)').default('0'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`invalid environment:\n  ${issues}`);
  }
  // Hosted deploys pass keypair *contents* via *_KEYPAIR_JSON; loadKeypair() accepts a path, inline JSON, base58 or base64.
  const data = parsed.data;
  if (!data.KEEPER_KEYPAIR && data.KEEPER_KEYPAIR_JSON) data.KEEPER_KEYPAIR = data.KEEPER_KEYPAIR_JSON;
  if (!data.DEV_WALLET && data.DEV_WALLET_KEYPAIR_JSON) data.DEV_WALLET = data.DEV_WALLET_KEYPAIR_JSON;
  if (Object.keys(overrides).length === 0) cached = data;
  return data;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** Live mode requires keys that mock mode does not. */
export function assertLiveEnv(env: Env): asserts env is Env & { KEEPER_KEYPAIR: string; INDEX_MINT: string } {
  const missing: string[] = [];
  if (!env.KEEPER_KEYPAIR) missing.push('KEEPER_KEYPAIR');
  if (!env.INDEX_MINT) missing.push('INDEX_MINT');
  if (missing.length) throw new Error(`live mode requires: ${missing.join(', ')} (or set MOCK_MODE=true)`);
}
