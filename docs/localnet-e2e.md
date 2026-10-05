# FI6900 localnet end-to-end

Runs the whole stack — program, SDK, keeper (LIVE, not dry-run) and web — against a local
`solana-test-validator`, with no Jupiter / DexScreener / pump.fun access. Everything the keeper
needs from the market is served by `PRICE_SOURCE=static` from a JSON file you control, which is
also how the rebalance is triggered (perturb a price → drift → Dutch auctions → fills).

What the loop proves:

| Step | Evidence |
|---|---|
| program + SDK | `pnpm test:program` green (60 tests: 5-asset suite incl. ref-price bounds and the admin timelock, SDK suite, 40-asset round trip, 301-slot fund) |
| fund bootstrap | `initialize_fund(50,50,100, timelock 0)`, 8× `add_asset`, 8× `set_ref_price`, lookup table, vault seed, `bootstrap_mint` 1,000,000 units |
| keeper LIVE | `/v1/fund` supply 1,000,000, `/v1/verify` `mintAuthority == fundPda`, 8 vaults, `upgradeAuthority`/`programDataAddress`, `/v1/governance` timelock 0 + pending [], `/v1/holdings` 8 rows at 1250 bps, `/v1/methodology` (8/8 eligible offline) |
| ref prices | the keeper pushes `set_ref_price` after every NAV snapshot (clamped to `max_ref_move_bps`), `RefPriceSet` events on-chain |
| in-kind create / redeem | SDK `buildMintTxs` / `buildRedeemTxs` signed by an AP keypair; supply moves by exactly `units` (± mgmt-fee accrual), `effective/supply` ratios unchanged, index level continuous |
| rebalance | price perturbation → `keeper rebalance` opens one auction per (over, under) pair **inside the ref-price bound** → keeper fallback filler fills from inventory → weights back to target, `epoch` advanced, every fill has a signature in `/v1/auctions` |
| governance | `keeper add-asset <mint> --immediate` queues an `add_asset` PendingAction (timelock 0 → eta now); `execute-actions` applies it; `/v1/proposals` shows the lifecycle |
| web | home page shows LIVE data (no demo banner), `/auctions` lists the filled auctions, `/verify` lists the vaults and the upgrade authority |

## 0. Prerequisites

- WSL Ubuntu with Anchor 0.31.1 + Solana CLI 2.3; the program built with platform-tools v1.52 (`~/fi.sh anchor build --no-idl -- --tools-version v1.52`, then `anchor idl build ...`; `target/deploy/fi6900.so`, id `Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV`).
- Node 22 + pnpm on the host; `pnpm install` done; `pnpm --filter @fi6900/sdk build` done (the keeper loads `packages/sdk/dist`; copy `target/idl/fi6900.json` → `packages/sdk/idl/` and `target/types/fi6900.ts` → `packages/sdk/src/types/` after every program build).
- Ports: validator 8899, keeper 8787, web 3000 (Next picks another port if busy).

## 1. Validator with the program preloaded

In WSL (the repo is at `/mnt/d/.../FI6900`; `~/validator.sh` does exactly this):

```bash
solana-test-validator --reset --quiet --ledger ~/fi6900-ledger \
  --bpf-program Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV target/deploy/fi6900.so \
  --bind-address 0.0.0.0 --rpc-port 8899
```

Check from the host: `curl -s http://127.0.0.1:8899 -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -H 'content-type: application/json'` → `"ok"`.

Confirm the program and SDK: `pnpm test:program` (≈6 min, 60 passing; the 301-slot suite alone creates ~300 mints).

## 2. Bootstrap the fund — `pnpm e2e:setup`

`apps/keeper/scripts/localnet-setup.ts`:

1. creates/loads `keypairs/keeper.json` (authority = rebalancer = fee_recipient) and `keypairs/ap.json`, airdrops 500 / 100 SOL;
2. creates 8 SPL mints (WIF, BONK, POPCAT, MEW, GIGA, PNUT, FARTCOIN, MOODENG — 6 or 9 decimals, fake localnet mints), mints 4× the vault seed to the keeper (inventory for auction fills) and 0.2× to the AP, then revokes mint authority so the methodology's eligibility rules pass;
3. creates the 6-decimal index mint, `initialize_fund(50, 50, 100, timelock_slots = 0)` (`LOCALNET_TIMELOCK_SLOTS` overrides; mainnet uses 432000), `add_asset(1250)` × 8, then `set_ref_price` × 8 from the static prices (`usdToRefPriceQ64(priceUsd, decimals)`: Q64.64 nano-USD per raw unit — the auction price bound needs them);
4. creates the fund address lookup table;
5. transfers an equal-USD basket ($125k per asset at the static prices) into the vaults and `bootstrap_mint`s 1,000,000 units → NAV $1.00/unit, index level 1000;
6. writes
   - `keypairs/localnet-prices.json` — `STATIC_PRICES_JSON` (mint → `{symbol, name, decimals, priceUsd, volume24hUsd, marketCapUsd, fdvUsd, liquidityUsd, change24hPct, pairCreatedAt}`, plus SOL and USDC entries used for quotes),
   - `apps/keeper/.env.localnet` — keeper config (`DRY_RUN=false`, `PRICE_SOURCE=static`, `INDEX_MINT`, `LOOKUP_TABLE`, `DB_PATH=./data/localnet.db`, fast cadences, `AP_ENABLED=false`, no `COIN_MINT` so the flywheel is disabled, `FEE_RESERVED_UNITS=1000000000000`, `RECONSTITUTION_MODE=manual`, `REF_PRICE_UPDATES=true`, `ACTION_EXECUTE_SEC=10`, `ADMIN_TOKEN=localnet-admin`),
   - `apps/web/.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8787`, `NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899`, `NEXT_PUBLIC_CLUSTER=localnet`, `NEXT_PUBLIC_INDEX_MINT`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_LOOKUP_TABLE`,
   - `keypairs/localnet.json` — every address and signature of the run.

It prints `INDEX_MINT=… FUND=… LOOKUP_TABLE=… SUPPLY=1000000000000`. Re-running creates a fresh fund (new index mint) on the same validator; `--reset` the validator for a clean ledger (and delete `apps/keeper/data/localnet.db` so the divisor/proposal state starts fresh).

The mainnet path is untouched: `keeper init-fund` (docs/launch-runbook.md) still buys the basket through Jupiter.

## 3. Keeper LIVE against localnet — `pnpm e2e:keeper`

Equivalent to `cd apps/keeper && tsx --env-file=.env.localnet src/cli.ts run` (`ENV_FILE=.env.localnet` also works).
Logs `keeper running LIVE`; `DEV_WALLET and/or COIN_MINT not set; flywheel disabled` is expected.

```bash
curl -s localhost:8787/health | jq .data.mode          # "live"
curl -s localhost:8787/v1/fund | jq .data              # supply "1000000000000", navPerUnitUsd 1, indexLevel 1000, assetCount 8
curl -s localhost:8787/v1/verify | jq '.data.mintAuthority == .data.fundPda, (.data.vaults|length), .data.upgradeAuthority, .data.programDataAddress'
curl -s localhost:8787/v1/governance | jq '.data | {timelockSlots, pending, fundAuthority, rebalancer, maxAuctionDiscountBps, upgradeAuthority}'
curl -s localhost:8787/v1/holdings | jq '.data[] | {symbol, weightBps, targetWeightBps}'
curl -s "localhost:8787/v1/history?range=1d" | jq '.data|length'
pnpm --filter @fi6900/keeper exec tsx --env-file=.env.localnet src/cli.ts methodology --dry   # universe 8, eligible 8, equal 1250 bps, mode manual
```

With `PRICE_SOURCE=static`:
- prices, volume, market cap, metadata and the candidate universe come from the JSON file (re-read whenever its mtime changes);
- quotes are synthesised at zero price impact (so the methodology's liquidity screen works), but `swapTx` throws — the AP loop, the self-fill's Jupiter leg and the sell-token recycling log a warning and skip; the keeper fills auctions from the tokens it already holds (`self-fill from keeper inventory (no swap)`);
- `marketPriceUsd` / `premiumBps` are `null` (no secondary market on localnet);
- after every NAV snapshot the keeper (as rebalancer) pushes `set_ref_price` for assets whose price moved ≥ 25 bps, clamped to 20 % per period — a `set-price` jump of +40 % therefore shows a `clamped` warning and the on-chain ref moves +20 %, which is still inside the auction bound (`end >= fair × 0.95`).

## 4. Economics through the SDK — `pnpm e2e:ap …`

`apps/keeper/scripts/localnet-ap.ts` signs with `keypairs/ap.json` and prints every signature.

```bash
pnpm e2e:ap status                 # supply, effective balances, effective/supply ratios, weights
pnpm e2e:ap create 10000           # buildMintTxs: 4 txs (accrue+begin_mint, 2 deposit batches, finalize). AP receives 9,950 (0.5% fee → keeper)
pnpm e2e:ap redeem 5000            # buildRedeemTxs: 3 txs (accrue+begin_redeem, 1 withdraw batch of 8, close_redeem)
```

`vaultRatiosUnchanged: true` checks that `effective_i / supply` is identical before and after, up to the
management fee accrued by the prelude instruction (`mgmtFeeAccruedUnits`, 1 %/yr × elapsed × supply)
and 1e-9 rounding. `/v1/fund.indexLevel` stays continuous across both (the divisor is re-set on balance changes).

### Rebalance

```bash
pnpm e2e:ap set-price WIF 1.75     # +40 %: WIF weight 16.7 % vs 12.5 % target → relative drift +33 % (band is 50 %)
pnpm e2e:ap set-price WIF 2.25     # +80 %: weight 20.4 % → relative drift +63 % > 50 % band
pnpm e2e:rebalance                 # keeper rebalance (LIVE): reason "drift", opens 7 auctions WIF -> each underweight
```

Every auction's `end_price` is at or above `(ref_WIF / ref_buy) × 0.95` — the keeper lifts its curve to the bound when its
own discount (4 %) would end below it because the on-chain ref price lags the static jump (20 %/period cap). The running
keeper's `auction-monitor` (every 5 s) fills each auction once the Dutch curve crosses `mid × (1 − 50 bps)` — or run
`pnpm e2e:ap fill` to have the AP act as an independent third-party filler. Then:

```bash
curl -s "localhost:8787/v1/auctions?status=all" | jq '.data[] | {sellSymbol, buySymbol, status, endPrice, fills}'
curl -s localhost:8787/v1/holdings | jq '.data[] | {symbol, weightBps, driftBps}'   # all ≈ 1250 / 0
curl -s localhost:8787/v1/fund | jq '.data | {epoch, openAuctions, indexLevel}'       # epoch "7", 0, 1100
```

Expected: every weight back to ≈1250 bps, `epoch` = number of fills, index level 1100 (= 1000 × (1 + 0.8 × 0.125)), `/v1/flywheel/events` has `auction_start` and `auction_fill` rows with signatures.

### Governance (timelock 0 on localnet)

```bash
pnpm --filter @fi6900/keeper exec tsx --env-file=.env.localnet src/cli.ts governance            # timelock 0, pending []
pnpm --filter @fi6900/keeper exec tsx --env-file=.env.localnet src/cli.ts proposals             # methodology proposals (none while 8/8 eligible)
pnpm --filter @fi6900/keeper exec tsx --env-file=.env.localnet src/cli.ts add-asset <MINT> --weight 1111 --immediate --force
#   -> inserts an approved proposal, queue_action(add_asset) + set_target_weight for the incumbents; the running keeper's
#      execute-actions job (10 s) executes them (eta = now with timelock 0); /v1/proposals shows status queued -> executed
curl -s -X POST -H 'authorization: Bearer localnet-admin' localhost:8787/v1/admin/proposals/<MINT>/reject   # admin API
```

## 5. Web

```bash
pnpm --filter @fi6900/web dev      # reads apps/web/.env.local written by e2e:setup
```

Home: no amber "Demo data" banner, the pill reads Live, holdings table shows the 8 localnet assets.
`/auctions`: the 7 filled WIF auctions with their fills. `/verify`: 8 vaults owned by the fund PDA,
mint authority = fund PDA, lookup table, program id, upgrade authority. Solscan links carry `?cluster=custom&customUrl=http://127.0.0.1:8899`.

## Files

- `apps/keeper/src/sources/static.ts` — `StaticMarketSource` / `StaticQuoteSource` (`PRICE_SOURCE=static`).
- `apps/keeper/scripts/localnet-setup.ts`, `apps/keeper/scripts/localnet-ap.ts`.
- Generated (gitignored): `keypairs/*.json`, `apps/keeper/.env.localnet`, `apps/keeper/data/localnet.db`, `apps/web/.env.local`.

## Fee processing offline

The hourly `fee-processing` job runs for real: `accrue_management_fee`, then an in-kind redemption of the
fee units above `FEE_RESERVED_UNITS` (`/v1/flywheel/events` kinds `fee_accrual`, `redeem`). The basket sale,
buyback and burn legs need a DEX and log `basket leg sale failed; keeper holds token` under `PRICE_SOURCE=static`.
Re-seed after experiments with `pnpm e2e:ap --as keeper create <units>` (signs with `keypairs/keeper.json`).

## Troubleshooting

- Supply collapsed after the top of the hour — `FEE_RESERVED_UNITS` missing; the fee job redeemed the keeper's seed units (fixed in `.env.localnet`, see above).
- `EADDRINUSE :::8787` — another keeper (often a `MOCK_MODE` dev server) is running; stop it.
- `insufficient funds` while seeding — token amounts overflow u64; keep `price × 10^decimals × seed × 4 < 1.8e19` (why BONK uses 6 decimals here).
- `price_impact_unknown` for every candidate — the static file lacks the USDC entry the impact quote targets.
- `start_auction` → `PriceBelowBound` — the static price jumped more than the ref-price cap allows per period; the keeper lifts the end price automatically, but a manual `startAuction` must respect `fair × (1 − maxAuctionDiscountBps)`.
- `RefPriceUnset` — the asset was added without `set_ref_price` (e.g. via `add-asset`); the keeper's next snapshot sets it while it is the authority.
- The keeper CLI (`rebalance`, `methodology`, `add-asset`) shares `data/localnet.db` with the running keeper; SQLite WAL handles the concurrent access.
