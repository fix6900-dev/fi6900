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

  // ---- holder governance (token-weighted, signature-based voting by $FIX6900 holders; docs/governance.md) ----
  GOV_ENABLED: bool(true),
  /** Voting window per proposal. */
  GOV_VOTING_HOURS: numEnv(48, 0.01),
  /** Quorum: for + against + abstain must reach this share (bps) of the circulating snapshot supply. */
  GOV_QUORUM_BPS: intEnv(500, 0),
  /** A holder needs this share (bps) of circulating supply to create a proposal (the admin token bypasses it). */
  GOV_PROPOSAL_THRESHOLD_BPS: intEnv(50, 0),
  GOV_MAX_OPEN_PER_WALLET: intEnv(1, 1),
  /**
   * Comma-separated whitelist of votable parameter keys (bounds live in governance/params.ts). Default: every
   * known key. Set to an empty string to allow add/remove proposals only.
   */
  GOV_ALLOWED_PARAMS: z.string().default('eligibility.minVolume24hUsd,rebalance.driftRelativeBps,FEE_BURN_PCT,flywheel.airdropShareBps'),
  /** Dev only: lets a wallet with no snapshot balance propose and vote (weight 1 unit) so a burner can exercise the flow locally. Never set in production. */
  GOV_DEV_ACCEPT_ANY_BALANCE: bool(false),

  // ---- AP arbitrage ----
  AP_ENABLED: bool(true),
  AP_THRESHOLD_BPS: intEnv(75, 1),
  AP_NOTIONAL_SOL: numEnv(2, 0.01),
  AP_MAX_NOTIONAL_SOL_PER_CYCLE: numEnv(10, 0.01),
  AP_SLIPPAGE_BPS: intEnv(100, 1),
  /** Discount leg: buy units below NAV and hold them as inventory instead of redeeming (pays on shallow pools). */
  AP_INVENTORY_BUY: bool(true),
  /** Never let an inventory buy take the keeper's SOL below this. */
  AP_MIN_SOL_RESERVE: numEnv(1.5, 0),
  KILL_SWITCH: bool(false),

  // ---- flywheel ----
  FLYWHEEL_ENABLED: bool(true),
  /** Hourly fee processing (redeem fee units -> sell basket -> buyback/burn + treasury). false pauses it entirely. */
  FEE_PROCESS_ENABLED: bool(true),
  MIN_CLAIM_SOL: numEnv(0.05, 0),
  /** pump.fun pays creator rewards in $PUMP (2026). Any PUMP in the dev wallet is swept to SOL and treated as claimed fees. */
  PUMP_REWARD_MINT: z.string().default('pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'),
  PUMP_SWEEP_ENABLED: bool(true),
  /** Minimum PUMP (UI amount) in the dev wallet before a sweep. */
  PUMP_SWEEP_MIN: numEnv(1000, 0),
  /** Max PUMP (UI) per sweep swap; large single swaps route through too many accounts to fit a transaction. */
  PUMP_SWEEP_CHUNK: numEnv(40_000, 1),
  /** Keeper working-capital ceiling (SOL). Each flywheel round recycles any excess above it into the 50/50 split. */
  KEEPER_SOL_CEILING: numEnv(1, 0),
  /** What the non-airdrop half of each round does: 'lp' = permanent Index/SOL liquidity, 'burn' = buy $FIX6900 on the market and burn it. */
  FLYWHEEL_LP_MODE: z.enum(['lp', 'burn']).default('lp'),
  /** Run one flywheel round immediately when the keeper boots (then every DIST_INTERVAL_MIN). */
  FLYWHEEL_RUN_ON_BOOT: bool(false),
  /** Smallest excess worth recycling (SOL). */
  KEEPER_RECYCLE_MIN_SOL: numEnv(0.05, 0),
  AIRDROP_BATCH_SIZE: intEnv(6, 1),
  AIRDROP_DENYLIST: z.string().default(''),
  ATA_RENT_LAMPORTS: intEnv(2_039_280),
  FEE_BURN_PCT: intEnv(75, 0),
  /**
   * Raw index units (6 dp) held by the fee_recipient that are NOT fees (e.g. the bootstrap/seed position
   * minted to the keeper by `init-fund`). Fee processing only redeems balance - reserved.
   */
  FEE_RESERVED_UNITS: z.string().regex(/^\d+$/, 'must be a non-negative integer (raw units)').default('0'),
  // Metaplex metadata of the index mint (`keeper set-metadata`; flags override these)
  TOKEN_NAME: z.string().default('FIX6900 Index'),
  TOKEN_SYMBOL: z.string().default('FIXIDX'),
  TOKEN_URI: z.string().default('https://fix6900index.com/token/fix6900-index.json'),
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
