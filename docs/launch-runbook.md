# FI6900 Launch Runbook

Step-by-step launch of the FI6900 index fund and the $FIX6900 flywheel coin. Each step lists what to verify before moving on. Commands assume the repo root unless stated.

## 0. Prerequisites

- Node 22, pnpm 10, Anchor 0.31.1 + Solana CLI 2.3 with platform-tools v1.52 (WSL for the program; see the build note in `Anchor.toml`).
- Keypairs in `keypairs/` (gitignored): `keeper.json`, `dev-wallet.json`, and the program upgrade authority (`solana config get` keypair) — plus a **Squads multisig** (https://app.squads.so) that will become the fund authority and the program upgrade authority.
- Funding: deployer ≥ 6 SOL (program deploy ~5 SOL), keeper ≥ 5 SOL + the seed capital for the basket (see `docs/launch-constituents.md` §3 for how much seed each constituent can absorb), dev wallet ≥ 1 SOL.
- API keys: **`HELIUS_API_KEY` (required)** — the keeper sends transactions and snapshots holders through `RPC_URL`; the public RPC rate-limits per method and caps data per IP (`docs/operations.md` §3). **`JUPITER_API_KEY` (recommended)** from https://portal.jup.ag — without it the keeper uses the free `lite-api.jup.ag` tier at ~1 request/s, which is enough for launch but slow for the daily methodology run (~10-15 min with a 250-token universe). No other keys are needed: DexScreener, pump.fun and Meteora are keyless.
- `pnpm install` done; `pnpm --filter @fi6900/keeper test` green; `pnpm test:program` green against a local validator (60 tests incl. the 40- and 301-asset suites).
- `cd apps/keeper && LIVE=1 pnpm exec vitest run test/live --no-file-parallelism` green on the launch day (live contract tests for Jupiter, DexScreener, holder snapshots, pump.fun claim and Meteora; read-only, nothing is sent). If Jupiter or DexScreener changed shape overnight this is where it shows.

## 1. Create the $FIX6900 coin on pump.fun

1. From the **dev wallet** (this wallet must be the *creator*: creator fees accrue to it and the keeper claims them through `collect_creator_fee` / `collect_coin_creator_fee`), create the coin on pump.fun. Name/ticker: `FI6900 Coin` / `FI`.
2. Record the mint → `COIN_MINT` in `apps/keeper/.env`.
3. Verify:
   - `solana account <COIN_MINT>`: mint authority revoked by pump.fun. Coins created on pump.fun in 2026 are **Token-2022** mints (owner `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`); the keeper derives the coin's token program from the mint for the burn leg and holder snapshots, so either program works.
   - `pnpm --filter @fi6900/keeper keeper snapshot-holders --mint <COIN_MINT>` returns holders (DAS with `HELIUS_API_KEY`, else gPA).
   - After the first trades, `keeper airdrop --dry` logs a non-zero `pendingSol` from `getCreatorVaultBalanceBothPrograms`, and `GET /v1/flywheel.creatorFeesUnclaimed` shows the bonding-curve / PumpSwap split. The claim transaction is `collect_creator_fee` (pump) + `collect_coin_creator_fee` (PumpSwap) signed by the **dev wallet = creator**; it was verified by simulation against a live creator on 2026-10-03 (`test/live/pump.live.test.ts`).

## 2. Deploy the program

1. In WSL: `anchor build --no-idl -- --tools-version v1.52 && anchor idl build -o target/idl/fi6900.json -t target/types/fi6900.ts`, then `anchor deploy --provider.cluster mainnet` (program `fi6900`, id `Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV`). The deployer keypair is the initial **upgrade authority**.
2. Copy the IDL/types into the SDK and build it: `cp target/idl/fi6900.json packages/sdk/idl/ && cp target/types/fi6900.ts packages/sdk/src/types/ && pnpm --filter @fi6900/sdk build`. Confirm `PROGRAM_ID` in the SDK equals the deployed id and record the IDL hash (`idl_hash` in the keeper kv via `sqlite3 data/keeper.db "insert into kv values('idl_hash','sha256:...', datetime('now'))"` — shown on `/v1/verify`).
3. `anchor idl init -f target/idl/fi6900.json <PROGRAM_ID>` so explorers show the IDL.
4. Verify: `anchor idl fetch <PROGRAM_ID>` returns the IDL; `pnpm --filter @fi6900/keeper build` passes (the keeper's `chain/sdk.ts` adapter resolves the SDK exports at runtime; a mismatch is reported as `@fi6900/sdk unavailable: missing exports ...`).

## 3. Initialise the fund

**3.0 Approve the launch index first.** `init-fund` adds whatever the methodology selects at that moment, so the committee signs off on the list beforehand:

```bash
cd apps/keeper
KEEPER_KEYPAIR=../../keypairs/keeper.json INDEX_MINT=<any pubkey until the mint exists> \
  pnpm keeper launch-report --seed 5,10,25,50 --out ../../docs/launch-constituents.md
```

This is a read-only methodology dry run on live Jupiter/DexScreener/RPC data (~10-15 min on the free Jupiter tier, ~2 min with JUPITER_API_KEY). It writes `docs/launch-constituents.md`: ranked eligible list with mcap / 24h volume / liquidity / age / $10k-sell impact / mint & freeze authorities / holders, the proposed 40 (250 bps each), 20 alternates, every excluded token with its reasons, suspicious-token flags (freeze authority, not tagged `meme`, concentrated holders, Token-2022, wrapper-looking symbols) and the **seed-sizing table**: per-constituent Jupiter price impact for a 5 / 10 / 25 / 50 SOL seed (per-asset buy = seed / 40). Pick the largest seed whose worst leg is ≤ 1% impact. Anything the committee rejects goes into `eligibility.denylist` (`src/config/methodology.config.ts`) before `init-fund`; re-run the report and commit it — it is the public record of the launch universe.

`init-fund` runs the whole sequence with **timelock 0** so the assets can be added directly; the timelock is armed in step 7. Run it dry first.

```bash
cd apps/keeper
KEEPER_KEYPAIR=../../keypairs/keeper.json DRY_RUN=true  pnpm keeper init-fund --sol 25 --dry
KEEPER_KEYPAIR=../../keypairs/keeper.json DRY_RUN=false pnpm keeper init-fund --sol 25
```

What it does (keeper wallet is the initial authority; transfer to the multisig afterwards with `propose_authority`/`accept_authority`):

1. Generates the **index mint** keypair (6 decimals) and prints `INDEX_MINT=` and the secret — **save both**; creates the mint with the keeper as temporary authority.
2. `initialize_fund(50, 50, 100, timelock_slots = 0)` — program takes over mint authority; `Fund` PDA created with `max_auction_discount_bps = 500`, `max_ref_move_bps = 2000`, `ref_move_period_slots = 216_000`.
3. Runs the methodology (`keeper methodology --dry` equivalent) and calls `add_asset(target_weight_bps)` for each selected constituent (40 × 250 bps for equal weight).
4. **Sets the reference prices** (`set_ref_price` for every asset from the live prices, Q64.64 nano-USD per raw unit). The first value is authority-only; without it no auction can open (`RefPriceUnset`).
5. `createFundLookupTable()` and prints `LOOKUP_TABLE=` (one table per 256 addresses; 40 assets fit in one).
6. With `--sol 25`: buys each constituent via Jupiter pro-rata to target weights, transfers tokens into the vault ATAs, then `bootstrap_mint(units)` with `units = deposited USD × 1e6` so that **NAV per unit = USD 1.00** at inception and the index level starts at **1000**.
7. Takes the first NAV snapshot (initialises the divisor).

Put `INDEX_MINT`, `LOOKUP_TABLE` and `FEE_RESERVED_UNITS` (the bootstrap units, printed by `init-fund`) into `.env`. Without `FEE_RESERVED_UNITS` the hourly fee job would treat the seed position in the keeper wallet as fee units and redeem it.

Verify:
- `/v1/verify`: `mintAuthority == fundPda`; 40 vaults owned by the fund PDA with non-zero amounts; `upgradeAuthority` is still the deployer.
- `/v1/fund`: `supply > 0`, `navPerUnitUsd ≈ 1.00`, `indexLevel ≈ 1000`, `openAuctions = 0`, `paused = 0`.
- `/v1/holdings`: every `weightBps` within a few bps of 250.
- `/v1/governance`: `timelockSlots "0"`, every asset has a ref price (`keeper set-ref-prices --dry` reports no `needsAuthority`).
- `set_rebalancer(keeper)` and `set_fee_recipient(keeper)` if the authority differs from the keeper (direct while timelock is 0).

## 4. Seed secondary-market liquidity for $FI6900

The AP loop needs a market price. Create a `$FI6900/SOL` pool and seed it at NAV:

1. The keeper wallet already holds the bootstrap units (`FEE_RESERVED_UNITS`), so it supplies both sides. Create the **Meteora DAMM v2 (cp-amm)** pool at **initial price = NAV per unit** (the CLI reads NAV from the fund and SOL/USD from Jupiter and converts to SOL per unit):

   ```bash
   cd apps/keeper
   KEEPER_KEYPAIR=../../keypairs/keeper.json pnpm keeper create-pool --units 2000 --config 1 --dry   # simulate, prints pool address, SOL needed, implied price
   KEEPER_KEYPAIR=../../keypairs/keeper.json DRY_RUN=false pnpm keeper create-pool --units 2000 --config 1
   ```

   `--units` = index units to seed (2,000 units ≈ $2,000 at NAV 1.00; the SOL side is computed, ≈ 2,000 × NAV / SOL price). `--config 1` is Meteora's public config "fees collected in SOL only, 0.25%, full range" (`--config 0` collects fees in both tokens). `--price-sol x` overrides the price (only if NAV is unavailable). The command prints `METEORA_POOL=<pool PDA>` → `.env`. The transaction is `initializePool` (position NFT mint + metadata + deposit; the SDK wraps the SOL); it was verified by simulation against the live program on 2026-10-03 (`test/live/meteora.live.test.ts`). Reduce `FEE_RESERVED_UNITS` by the units deposited so the hourly fee job never tries to redeem them.
2. Verify: Jupiter routes `SOL → INDEX_MINT` (`curl "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=<INDEX_MINT>&amount=100000000&slippageBps=100"` returns a route; Jupiter indexes new DAMM v2 pools within minutes but can take longer for pools below ~$1k liquidity). `/v1/fund.marketPriceUsd` becomes non-null and `premiumBps` is within ±100. `solscan.io/account/<METEORA_POOL>` shows the position NFT owned by the keeper.
3. The flywheel's LP leg (`METEORA_POOL`) adds to this pool with `createPositionAndAddLiquidity` from the dev wallet; its SOL side gets a 1% buffer above the quote so a price tick between quote and send does not revert.

## 5. Dry-run the keeper against mainnet

```bash
MOCK_MODE=false DRY_RUN=true pnpm --filter @fi6900/keeper dev
```
Let it run ≥ 48 h. Check the items in `docs/operations.md` §7. In particular the `flywheel` job should log `creator fees claimed` (dry) once fees exceed `MIN_CLAIM_SOL`, `airdrop computed` with sensible `paid`/`skipped`, and `nav-snapshot` should plan ref-price updates without `clamped` warnings in calm markets.

## 5b. Host the keeper (Railway) and point the site at it (Vercel)

The devnet rehearsal of exactly this setup is documented in `docs/devnet.md`; mainnet differs only in values.

### Keeper on Railway

The repo root has a `Dockerfile` (node 22, pnpm, builds `@fi6900/sdk` + `@fi6900/keeper`, runs `node apps/keeper/dist/index.js`)
and a `railway.toml` (Dockerfile builder, `/health` healthcheck). Secrets are passed as env vars, never as files.

1. `railway login`, then from the repo root `railway init` (or `railway link` to the existing `fi6900` project) and create a service `keeper`.
2. Attach a volume at `/data` (SQLite: divisor state, carry table, airdrop history, proposals). `DB_PATH=/data/keeper.db`.
3. Variables (service-level). Keypairs go in as **contents**, not paths:
   - `KEEPER_KEYPAIR_JSON` = `base64 -w0 keypairs/keeper.json` (a JSON byte array, base58 secret, or base64 of either is accepted)
   - `DEV_WALLET_KEYPAIR_JSON` = same for `keypairs/dev-wallet.json`
   - `RPC_URL` (Helius/Triton), `HELIUS_API_KEY`, `INDEX_MINT`, `LOOKUP_TABLE`, `COIN_MINT`, `METEORA_POOL`, `TREASURY_WALLET`, `FEE_RESERVED_UNITS`
   - `MOCK_MODE=false`, `DRY_RUN=true` first (see §5), then `false`
   - `PORT=8787`, `CORS_ORIGIN=https://fi6900.vercel.app,https://<custom domain>` (comma-separated; `*` is fine for a read-only API)
   - `ADMIN_TOKEN` (long random string), `RECONSTITUTION_MODE=manual`, `AIRDROP_DENYLIST`, `LOG_LEVEL=info`
   - for a static-price rehearsal only: `PRICE_SOURCE=static`, `STATIC_PRICES_JSON_INLINE` = the JSON (or its base64)
4. `railway up --detach` from the repo root (uploads the working tree and builds the Dockerfile), or connect the GitHub repo in the dashboard for deploy-on-push.
5. `railway domain` (or the dashboard) → `https://<service>.up.railway.app`. Verify `GET /health` → `data.mode == "live"`, `GET /v1/fund`, `GET /v1/verify`.
6. Redeploy: `railway up --detach` (code) or `railway redeploy` (same image, new env). Logs: `railway logs`.
7. Rotate the keeper key: generate a new keypair, `set_rebalancer` / `set_fee_recipient` to it through the timelock (`queue_action` kinds 2 and 3), move the fee units + SOL, update `KEEPER_KEYPAIR_JSON`, redeploy. Rotate `ADMIN_TOKEN` by changing the variable (redeploys automatically).

### Site on Vercel

The `fi6900` project (team `xperts-projects-6c5c6371`) is linked at the repo root (`.vercel/project.json`), root directory `apps/web`.

1. Environment variables (Production **and** Preview), via `npx vercel env add <NAME> production` or the dashboard:
   `NEXT_PUBLIC_API_URL=https://<keeper domain>` (no trailing slash), `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CLUSTER=mainnet-beta`,
   `NEXT_PUBLIC_INDEX_MINT`, `NEXT_PUBLIC_PROGRAM_ID=Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV`, `NEXT_PUBLIC_LOOKUP_TABLE`, `NEXT_PUBLIC_COIN_MINT`.
   `NEXT_PUBLIC_*` values are baked in at build time, so every change needs a redeploy.
2. `npx vercel deploy --prod --yes --scope xperts-projects-6c5c6371` from the repo root.
3. Verify on https://fi6900.vercel.app: no amber "Demo data" banner, the pill reads Live, `/verify` shows the vaults and the upgrade authority, Solscan links have no `?cluster=` suffix (mainnet).
   The in-page "Devnet test wallet" adapter is registered only when `NEXT_PUBLIC_CLUSTER !== "mainnet-beta"`.

## 6. Enable the flywheel and the first auction

1. Set `DEV_WALLET`, `COIN_MINT`, `METEORA_POOL`, `TREASURY_WALLET`, `AIRDROP_DENYLIST` (the Meteora pool, Raydium/PumpSwap pool accounts, known CEX wallets — PDAs are excluded automatically), `ADMIN_TOKEN`.
2. Flip `DRY_RUN=false`. Restart. The first `nav-snapshot` pushes `set_ref_price` for every asset whose price moved since launch.
3. **Before the first auction** confirm `keeper governance` / `/v1/holdings` show a fresh ref price for every constituent: `start_auction` is rejected with `RefPriceUnset` otherwise, and with `PriceBelowBound` if the keeper's curve would end more than `max_auction_discount_bps` (5%) below `ref_sell / ref_buy`. The rebalancer lifts its end price to the bound automatically and logs it.
4. First cycle to verify on-chain (every row is in `/v1/flywheel/events` with a signature):
   - `claim` — SOL moved from the pump/PumpSwap creator vaults to the dev wallet.
   - `buy_index` + `add_lp` — a Meteora position NFT owned by the dev wallet (`position` field).
   - `create` — units minted to the dev wallet; `airdrop_pool_units` in `kv` increased.
   - `airdrop` — batches of ≤ 18 transfers; `GET /v1/airdrops/<any holder>` lists the payout; `carry` table holds dust wallets.
5. After the first hour: `fee_accrual`, `redeem`, `buyback`, `burn`, `treasury` events. Verify the `burn` signature on Solscan shows an SPL `BurnChecked` of $FIX6900.

## 7. Arm the timelock and hand over authority (Squads multisig)

Order matters: the timelock is armed by the keeper while it is still the (direct) authority, then the authority moves to the multisig.

1. `set_timelock(432_000)` from the keeper (≈ 48 h at 400 ms slots; the SDK constant `MAINNET_TIMELOCK_SLOTS`). From now on every admin change except `set_paused` is a `queue_action` → wait → `execute_action`; `keeper governance` lists what is pending and `/v1/governance` shows it publicly. Lowering the timelock is itself timelocked.
2. `propose_authority(<squads vault pda>)` from the keeper, then `accept_authority` **from the Squads vault** (the multisig signs a transaction whose only instruction is `accept_authority` with the vault PDA as `pending_authority`). The keeper stays `rebalancer` and `fee_recipient`.
3. From now on the keeper logs `keeper is not the fund authority; queue this action from the multisig: <kind> <payload>` at each reconstitution. The multisig queues the printed `add_asset` / `begin_remove_asset` / `set_target_weight` actions (or any fee / discount / ref-price override) via `queue_action`; the keeper's `execute-actions` job executes them after 48 h. `set_paused` from the multisig stays instant.
4. Verify: `/v1/governance.fundAuthority` is the Squads vault, `timelockSlots "432000"`, `pending` empty; `keeper approve <mint> --immediate` now fails with the "queue this action from the multisig" message.

## 8. Program upgrade authority: hand over, then burn

The site's `/verify` and `GET /v1/verify` show `upgradeAuthority` (read from the BPF upgradeable loader's ProgramData account). Launch with the multisig as upgrade authority; burn it once the program has run for a full reconstitution cycle without needing a fix.

```bash
# 1) hand the upgrade authority to the Squads vault (the current authority keypair signs)
solana program set-upgrade-authority Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV \
  --new-upgrade-authority <SQUADS_VAULT_PDA> --skip-new-upgrade-authority-signer-check \
  --upgrade-authority ~/.config/solana/deployer.json --url mainnet-beta

# 2) later, make the program immutable (irreversible); run from the Squads vault, or by the deployer before step 1
solana program set-upgrade-authority Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV --final \
  --upgrade-authority <current authority keypair> --url mainnet-beta
```

Verify: `solana program show Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV` prints `Authority: <SQUADS_VAULT_PDA>` (step 1) or `Authority: none` (step 2); `/v1/verify.upgradeAuthority` becomes the vault, then `null`.

## 9. Go-live checklist

- [ ] `/v1/verify` fields all non-null (`upgradeAuthority` = multisig until burned) and linked from the site's `/verify` page.
- [ ] `/v1/governance`: `timelockSlots` 432000, `fundAuthority` = Squads vault, `rebalancer` = `feeRecipient` = keeper, every constituent has a ref price.
- [ ] `/v1/fund.premiumBps` within ±75 most of the day (AP loop working).
- [ ] An auction was opened and filled (by a third party or self-fill) inside the ref-price bound and the index level was continuous across it (`nav_snapshots.divisor` changed, `index_level` did not jump).
- [ ] Airdrop round completed; dust carried; no transfers to PDAs/pools.
- [ ] Burn signature visible on `/flywheel`.
- [ ] Announcement for the next reconstitution appears ≥ 48 h before the 1st; its proposals are visible on `GET /v1/proposals`.
- [ ] Backups of `data/keeper.db` and all keypairs; the Squads vault has ≥ 3 signers and a tested `set_paused` rehearsal.
- [ ] `KILL_SWITCH` procedure rehearsed.
