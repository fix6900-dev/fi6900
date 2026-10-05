# FI6900 mainnet go-live — operator sequence

Terse, copy-pasteable version of `docs/launch-runbook.md`, written against the CLI commands and env vars that exist in
`apps/keeper/src/cli.ts` / `apps/keeper/src/config/env.ts` today. The devnet rehearsal of every step is in `docs/devnet.md`.
Run from the repo root unless a `cd` is shown. Solana/Anchor commands run in WSL (see `Anchor.toml`); Node/pnpm on the host.

**Legend** — 🔑 needs a wallet only you hold (deployer / Squads signers / dev wallet) · 💰 spends real SOL · 🔐 a secret
that goes into Railway/Vercel. Everything else is read-only or uses the keeper key.

## 0. Prerequisites (once)

| Item | Where / how |
|---|---|
| 🔑💰 **Fresh deployer** keypair, ≥ 6 SOL (program rent ~4.8 SOL for the 685 KB .so + fees) | `solana-keygen new -o keypairs/mainnet-deployer.json` — fund it from an exchange / your main wallet |
| 🔑💰 **Keeper** keypair, ≥ 5 SOL + the basket seed (e.g. 25 SOL; size it with the launch report §2) | `solana-keygen new -o keypairs/mainnet-keeper.json` |
| 🔑💰 **Dev wallet** (pump.fun coin creator), ≥ 1 SOL | `solana-keygen new -o keypairs/dev-wallet.json` |
| 🔑 **Squads vault** (https://app.squads.so, ≥ 3 signers, mainnet) | note the **vault PDA** — it becomes fund authority (§7) and program upgrade authority (§8) |
| 🔐 `HELIUS_API_KEY` (**required**: holder snapshots via DAS, non-rate-limited RPC) | https://dashboard.helius.dev → `RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>` |
| 🔐 `JUPITER_API_KEY` (recommended) | https://portal.jup.ag — without it the free `lite-api.jup.ag` tier (2 s between calls) is used |
| 🔐 `COINGECKO_API_KEY` (optional demo key) | https://www.coingecko.com/en/developers/dashboard — raises the monthly quota for the daily methodology run |
| Tooling | Node 22, pnpm 10, Anchor 0.31.1 + Solana CLI 2.3 in WSL; `pnpm install`; `pnpm --filter @fi6900/keeper test` green; `pnpm test:program` green on a local validator |
| Live contract tests on launch day (read-only) | `cd apps/keeper && LIVE=1 pnpm exec vitest run test/live --no-file-parallelism` |

Keeper env for the launch steps lives in `apps/keeper/.env` (copy from `.env.example`). Minimum for §3–§4:

```bash
MOCK_MODE=false
DRY_RUN=true                       # flip per step below
RPC_URL=https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>
HELIUS_API_KEY=<key>
JUPITER_API_KEY=<key>              # optional
COINGECKO_API_KEY=<key>            # optional
KEEPER_KEYPAIR=../../keypairs/mainnet-keeper.json
DEV_WALLET=../../keypairs/dev-wallet.json
PRICE_SOURCE=live
PRIORITY_FEE_MICROLAMPORTS=50000
INDEX_MINT=                        # filled by §3
LOOKUP_TABLE=                      # filled by §3
FEE_RESERVED_UNITS=0               # filled by §3
COIN_MINT=                         # filled by §1
METEORA_POOL=                      # filled by §4
TREASURY_WALLET=<pubkey receiving the 25 % treasury share>
```

## 1. 🔑💰 Create the $FIX6900 coin on pump.fun (dev wallet)

Manual, in the browser, **signing with the dev wallet** (the creator receives the creator fees the flywheel claims).
Name / ticker `FI6900 Coin` / `FI`. Then:

```bash
echo "COIN_MINT=<mint>" >> apps/keeper/.env
cd apps/keeper && pnpm keeper snapshot-holders --mint <COIN_MINT>        # holders > 0 via DAS
```

## 2. 🔑💰 Deploy the program (fresh deployer = initial upgrade authority)

```bash
# WSL — build exactly as Anchor.toml says
anchor build --no-idl -- --tools-version v1.52
anchor idl build -o target/idl/fi6900.json -t target/types/fi6900.ts
cp target/idl/fi6900.json packages/sdk/idl/ && cp target/types/fi6900.ts packages/sdk/src/types/
pnpm --filter @fi6900/sdk build

# deploy (program id Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV = target/deploy/fi6900-keypair.json)
solana program deploy target/deploy/fi6900.so \
  --program-id target/deploy/fi6900-keypair.json \
  --keypair keypairs/mainnet-deployer.json --upgrade-authority keypairs/mainnet-deployer.json \
  --url https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY> --use-rpc --max-sign-attempts 60 --with-compute-unit-price 50000
solana program show Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV -u <same url>     # Authority: <deployer>
anchor idl init -f target/idl/fi6900.json Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV \
  --provider.cluster <same url> --provider.wallet keypairs/mainnet-deployer.json
```

Record the deploy signature and `sha256sum target/deploy/fi6900.so` (→ `/v1/verify.idlHash` via
`sqlite3 data/keeper.db "insert into kv values('idl_hash','sha256:<hash>',datetime('now'))"` once the keeper DB exists).

## 3. 💰 Initialise the fund (keeper key)

**3a. Approve the basket first** (read-only, ~2 min with `JUPITER_API_KEY`, 10–15 min without):

```bash
cd apps/keeper
INDEX_MINT=11111111111111111111111111111111 pnpm keeper launch-report --seed 5,10,25,50 --out ../../docs/launch-constituents.md
```

Review `docs/launch-constituents.md` (proposed 40 × 250 bps, alternates, exclusions, seed-impact table). Anything the
committee rejects goes into `eligibility.denylist` in `src/config/methodology.config.ts`; re-run, commit the report.
Pick the largest `--sol` whose worst leg is ≤ 1 % impact.

**3b. init-fund** (dry first, then live). It generates the index mint, `initialize_fund(50,50,100, timelock 0)`,
runs the methodology and `add_asset`s every selected constituent, sets every ref price, creates the lookup table,
buys the basket through Jupiter pro-rata, transfers it into the vaults and `bootstrap_mint`s so NAV = $1.00:

```bash
cd apps/keeper
pnpm keeper init-fund --sol 25 --basket apps/keeper/config/launch-basket.json --dry
DRY_RUN=false pnpm keeper init-fund --sol 25 --basket apps/keeper/config/launch-basket.json          # prints INDEX_MINT=, INDEX_MINT_SECRET=, LOOKUP_TABLE=, FEE_RESERVED_UNITS=
```

Save `INDEX_MINT_SECRET` offline. Put `INDEX_MINT`, `LOOKUP_TABLE`, `FEE_RESERVED_UNITS` into `.env`
(`FEE_RESERVED_UNITS` = the bootstrap units; without it the hourly fee job would redeem the seed position).

Adjusting the basket while timelock is still 0 (direct, keeper is authority):

```bash
pnpm keeper add-asset <mint> --weight 250 --immediate        # manual add (validates revoked authorities; --force skips)
pnpm keeper remove-asset <mint> --immediate
pnpm keeper approve <mint> --weight 250 --immediate          # approve a methodology proposal (keeper proposals)
pnpm keeper execute-actions                                  # applies the queued actions (eta = now at timelock 0)
pnpm keeper set-ref-prices                                   # push ref prices again if anything was added
pnpm keeper governance                                       # timelockSlots "0", pending [], authorities
```

Verify (`MOCK_MODE=false DRY_RUN=true pnpm keeper run` locally, or after §5): `/v1/verify.mintAuthority == fundPda`,
`/v1/fund.supply > 0`, `navPerUnitUsd ≈ 1.00`, `/v1/holdings` 40 rows ≈ 250 bps, `/v1/governance` every asset has a ref price.

## 4. 💰 Secondary market: Meteora DAMM v2 pool at NAV (keeper key)

```bash
cd apps/keeper
pnpm keeper create-pool --units 2000 --config 1 --dry                 # prints pool PDA, SOL needed, implied price
DRY_RUN=false pnpm keeper create-pool --units 2000 --config 1         # prints METEORA_POOL=
```

Put `METEORA_POOL` in `.env` and **reduce `FEE_RESERVED_UNITS` by the units deposited**. Verify Jupiter routes
`SOL → INDEX_MINT` (`curl "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=<INDEX_MINT>&amount=100000000&slippageBps=100"`)
and `/v1/fund.marketPriceUsd` becomes non-null.

## 5. 🔐 Railway: flip the hosted keeper to mainnet

Service `keeper` in project `fi6900` (ids in `docs/devnet.md`). Set in one go (`railway variables --set K=V ...`,
the dashboard, or the Railway MCP `set-variables`); changing variables redeploys:

```bash
MOCK_MODE=false
DRY_RUN=true                                  # 48 h soak first (docs/operations.md §7), then false
RPC_URL=https://mainnet.helius-rpc.com/?api-key=<HELIUS_API_KEY>
HELIUS_API_KEY=<key>
JUPITER_API_KEY=<key>
COINGECKO_API_KEY=<key>
PRICE_SOURCE=live                             # and DELETE STATIC_PRICES_JSON_INLINE
KEEPER_KEYPAIR_JSON=$(base64 -w0 keypairs/mainnet-keeper.json)
DEV_WALLET_KEYPAIR_JSON=$(base64 -w0 keypairs/dev-wallet.json)
INDEX_MINT=<§3>  LOOKUP_TABLE=<§3>  FEE_RESERVED_UNITS=<§3 minus §4 units>
COIN_MINT=<§1>  METEORA_POOL=<§4>  TREASURY_WALLET=<pubkey>
AP_ENABLED=true  FLYWHEEL_ENABLED=true  REF_PRICE_UPDATES=true  RECONSTITUTION_MODE=manual
AIRDROP_DENYLIST=<METEORA_POOL>,<other pool / CEX wallets>
PRIORITY_FEE_MICROLAMPORTS=50000
NAV_SNAPSHOT_SEC=60  REBALANCE_CHECK_SEC=60  AUCTION_MONITOR_SEC=15  ACTION_EXECUTE_SEC=60  AP_CHECK_SEC=30  DIST_INTERVAL_MIN=15
ADMIN_TOKEN=<new long random>                 # rotate from the devnet one
CORS_ORIGIN=https://fi6900.vercel.app         # add the custom domain, comma-separated
DB_PATH=/data/keeper.db  PORT=8787  LOG_LEVEL=info
```

Then `railway redeploy` (same image) or `railway up --detach --service keeper` (new code). Verify
`GET /health` → `data.mode == "live"`, `/v1/fund`, `/v1/verify` (`upgradeAuthority` = deployer for now), `/v1/governance`.
After the soak: `DRY_RUN=false`, watch the first `nav-snapshot` / `auction-monitor` / `ap-check` / `flywheel` cycles.

## 6. 🔐 Vercel: flip the site to mainnet

```bash
for t in production preview; do
  npx vercel env rm NEXT_PUBLIC_CLUSTER $t --yes --scope xperts-projects-6c5c6371
  echo -n mainnet-beta | npx vercel env add NEXT_PUBLIC_CLUSTER $t --scope xperts-projects-6c5c6371
  # same pattern for NEXT_PUBLIC_RPC_URL (a public mainnet RPC or your Helius url), NEXT_PUBLIC_INDEX_MINT,
  # NEXT_PUBLIC_LOOKUP_TABLE, NEXT_PUBLIC_COIN_MINT; NEXT_PUBLIC_API_URL stays the Railway domain,
  # NEXT_PUBLIC_PROGRAM_ID stays Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV
done
rm -rf apps/web/.next && npx vercel deploy --prod --yes --scope xperts-projects-6c5c6371
```

Verify https://fi6900.vercel.app: no "Demo data" banner, LIVE pill, 40 holdings, Solscan links without `?cluster=`,
no "Devnet test wallet" in the wallet modal (`NEXT_PUBLIC_CLUSTER=mainnet-beta` disables it).

## 7. 🔑 Harden: arm the timelock, hand the fund authority to Squads

There is no CLI subcommand for `set_timelock` / `propose_authority`; they are single-instruction transactions built
with the SDK (`packages/sdk/src/client.ts`: `setTimelockIx`, `proposeAuthorityIx`, `acceptAuthorityIx`,
`setRebalancerIx`, `setFeeRecipientIx`). Save the snippet below as `apps/keeper/scripts/harden-mainnet.ts` and run it
from `apps/keeper` with the keeper key (still the authority):
`SQUADS_VAULT=<vault pda> pnpm exec tsx scripts/harden-mainnet.ts` (reads `KEEPER_KEYPAIR`, `RPC_URL`, `INDEX_MINT` from `.env` via `--env-file=.env`).

```ts
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Fi6900Client, MAINNET_TIMELOCK_SLOTS } from "@fi6900/sdk";
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEEPER_KEYPAIR!, "utf8"))));
const c = new Connection(process.env.RPC_URL!, "confirmed");
const client = new Fi6900Client(c, new PublicKey(process.env.INDEX_MINT!));
const vault = new PublicKey(process.env.SQUADS_VAULT!);
const tx = new Transaction()
  .add(await client.setTimelockIx(kp.publicKey, MAINNET_TIMELOCK_SLOTS))   // 432000 slots ≈ 48 h
  .add(await client.proposeAuthorityIx(kp.publicKey, vault));
console.log(await sendAndConfirmTransaction(c, tx, [kp]));
```

Then **from the Squads vault** (🔑 the signers approve in the Squads UI) send one transaction whose only instruction
is `accept_authority` with the vault PDA as `pending_authority` — build it with `client.acceptAuthorityIx(vault)` and
import it into Squads (or paste the instruction data). The keeper stays `rebalancer` and `fee_recipient`.

Verify: `pnpm keeper governance` → `fundAuthority` = vault, `timelockSlots "432000"`, `pending []`;
`pnpm keeper approve <mint> --immediate` now prints "queue this action from the multisig". From here every admin
change is `queue_action` from Squads (kinds: 0 set_fees, 1 set_target_weight, 2 set_rebalancer, 3 set_fee_recipient,
4 ref_price_override, 5 set_max_auction_discount, 6 set_timelock, 7 add_asset, 8 begin_remove_asset,
9 set_ref_move_policy) and the keeper's `execute-actions` job applies it after 48 h. `set_paused` stays instant.

## 8. 🔑 Program upgrade authority: dev keeps it at launch, later the Realms DAO, `--final` optional

**Launch:** the deployer keypair (`keypairs/mainnet-deployer.json`) stays the upgrade authority and this is disclosed on `/verify`
(`/v1/verify.upgradeAuthority` = deployer). Rationale: the first weeks are when a fix is most likely to be needed (the devnet
fee-on-transfer upgrade is the precedent) and a single key can ship one in minutes; the fund authority (§7) is already
behind the Squads timelock, so an upgrade cannot move funds without a passed timelocked action. Keep the deployer offline
except for upgrades; publish the program hash (`sha256sum target/deploy/fi6900.so`) with every upgrade.

**Later (with §8b):** hand the upgrade authority to the Realms DAO so upgrades execute only through passed proposals —
Realms has native "Upgrade program" proposals (BPF Upgradeable Loader `Upgrade` instruction with the governance PDA as
authority; the proposer uploads the new buffer with `solana program write-buffer`, sets the buffer authority to the
governance PDA and references it in the proposal):

```bash
# WSL, signed by the deployer; the governance PDA is the DAO's program-governance account from Realms
solana program set-upgrade-authority Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV \
  --new-upgrade-authority <REALMS_PROGRAM_GOVERNANCE_PDA> --skip-new-upgrade-authority-signer-check \
  --upgrade-authority keypairs/mainnet-deployer.json --url <mainnet rpc>
solana program show Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV --url <mainnet rpc>      # Authority: <governance pda>
```

**Optional, future:** once the program has gone through a full reconstitution cycle without a fix and the DAO decides it
wants immutability, a Realms proposal can run `set-upgrade-authority --final` (irreversible; `Authority: none`). This is a
DAO decision, not a launch step.

`/v1/verify.upgradeAuthority` and the site's `/verify` follow (deployer → governance PDA → `null` if ever finalised).

### How to ship a program fix (while the dev holds the authority)

```bash
# 1. build + IDL (WSL, see Anchor.toml)
CARGO_TARGET_DIR=~/fi6900-target anchor build --no-idl -- --tools-version v1.52
anchor idl build -o target/idl/fi6900.json -t target/types/fi6900.ts && ~/copy-artifacts.sh
# 2. tests on a local validator (host): ~/validator.sh in WSL, then
pnpm test:program && pnpm --filter @fi6900/keeper test
# 3. upgrade in place (program id unchanged; the buffer needs rent for the full .so, refunded on upgrade)
solana program write-buffer target/deploy/fi6900.so --buffer-authority <deployer pubkey> -k keypairs/mainnet-deployer.json --url <rpc>
solana program extend Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV <extra bytes> -k keypairs/mainnet-deployer.json --url <rpc>   # only if the .so grew
solana program upgrade <BUFFER> Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV --upgrade-authority keypairs/mainnet-deployer.json -k keypairs/mainnet-deployer.json --url <rpc>
#    (or the one-shot `solana program deploy target/deploy/fi6900.so --program-id target/deploy/fi6900-keypair.json --upgrade-authority keypairs/mainnet-deployer.json`, which detects the existing program)
anchor idl upgrade -f target/idl/fi6900.json Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV --provider.cluster <rpc> --provider.wallet keypairs/mainnet-deployer.json
# 4. ship the matching SDK everywhere that builds transactions
cp target/idl/fi6900.json packages/sdk/idl/ && cp target/types/fi6900.ts packages/sdk/src/types/ && pnpm --filter @fi6900/sdk build
railway up --detach --service keeper                                         # hosted keeper
rm -rf apps/web/.next && npx vercel deploy --prod --yes --scope xperts-projects-6c5c6371   # site (bundles the SDK)
# 5. record: deploy signature, `sha256sum target/deploy/fi6900.so` -> kv idl_hash, docs/devnet.md-style log entry
```

Rules for a fix once a fund exists:
- **Account layouts are append-only.** `Fund` (`reserved: [u8; 64]`) and `Asset` (`reserved: [u8; 32]`) hold the money: new fields are carved out of the `reserved` tail, never inserted, reordered or resized; the account size must not change. `Auction` and `PendingAction` have no reserved bytes — change them only while none is open. `MintSession` / `RedeemSession` are minutes-lived; their layout may change if no session is open across the upgrade and the change is documented in ARCHITECTURE.md §2.
- Instruction arguments may change (the Anchor discriminator is the instruction *name*), but every client must ship the new IDL at the same time — old transactions fail to deserialise until the SDK on Railway/Vercel is redeployed. Adding a trailing `Option<T>` argument (as the fee-on-transfer upgrade did for `deposit` / `fill_auction`) still requires the one extra byte, so it is not wire-compatible with old clients either.
- Upgrade when `open_auctions == 0` and no mint/redeem session is open (check `/v1/auctions?status=open`; sessions are visible with `getProgramAccounts` on the session discriminators), so no in-flight flow straddles two program versions.
- If the .so grew, `solana program extend` first (rent for the extra bytes); the deployer needs the buffer rent (~3.5 SOL for 690 KB) up front, which the upgrade refunds.

## 8b. 🔑 Later (week 2+): `$FIX6900` as the voting token via Realms

Do this only once `$FIX6900` has enough holders for a vote to mean something. Nothing in the program changes; the fund authority simply becomes a DAO governance account instead of the Squads vault.

1. **Create the DAO** at https://app.realms.today → Create DAO → "Multi-sig / Community token" → community token = the `$FIX6900` mint (`COIN_MINT`). Settings to start with:
   - Voting: one token = one vote; voting period 3 days; approval quorum 20% of deposited supply; proposal threshold 0.5% of supply (raise later).
   - Council: your Squads signers as the council, with veto on community proposals. Keep this for the first months.
   - Realms creates a **governance account** (a PDA). That pubkey is the new fund authority.
2. **Move the fund authority** Squads vault → Realms governance: from Squads run `propose_authority(<REALMS_GOVERNANCE_PDA>)` (same SDK script as §7, signed through Squads), then a Realms proposal that executes `accept_authority`. Verify `/v1/governance.fundAuthority == <governance pda>`.
3. **What a proposal can do** = the timelocked `queue_action` kinds (fees ≤ 10%, target weights, add/remove constituent, rebalancer, fee recipient, ref-price override, max auction discount, timelock length) and, once §8's transfer has happened, **program upgrades** (Realms' native "Upgrade program" proposal against the governance-owned upgrade authority). The 48h timelock still runs after a vote on fund parameters passes, so dissenting holders can redeem first; an upgrade executes when the proposal passes, so set the DAO's own voting period / hold-up time accordingly.
4. **Keep emergency pause outside the DAO.** `set_paused` is instant and protective; leave it with the council/Squads. A vote is too slow for an exploit, and pause can never move funds.
5. **Keeper**: nothing to change. The methodology keeps writing proposals (`/v1/proposals`); the committee step becomes "post the approved list as a Realms proposal". The `/admin` page remains useful for triage, but approve/execute now happen through Realms. Set `RECONSTITUTION_MODE=manual` (unchanged) so the keeper never queues on its own.
6. **Announce the rules** on `/methodology`: who can propose, quorum, timelock, what is out of scope.

## 9. Go-live checklist (from `docs/launch-runbook.md` §9)

- [ ] `/v1/verify` all non-null; `/v1/governance` timelock 432000, authority = vault, rebalancer = feeRecipient = keeper, every ref price set
- [ ] `/v1/fund.premiumBps` within ±75 most of the day (AP loop)
- [ ] one auction opened and filled inside the ref bound; index level continuous
- [ ] first flywheel cycle: claim / buy_index + add_lp / create / airdrop / burn signatures on `/flywheel`
- [ ] backups of `/data/keeper.db` (Railway volume) and every keypair; `KILL_SWITCH=true` and `set_paused` rehearsed
