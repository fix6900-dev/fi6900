# FI6900 Keeper — Operations

The keeper (`apps/keeper`, package `@fi6900/keeper`) is the off-chain service that prices the fund, runs the index methodology, maintains on-chain reference prices, rebalances through Dutch auctions, executes timelocked admin actions, performs AP arbitrage, operates the $FIX6900 flywheel and serves the public API consumed by the website.

## 1. Modes

| Mode | Env | Chain access | Sends transactions | Use |
|---|---|---|---|---|
| **Mock** | `MOCK_MODE=true` | none | no | frontend development; serves realistic generated data on every endpoint + SSE |
| **Dry run** | `MOCK_MODE=false`, `DRY_RUN=true` (default) | read-only RPC + Jupiter/DexScreener | **no** — every action is simulated and recorded with `sig = "dry-run"` | staging against mainnet state |
| **Live** | `DRY_RUN=false` | full | yes | production |

## 2. Running

```bash
pnpm install                         # from repo root (pnpm workspaces)
cp apps/keeper/.env.example apps/keeper/.env

pnpm --filter @fi6900/keeper dev      # tsx watch, honours MOCK_MODE
pnpm --filter @fi6900/keeper build    # tsc -> dist/ (+ schema.sql copied)
pnpm --filter @fi6900/keeper start    # node dist/index.js
pnpm --filter @fi6900/keeper test     # vitest

# CLI (tsx)
pnpm --filter @fi6900/keeper keeper methodology --dry
pnpm --filter @fi6900/keeper keeper rebalance --dry [--force]
pnpm --filter @fi6900/keeper keeper airdrop --dry
pnpm --filter @fi6900/keeper keeper fees --dry
pnpm --filter @fi6900/keeper keeper snapshot-holders --mint <COIN_MINT>
pnpm --filter @fi6900/keeper keeper jobs            # prints the schedule
pnpm --filter @fi6900/keeper keeper init-fund --sol 25 [--dry] [--timelock 0]   # launch only, see launch-runbook.md

# governance / index committee
pnpm --filter @fi6900/keeper keeper governance                      # timelock, pending actions, authorities, upgrade authority
pnpm --filter @fi6900/keeper keeper proposals [--status proposed]   # reconstitution proposals
pnpm --filter @fi6900/keeper keeper approve <mint> [--weight bps] [--immediate]
pnpm --filter @fi6900/keeper keeper reject <mint> [--note "..."]
pnpm --filter @fi6900/keeper keeper add-asset <mint> [--weight bps] [--immediate] [--force]
pnpm --filter @fi6900/keeper keeper remove-asset <mint> [--immediate]
pnpm --filter @fi6900/keeper keeper queue-approved [--dry]          # queue every approved proposal now
pnpm --filter @fi6900/keeper keeper execute-actions [--dry]         # execute due timelocked actions now
pnpm --filter @fi6900/keeper keeper set-ref-prices [--dry]          # push reference prices now
```

API: `http://localhost:8787` (`/health`, `/v1/...`, `/v1/stream` SSE). Shapes are in `ARCHITECTURE.md` §5 and `src/api/types.ts`.

## 3. Environment variables

All variables are validated with zod on boot (`src/config/env.ts`); invalid values fail fast with a message. See `.env.example` for the full annotated list. Key ones:

| Variable | Default | Notes |
|---|---|---|
| `MOCK_MODE` | `false` | serve generated data |
| `DRY_RUN` | `true` | simulate instead of sending |
| `RPC_URL` / `HELIUS_API_KEY` | public mainnet | with a Helius key the RPC switches to Helius and holder snapshots use DAS `getTokenAccounts` (falls back to `getProgramAccounts`). **A Helius key is required for production**: `api.mainnet-beta.solana.com` rate-limits `getTokenLargestAccounts`, caps data per IP (a gPA over a 1M-holder mint returned ~590 MB and then 413 "data allowance") and the keeper sends transactions through it; `solana-rpc.publicnode.com` refuses `getProgramAccounts` entirely |
| `KEEPER_KEYPAIR` | — | JSON keypair file. Acts as rebalancer (auctions + ref prices), AP, and `fee_recipient` |
| `DEV_WALLET` | — | pump.fun coin creator; signs flywheel claims, LP adds, creations and airdrops |
| `TREASURY_WALLET` | — | receives 25% of fee proceeds (SOL) |
| `INDEX_MINT`, `COIN_MINT`, `LOOKUP_TABLE`, `METEORA_POOL` | — | addresses printed/created during launch (`LOOKUP_TABLE` may be comma-separated for funds with several tables) |
| `JUPITER_API_KEY` | — | key from https://portal.jup.ag. When set, every Jupiter call uses `https://api.jup.ag` with `x-api-key`; when unset the free tier `https://lite-api.jup.ag` (~60 req/min per IP) is used. Not required for launch, recommended for production (the methodology run issues ~150-300 Jupiter calls) |
| `JUPITER_MIN_INTERVAL_MS` | 2000 / 100 | client-side spacing between Jupiter calls (free tier / keyed) |
| `COINGECKO_API_KEY` | — | optional. The candidate universe is CoinGecko's `solana-meme-coins` category (`src/sources/coingecko.ts`). Without a key the public `https://api.coingecko.com/api/v3` tier is used (no key needed; ~30 req/min, 10k calls/month, client-side spacing 2100 ms); a free *Demo* key from https://www.coingecko.com/en/developers/dashboard is sent as `x-cg-demo-api-key` (same host, 30 req/min, higher monthly quota, 150 ms spacing). A methodology run makes 1-2 `coins/markets` calls plus one `coins/list` per 24 h (3.9 MB, cached on disk next to the DB) and one `coins/{id}` per member whose mint is missing from the list (0 on 2026-10-03). 429s are retried after `Retry-After` |
| `COINGECKO_PRO` / `COINGECKO_BASE` / `COINGECKO_MIN_INTERVAL_MS` | `false` / — / 2100 or 150 | `COINGECKO_PRO=true` with a paid key switches to `https://pro-api.coingecko.com/api/v3` and `x-cg-pro-api-key`; `COINGECKO_BASE` overrides the host (proxies); the interval overrides the client-side limiter |
| `UNIVERSE_SOURCE` / `COINGECKO_CATEGORY` / `UNIVERSE_MAX_CANDIDATES` | `coingecko` / `solana-meme-coins` / `150` | methodology `universe.*` overrides: `jupiter` = Jupiter verified list by volume (v1.0.0 behaviour, no CoinGecko calls), `merged` = union. Changing these is a methodology version change (docs/methodology.md 2.6) |
| `JUPITER_API_BASE`, `JUPITER_QUOTE_BASE`, `JUPITER_TOKEN_LIST_URL`, `DEXSCREENER_BASE` | lite-api / dexscreener | override for proxies. Values pointing at the retired hosts (`quote-api.jup.ag/v6`, `tokens.jup.ag`, `price/v2`) are remapped to the live `swap/v1`, `tokens/v2`, `price/v3` endpoints with a warning (`src/sources/jupiter-endpoints.ts`) |
| `PRICE_SOURCE` / `STATIC_PRICES_JSON` | `live` / — | `static` serves prices, market data and token metadata from a JSON file (hot-reloaded); swaps are unavailable so AP/flywheel legs degrade gracefully. Localnet e2e only (`docs/localnet-e2e.md`) |
| `ENV_FILE` | `.env` | alternate dotenv file, e.g. `ENV_FILE=.env.localnet` |
| `DB_PATH` | `./data/keeper.db` | SQLite (WAL). Migrations run on boot |
| `PORT`, `CORS_ORIGIN` | `8787`, `*` | |
| `ADMIN_TOKEN` | — | bearer token for `POST /v1/admin/*`; when unset the admin API answers 403 |
| `RECONSTITUTION_MODE` | `manual` | `manual` = committee approves proposals; `auto` = keeper approves and queues them itself |
| `RECON_REJECT_COOLDOWN_DAYS` | `90` | rejected proposals are not re-proposed for this long |
| `REF_PRICE_UPDATES` / `REF_PRICE_MIN_CHANGE_BPS` | `true` / `25` | push on-chain reference prices after every NAV snapshot; skip changes below the threshold |
| `NAV_SNAPSHOT_SEC`, `REBALANCE_CHECK_SEC`, `ACTION_EXECUTE_SEC`, `AUCTION_MONITOR_SEC`, `AP_CHECK_SEC`, `DIST_INTERVAL_MIN`, `METHODOLOGY_CRON`, `FEE_PROCESS_CRON` | 60 / 60 / 60 / 15 / 30 / 15 / `5 0 * * *` / `0 * * * *` | job cadence |
| `AP_THRESHOLD_BPS`, `AP_NOTIONAL_SOL`, `AP_MAX_NOTIONAL_SOL_PER_CYCLE`, `AP_SLIPPAGE_BPS`, `KILL_SWITCH` | 75 / 2 / 10 / 100 / false | AP arbitrage bounds |
| `MIN_CLAIM_SOL`, `AIRDROP_BATCH_SIZE`, `AIRDROP_DENYLIST`, `ATA_RENT_LAMPORTS`, `FEE_BURN_PCT` | 0.05 / 18 / — / 2039280 / 75 | flywheel |
| `FEE_RESERVED_UNITS` | `0` | raw index units held by the keeper (fee_recipient) that are **not** fees - the bootstrap seed printed by `init-fund`. `fee-processing` redeems only `balance - reserved` |
| `WEIGHTING_SCHEME`, `REBALANCE_INTERVAL_DAYS`, `DRIFT_RELATIVE_BPS`, `MAX_TRADE_PCT_DAILY_VOLUME` | equal / 7 / 5000 / 5 | methodology overrides (`DRIFT_RELATIVE_BPS` 5000 = rebalance when a weight is >50% above/below its target) |

## 4. Jobs

| Job | Cadence | What it does |
|---|---|---|
| `nav-snapshot` | 60 s | reads Fund/Assets/supply, prices, computes NAV, weights, drift, index level (divisor reconciliation), market price & premium; persists `nav_snapshots`/`holdings_snapshots`; emits SSE `fund`, `holdings`; then **pushes on-chain reference prices** (`set_ref_price`, 10 per tx) for every asset whose price moved ≥ `REF_PRICE_MIN_CHANGE_BPS`, clamped to `max_ref_move_bps` per period (clamps are logged as warnings — a bigger move needs an authority `ref_price_override` through the timelock) |
| `execute-actions` | 60 s | executes every `PendingAction` whose eta has passed (anyone may; the keeper does it so the multisig never has to come back), reconciles queued proposals to `executed` |
| `methodology` | daily 00:05 UTC | candidate universe (Jupiter verified tokens by volume + incumbents) → eligibility → ranking → buffer selection → weights; persists `methodology_runs`; records **reconstitution proposals** (manual mode) or approves them (auto mode); publishes the announcement 48 h ahead listing what is approved; on the 1st queues the approved items through the timelock |
| `rebalance-check` | 60 s | reads the cached NAV; scheduled (7 d) / relative drift (>50% of target) / queued-remainder trigger → plan → `start_auction` per trade (volume-capped, end price lifted to the ref-price bound when needed) |
| `auction-monitor` | 15 s | reconciles fills into `auction_fills`/`flywheel_events`, cancels expired auctions, **self-fills** when price ≤ mid × 0.995 (buys buy-token on Jupiter, `fill_auction`, recycles sell-token) |
| `ap-check` | 30 s | Jupiter two-sided quote vs NAV; create (basket → `buildMintTxs` → sell units) on premium > 75 bps, redeem on discount > 75 bps; records `create`/`redeem` with profit |
| `flywheel` | `DIST_INTERVAL_MIN` | claim creator fees (pump + PumpSwap) → 50% LP leg (buy $FI6900, add Meteora liquidity) → 50% airdrop leg (buy basket, create units) → pro-rata airdrop to $FIX6900 holders in batches of 18, dust carried forward |
| `fee-processing` | hourly | `accrue_management_fee`, redeem fee units, sell basket → SOL, 75% buy $FIX6900 and **burn**, 25% to treasury; also resets the AP notional budget |

Every job has a lock (overlapping runs are skipped and logged), structured pino logs, and status is exposed in `GET /health` (`jobs`).

## 5. Wallets and roles

- **Keeper wallet** — must be the fund `rebalancer` and the `fee_recipient`. Needs SOL for fees and for AP/self-fill working capital (several SOL; AP notional is bounded by `AP_MAX_NOTIONAL_SOL_PER_CYCLE`). As rebalancer it may only move reference prices within `max_ref_move_bps` per `ref_move_period_slots` and may only open auctions whose end price respects the bound.
- **Dev wallet** — the pump.fun coin creator (fees accrue to it). Needs a little SOL for rent/fees; the flywheel is self-funding.
- **Authority** — Squads multisig in production. Everything it does except `set_paused` is a timelocked `PendingAction` (`queue_action`); the keeper (or anyone) executes it after the eta. While the keeper is still the authority (launch), `keeper approve --immediate` / `add-asset` / `queue-approved` queue the actions themselves; afterwards the CLI prints the payload the multisig must queue.

## 6. Index committee workflow (`RECONSTITUTION_MODE=manual`)

1. The daily methodology run stores proposals (`GET /v1/proposals`, `keeper proposals`): `add` / `remove` with the metrics that justify them (rank, market cap, volume, impact, eligibility reasons).
2. Review and decide: `keeper approve <mint> [--weight bps]` or `keeper reject <mint> --note "..."` (or `POST /v1/admin/proposals/:mint/approve|reject` with `Authorization: Bearer $ADMIN_TOKEN`). A rejection suppresses the same proposal for `RECON_REJECT_COOLDOWN_DAYS`.
3. Approved proposals are announced 48 h before the 1st and queued on-chain at the window (`queue_action` add_asset / begin_remove_asset + `set_target_weight` re-equalizing the incumbents). `--immediate` queues right away. The timelock then runs (48 h on mainnet); `execute-actions` applies them.
4. `keeper add-asset <mint>` / `remove-asset <mint>` create pre-approved manual proposals (mint existence and revoked authorities are validated; `--force` skips the authority check).

## 7. DRY_RUN → live checklist

1. Run in `DRY_RUN=true` against mainnet for ≥ 48 h. Verify in logs/API:
   - `nav-snapshot` NAV matches a manual calculation; no `unpriced` assets; the ref-price plan logs no `clamped` warnings in calm markets.
   - `rebalance-check` plans look sane (turnover, pairing, volume caps, queued remainders, no `lifted to the on-chain ref-price bound` surprises).
   - `ap-check` decisions are `none` most of the time and only `create`/`redeem` with positive expected profit.
   - `flywheel` shows plausible pending creator fees and airdrop share computation (`skipped`, `carried`).
   - `fee-processing` dry events appear hourly.
2. Confirm `KEEPER_KEYPAIR` pubkey == on-chain `fund.rebalancer` == `fund.fee_recipient` (`keeper governance`).
3. Fund the keeper (≥ 5 SOL recommended) and dev wallet (≥ 0.5 SOL).
4. Set `TREASURY_WALLET`, `METEORA_POOL`, `AIRDROP_DENYLIST` (LP pools, CEX deposit addresses, program-owned accounts you know about; PDAs are auto-excluded), `ADMIN_TOKEN` (long random string) if the admin API is used.
5. Set `DRY_RUN=false`, restart, watch the first `nav-snapshot` (ref prices), `auction-monitor` and `ap-check` cycles with `LOG_LEVEL=debug`.
6. Keep `KILL_SWITCH=true` ready: it stops the AP loop on next check without restart (env reload requires restart; alternatively set `AP_ENABLED=false`). `set_paused` from the multisig is instant and never timelocked.
7. Back up `data/keeper.db` (holds divisor state, carry table, airdrop history, proposals).

## 8. Troubleshooting

- **`@fi6900/sdk unavailable`** — the SDK package is not built/linked. `pnpm -r build` at the root; the adapter `src/chain/sdk.ts` lists the exports it expects.
- **`begin_mint` fails with `AuctionsOpen`** — expected while auctions are open; AP and flywheel creation wait automatically.
- **`start_auction` fails with `PriceBelowBound` / `RefPriceUnset`** — the asset's on-chain ref price is stale or unset. Check `keeper set-ref-prices`; an unset first value must come from the authority (`set_ref_price` directly, or `ref_price_override` through the timelock).
- **`RefPriceMoveTooLarge` / `clamped` warnings** — the market moved more than `max_ref_move_bps` in one period. The keeper keeps pinning the price at the window edge each snapshot; if auctions are blocked by the bound, the authority queues `ref_price_override`.
- **`TimelockRequired`** — a direct setter was called while the timelock is armed. Use `queue_action` (`keeper approve`, `add-asset`, or the multisig).
- **Jupiter 429** — the free tier is ~60 req/min per IP and the keeper already spaces calls by `JUPITER_MIN_INTERVAL_MS`. Set `JUPITER_API_KEY` (portal.jup.ag) or raise the interval; lowering `AP_CHECK_SEC` frequency also helps.
- **CoinGecko 429 / `coins list refresh failed; using stale cache`** — the public tier allows ~30 req/min and 10k calls/month per IP; the client waits `Retry-After` and retries 3 times, then keeps the on-disk `coingecko-coins-list.json` (24 h) and the in-memory category pages (10 min). Set `COINGECKO_API_KEY` (free Demo key) or raise `COINGECKO_MIN_INTERVAL_MS`. If CoinGecko is down for longer than the cache, the methodology run logs `token universe unavailable; using incumbents only` and only re-evaluates the current constituents (no additions are proposed); `UNIVERSE_SOURCE=jupiter` is the emergency fallback universe.
- **`Named export 'BN' not found` from `@pump-fun/pump-sdk`** — the SDK's ESM build cannot be imported from this ESM package; `flywheel/creator-fees.ts` loads the CommonJS build through `createRequire`. Do not change that back to `import()`.
- **`jupiter price fetch failed` for some mints only** — Price v3 answers at most 50 ids per call and silently drops the rest; the client chunks by 50. Tokens Jupiter does not index return no price and fall back to DexScreener.
- **Index level jumps** — check `nav_snapshots.divisor`; a jump means balances changed without a reconciliation (should not happen; open an issue with the two snapshots).
- **Holder snapshot slow / `413 data allowance` / `Indexed requests require a personal token`** — set `HELIUS_API_KEY`. The gPA fallback (`dataSlice` 40 bytes + `memcmp` on the mint, SPL Token and Token-2022) works on `api.mainnet-beta.solana.com` for mid-size mints (5.9k holders in ~3 s) but public RPCs cap data per IP and some refuse indexed queries.
- **SQLite locked** — only one keeper process per DB file.

## 8a. External integrations as verified against mainnet (2026-10-03)

Every third-party code path was exercised read-only / simulate-only against the live services on 2026-10-03; the checks live in `apps/keeper/test/live/*.live.test.ts` and run with

```bash
cd apps/keeper && LIVE=1 pnpm exec vitest run test/live --no-file-parallelism   # optional: RPC_URL, HELIUS_API_KEY, JUPITER_API_KEY, COINGECKO_API_KEY
```

| Integration | Endpoint / program | Status | Notes |
|---|---|---|---|
| Jupiter Price | `GET {jup}/price/v3?ids=` | works, no key | max **50 ids per call** (extra ids are dropped silently); `price/v2` is 404. Shape `{ [mint]: { usdPrice, decimals, liquidity, priceChange24h } }` |
| Jupiter Quote/Swap | `GET {jup}/swap/v1/quote`, `POST {jup}/swap/v1/swap` | works, no key | `quote-api.jup.ag/v6` no longer resolves. `priceImpactPct` is a decimal string. ExactIn/ExactOut both verified; SOL→BONK swap tx for a throwaway wallet deserializes and simulates (fails only at the fee payer) |
| Jupiter Tokens | `GET {jup}/tokens/v2/tag?query=verified`, `/search?query=m1,…` (≤100), `/toptraded/24h` | works, no key | `tokens.jup.ag` no longer resolves. Records carry `mcap`, `fdv`, `liquidity`, `stats24h.{buy,sell}Volume`, `firstPool.createdAt`, `audit.{mint,freeze}AuthorityDisabled`, `holderCount`, `tags` — the methodology uses them as the aggregate (all venues) and DexScreener as cross-check |
| `{jup}` host | `https://lite-api.jup.ag` without key, `https://api.jup.ag` + `x-api-key` with `JUPITER_API_KEY` | | api.jup.ag answered unauthenticated on the test day with a 5-request burst window, but Jupiter documents it as key-only; the keeper does not rely on it |
| CoinGecko | `GET /coins/markets?vs_currency=usd&category=solana-meme-coins&order=market_cap_desc&per_page=250&page=n`, `GET /coins/list?include_platform=true`, `GET /coins/{id}` | works, no key, ~30 req/min | candidate universe (methodology 2.6). 500 category members on 2026-10-03, 498 with a Solana mint in `platforms.solana` (misses: `catcoin-eth`, `barbiecrashbandicootrfk88`); `/coins/{id}` adds `detail_platforms.solana.decimal_place`. `total_volume` is CEX+DEX and is **not** used for the volume screen. Response `Cache-Control: max-age=30`; the keeper caches pages 10 min and the list 24 h |
| DexScreener | `GET /tokens/v1/solana/{≤30 mints}`, `GET /token-pairs/v1/solana/{mint}` | works, no key, 300 req/min | `tokens/v1` returns **one (primary) pair per token**, so its `volume.h24`/`liquidity.usd` are per-pool (WIF: $280k vs $886k across 30 pools vs $1.04M on Jupiter). `token-pairs/v1` is used for the names that pass the cheap screens. `fdv`, `marketCap`, `pairCreatedAt`, `priceChange.h24`, `info.imageUrl` all present |
| Holder snapshot | Helius DAS `getTokenAccounts` / RPC `getProgramAccounts` | DAS not tested (no key in the repo); gPA verified | see §3 `HELIUS_API_KEY`. New pump.fun coins are **Token-2022** mints (`TokenzQd…`): the gPA fallback picks the program from the mint owner and drops the `dataSize` filter for Token-2022 |
| pump.fun creator fees | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` + `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` via `@pump-fun/pump-sdk` 2.0.0 | works (simulated) | `collectCoinCreatorFeeInstructions(creator)` → `collect_creator_fee` + WSOL ATA create + `collect_coin_creator_fee` + close WSOL; simulation with the real creator as signer (`sigVerify:false`) succeeds end-to-end. Unclaimed = `getCreatorVaultBalanceBothPrograms` (`/v1/flywheel.creatorFeesUnclaimedSol`, split bonding-curve / PumpSwap). Vault PDAs: `["creator-vault", creator]` (pump), `["creator_vault", creator]` (pAMM, fees in its WSOL ATA). The SDK must be loaded as CommonJS (see §8) |
| Meteora DAMM v2 | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` via `@meteora-ag/cp-amm-sdk` 1.5.1 | works (simulated) | `fetchPoolState` / `getDepositQuote` / `createPositionAndAddLiquidity` and `preparePoolCreationParams` / `createPool` built for a live X/SOL pool reach the program (`AddLiquidity`, `initializePool`) and fail only at the token transfer when the signer holds no tokens. The SDK wraps/unwraps SOL itself. Public configs: index 0 = fees in both tokens, 1 = fees in SOL only, 0.25% base fee, full range. `keeper create-pool` builds the INDEX/SOL pool at NAV per unit |

## 9. Data retention

`nav_snapshots` are kept indefinitely (≈ 1,440 rows/day). Call `Repo.pruneNav()` from a maintenance script if needed; `/v1/history?range=all` down-samples to ≤ 2,000 points.

## 10. Admin page (`/admin`)

The web app serves an index-committee console at `/admin` (not linked from the navigation; `robots: noindex`). It is a thin client over the endpoints in §6: `GET /v1/governance`, `GET /v1/proposals`, `GET /v1/methodology`, and the `POST /v1/admin/*` mutations.

- **Token.** Paste the keeper's `ADMIN_TOKEN` into the "Admin token" field. It is kept in the tab's `sessionStorage` only and sent as `Authorization: Bearer …` on admin requests; it is never logged or put in a URL. Reads work without a token. A `401` (wrong token), `403` (`ADMIN_TOKEN` unset on the keeper) or `503` (keeper in mock mode) is shown inline under the field.
- **Proposals.** Grouped by status. Each `proposed` row shows the methodology metrics (rank, mcap, volume, impact, authorities, failed checks) and has Approve (optional weight bps, "Queue immediately" toggle) and Reject (optional note). *Immediate* bypasses the 48 h announcement and queues on-chain at once; the UI warns in red. Approve first flips the proposal to `approved` and then queues; if queueing fails (RPC error) the proposal stays `approved` and `keeper queue-approved` can retry it.
- **Manual add / remove.** Same validation as `keeper add-asset` / `remove-asset`; API errors are shown verbatim. *Force* skips the authority-revoked check.
- **Results.** Every mutation appends to a session-local "Mutation results" log with the proposal's new state, the PendingAction PDA, the queue signature and the re-equalizing `set_target_weight` actions, all deep-linked to Solscan for the configured cluster.
- **Governance.** Timelock (slots and ≈ hours at 400 ms/slot), authorities, upgrade authority (burned/held), ref-price policy, and the pending-action table with ETA slot and ≈ time remaining. Execution is permissionless; the keeper's `execute-actions` job normally does it.
- **Reconstitution.** Next window, announce-ahead time, mode, last methodology run and reject cooldown, from `/v1/methodology`.

When the keeper is unreachable the page falls back to demo fixtures (banner shown) and all mutations are disabled.
