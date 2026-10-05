# FI6900 on devnet

Public devnet deployment of the whole stack: program, fund, hosted keeper (Railway) and the site (Vercel).
Everything below is **devnet** — test mints, valueless SOL, timelock 0. Addresses and signatures of the current
deployment live in `keypairs/devnet.json` (gitignored); the ones that are public are repeated here.

## What is deployed

| Piece | Where | Value |
|---|---|---|
| Program | devnet | `Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV` (upgrade authority = `keypairs/devnet-deployer.json`, `AdCRaoBX278PyAr4pj1FeYRgK5RmyXKHP6SBBP6ui8Fr`; ProgramData `8vSvZadx7aA8Zg5SVrs3ybqA7DJTLWG5qoB58P1bpUfp`; IDL account `3eE9tJogz92RXnyEuLHBY7zJVwx6urKV9cTBkQxBf7So`) |
| Fund | devnet | index mint `8YBr1zsx7mYv9YGhszdV5R3MxjugAjEq2PEQjta4G9L5`, fund PDA `7yGHxLrFwdtmTqjUtvRPVrVPKCPfo2fqLULP2WjtEL2D`, lookup table `539SQc1V6EyWJHQKxAW1WnbMeZyzbGT2ZZi3Z41CLFtu`; 12 equal-weight test mints at 833 bps, bootstrapped at 1,000,000 units / NAV $1.00, timelock 0 (full list incl. mints, vaults and every signature in `keypairs/devnet.json`) |
| Keeper | Railway project `fi6900` / service `keeper` | https://keeper-production-94c7.up.railway.app (`/health`, `/v1/*`), volume `/data`, Dockerfile build |
| Site | Vercel project `fi6900` (team `xperts-projects-6c5c6371`) | https://fi6900.vercel.app |
| Wallets | `keypairs/` (gitignored) | `devnet-deployer.json` (upgrade authority), `devnet-keeper.json` (fund authority = rebalancer = fee_recipient), `devnet-ap.json` (AP), `devnet-burner.json` (browser test wallet) |

Prices, market data and token metadata come from `keypairs/devnet-prices.json` (`PRICE_SOURCE=static`,
shipped to Railway as `STATIC_PRICES_JSON_INLINE`). There is no secondary market, so `marketPriceUsd` /
`premiumBps` are `null` and the AP loop / flywheel are disabled.

### Deployment log (2026-10-04, devnet)

Every transaction below is on devnet: `https://solscan.io/tx/<sig>?cluster=devnet`.

| Step | Signature / result |
|---|---|
| `solana program deploy` (685,376 bytes, slot 507478180) | `4ZNvCNvA2AeJhTEZc7nU1Ew1QNF5KM1Kp7QuQXH9HE47MCey3cSEbYV9bmfwYcw8NpprgQfMSUVEh2hz9XQ6YrU1` |
| `anchor idl init` | IDL account `3eE9tJogz92RXnyEuLHBY7zJVwx6urKV9cTBkQxBf7So` |
| create index mint | `2mP5ELkLYM2rtA7wGhTZGn2pHXeVzVYLJHoisMXrGozJv8apRvVQJf7GM7Sgdao27nfHGRHwgn6dgR9sw4ekBjcK` |
| `initialize_fund(50,50,100, timelock 0)` | `4vj5iso3FGpAymdbUeiu2XPFbvQb5eJSSEL2PTREnb3RkBc8LySeCBBH3LMkNdarX4NkZXzP8bi3hSK9KBo5VLZy` |
| `add_asset` × 12 (833 bps), `set_ref_price` × 12, LUT create + extend, 12 vault seeds | in `keypairs/devnet.json` → `signatures` |
| `bootstrap_mint` 1,000,000 units | `3zVrqt5G21WfG5R3CxDvf4rodD13dLXECykWWypBgyFhJEmNjkXzNGfBcxsFKjus2bFTeRJNtEzxQrjSSpTMSCSd` |
| AP `create 10000` (begin → 2 deposit batches → finalize; supply 1,000,000 → 1,010,000.07) | `pB21YwymNSE1ADpjdkxvqLqcADb1yM7k8wnyxJLR684gZk28RHBgjDJuFR52V4mw3fGotEUdXejQx1ZYReQudSe`, `2p1494ir9rCbpKuAGrBJziKKiyB5w7eG4Wa9cHRXLCBNtgHQXxNakMAf2ZJRi2BWLM5heehHpT5v1owq73UhqsMH`, `yxoFSdB53TRepV7dimA3dw2jgi2gdcp2oibJ1veQkvqGwETbZQTSzexNUNx6zcd6HFfASMFsAxGrLmyG1XMPpC3`, `2ERpC4GGgtDBdpFXuFq2DxzmDQZKDENZngDmAV1Gedmx1tLAUTPxbeiNoDR5y3Edtt1NCv2jxbjzEHTr4FJtVRVT` |
| `set-price WIF 2.25` → `keeper rebalance`: 11 `start_auction` (sell WIF → every other constituent, $5,575 each) | first: `3zNU7PrPWeSi3e6ZuxHxdhdpVsgi3vKjDAatofUE8iuDLFfkEfgP7Ew9QoBM87D9J85zxb1ZjvjyWxshcv1fVJEm` (auction `8xfsWkQ9H7jnfAXSisMwQqN3wSvXxM4YWQvJ8x3ntJAr`) … last: `h1hfToKbmQozMj3LE8A4MoKJDwv5SLFTP72qGWWrW5XUhvjpxUZPKXroPwv5pGuVDNu27UUZUaiiP8Tw1iWMvzT` (`NKLimGMhRWnAoLj81hBb6arg6YvAQrLzqSCa62zYs8K`) |
| keeper `run` (local, live): expired auctions cancelled, re-opened, 7 self-fills from inventory | e.g. `fill_auction Ddo5ySrofYSUPr4Cvj2VVgMbCY1rRHjXtXNGyN2gjq48` → `4mKVZT7BTAsuLqGuf5s5CdUpNLDRmphTvTrPJiCJRRAkvyNW8FF3ti9Vb6dTJjQjMmKFub7zefqBU7SAXvcd3NG1` |
| AP `fill` (third-party filler, 3 auctions) | `4GQwtfs8PFGsRjHqNypkpAiDVvr7W1svtcAmH86ejk5Q8LUSziCh2kgbCqeY2SFMSwJ14Cace3FM1GGhVivajyYW` (`F8GJr967ra61W94o2MthgTHdpp73XCsaK51PFC1Apgzo`), `2Q2BimDmM6BxbYGCYhXxBMApxfaGT7V6dzaL8aLzamVEySuaAhB9s9x3m3NH7hgTv5ddZEfvABcZiXCf8LJnowM9` (`BrFFjzxbRLST2wJ8p18Kqu6Gt3QcSJ4gcC3HAerEFh8B`), `ybnPujiQHdxMsfvJbaEPHV4RzPwEpdKg3RHZthc6ekW7qY1CkVYjj3xrFuCpUmNnEo6RXC8Sh2BvkU8gHUXXaBu` (`5GiVHiMwtFTw1M2seGTrWL2vjPU1sobXsbfUGzBDTKof`) |
| AP `redeem 5000` (begin → 2 withdraw batches → close; supply → 1,005,025.25) | `5L8AfqJ7j4pgWYZNTnPWmEZMwzg3zL9bhhnwsLX7paG224UkZgYz2U94acmbqd7xxWTNPxL8ZRw2ZnMM113CN2Cv`, `3Sy4AjJ1Rr4UZo4sGTSbktKFj4cCsf1NSpfEZ23HZn6zQE9EEzsQpMzmXnz24AJUQrKwpq561yBVC1P6XSwc4a8a`, `5t9gh7phGq5nZkE6MzG2m2CotXxxqA5uiTrUpLrMSwrUJucDwhLituAvnzXLCTZBQW5LohZmDgsRMS3hemzW1kYB`, `5L2Q1Wtis4vTZLQtfPtKJFKiDuPu2YBn4d3Wzx9dDfjnJHh8BK8dMD9a7qVKcAhPH19UjH2pX7ytNJwGBFF3p4Nd` |
| browser create of 50 units on https://fi6900.vercel.app/create (Devnet test wallet `4cqWmxd4YZctgMTed7J3sBcFggEmETiTsMKjAnWTGKNG`; supply → 1,005,075.50) | `begin_mint` `3iXpEJaJJ4DbC8GmnzL1nZCCp2qyrYP9dWXmtaVmhXUtUKZh8kWQNsfGSozCdcaTY5kLnefQiKLRNjrZnHPVe3gb`, deposits `CJuKEeFSMufb9qPUp41CvJnxpUwLM5ZhQVhiS4fagC3W4XW1npY7H2GYJ2QRN5E6y37JMWou2cxy4LikNYVbS6r` + `3sxbqDSFfX62nuDTdw9P7G8ZBZuwUkctbJx4Frn5dSa9VFhC8PiyfYV5zb6gx7ejBgfj8PAm5ZMW4kZgxd63hNTi`, `finalize_mint` `MzG1HsMqc7nwAQ2fEtazPJtHmkL31wFiBguVNox7d7LC6Hm37LLt33JCVaamUMJUrBJs9STXvgQDtPpzoQMaRkh` |

### Upgrade log (2026-10-05, devnet): fee-on-transfer accounting

Program upgraded **in place** (program id unchanged; `Fund` / `Asset` layouts unchanged, so the live fund, its 12 vaults and the
lookup table carried over without a new `e2e:setup:devnet`). The change: `deposit(slot, gross_amount: Option<u64>)` and
`fill_auction(sell_amount, gross_buy_amount: Option<u64>)` credit vaults with the RECEIVED balance delta (`ShortDeposit` / `ShortFill`
on under-payment), so Token-2022 transfer-fee constituents can no longer under-collateralise the fund (ARCHITECTURE.md §2).

| Step | Signature / result |
|---|---|
| `solana program write-buffer` (689,464-byte .so; the deployer needed the 3.48 SOL buffer rent up front — the devnet faucet was rate-limited, so 1.0 / 0.15 SOL were borrowed from the keeper / AP wallets and returned after the upgrade) | buffer `DnYvzuLpRvCx1sJoNCVRTeGZ1zcwdxqYjkisSBocyJ6Y` |
| `solana program extend … 10240` (the loader's minimum; 685,376 → 695,616 bytes) | ok |
| `solana program upgrade <buffer> Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV` (slot 507679165, sha256 `aca856f3d51b9a42e44353cc2c92a28f72afa230fc78ea36b95d54ef7b1ca1f3`) | `5wG4FXVcroXYis3TNJkBRuu9aWSpWgMHpPsw8E8fmmo5HZpaV56LU96tL5nCkL5Qmuu2tTxL39m9tYgUwhvkfQ1D` |
| `anchor idl upgrade` | IDL account `3eE9tJogz92RXnyEuLHBY7zJVwx6urKV9cTBkQxBf7So` upgraded |
| `railway up --detach --service keeper` + `npx vercel deploy --prod` (both bundle the new SDK; the instruction arguments changed, so old clients fail to deserialise until redeployed) | https://fi6900.vercel.app aliased |
| AP `create 100` on the upgraded program (begin → 2 deposit batches → finalize, deposits with `gross_amount = None`) | `3JJyt1G163nxbb9R9DXgAiYBtFyiAtsmVxHwcYtJjSy19qwYMCcvQWKCAaPdSWhXY5QVDMnHv9zzQWpgpVGjjbvn`, `L6mu3piCseMtxU9Pp4oeBqw2oeF2gdr3HsZyjmsG75NeCUo9Msx8TVEMA7GvnQnsXAzPDT3TGBaD3uUvmu46jvk`, `4LszYnPrHsk9EEpdaBwaEqEgaaHqVHmbieDdtVWLTVojPQvNMAbjdC45KsecVQSniVNa3eDdz4fR7191cxddLRtU`, `4cn5g2exnv81DDbqnCczt1ASydbn7X8ULKhuT4s8iXRhQGRP9HU6Q5XJGULNJAZ4wsvuU8XKWMuXrbTHBrEqXC2y` |
| AP `redeem 50` (begin → 2 withdraw batches → close; supply 1,005,099.80 → 1,005,050.06) | `3D4maFcsk4dcWq44qY37r1RzGqX4ahmkTXkAJ473NtZMJ4wfCbNwTxCeDEGbsW9JmcMAzRRPU272nSH1zCzyTv1g`, `5jm8gBtgyyk4H6adF2QXF3hbppCHgN3DPH5hDbswBS3LWkbTemoUQKxYx9Lt7iD7Tb8C43xdErfarDaPAkPReQeT`, `3L5VmZmv3YgwJ1asj1c6R9vffKueViawx4nw3RJENqczvyWmbbCQ7Th8su44YtsNgwTAM8w6JQQu9b5NoWQ8Nd87`, `2XAXcF37PVDGAAR2isHubKh4nvPFi6yKPqxpDuzKMz6nPpEA1U5hUp1JqcfndnBJfY7odWf5EHHABJjiu2iqCJER` |

Live-site check (2026-10-04): https://fi6900.vercel.app shows the LIVE pill and no demo banner, 12 constituents, supply
1.01M; `/verify` reads mint authority = fund PDA, 12 vaults owned by the fund PDA, upgrade authority
`AdCRaoBX278PyAr4pj1FeYRgK5RmyXKHP6SBBP6ui8Fr`; `/auctions` lists the filled auctions; every Solscan link carries
`?cluster=devnet`; `/admin` loads. Hosted keeper: `GET /health` → `mode: live`, `/v1/fund` supply 1,005,075.50 with
12 holdings, `/v1/verify` as above, `/v1/auctions?status=all` 33 auctions (5 filled, 28 cancelled/expired),
`/v1/governance` timelock 0, authority = rebalancer = fee recipient = keeper.

Known wobble: the public devnet RPC rate-limits the hosted keeper too (`429` retries, websocket reconnects), so a
`/v1/verify` or `/v1/governance` call occasionally exceeds the site's 4 s client timeout and the amber "Demo data" banner
flashes until the next poll. A keyed RPC (`RPC_URL=https://devnet.helius-rpc.com/?api-key=…`) removes it.

Lessons from the deploy: on the public devnet RPC `solana program deploy --use-rpc` saturates the per-IP rate limit
(every request, its own included, gets 429) and crawls; the default TPU mode finished the same buffer in 20 s.
If a deploy is interrupted, `solana program show --buffers --buffer-authority <deployer>` lists the buffer and
`solana program deploy ... --buffer <addr>` resumes it (no SOL lost). Auctions on devnet last 150 slots ≈ 60 s
(`rebalance.auction.durationSlots`), so a third-party `fill` has to run right after `rebalance`; ended auctions stay
"open" on-chain until the keeper's auction-monitor cancels them (or `apps/keeper/scripts/expire-auctions.ts`, anyone may
expire after `end_slot`), and `begin_mint` / `begin_redeem` require `open_auctions == 0`.

## Reproduce from scratch

All Solana CLI work runs in WSL (Anchor 0.31.1 / Solana 2.3 live there; see `Anchor.toml`); everything else on the host.

```bash
# 0. keypairs + SOL (devnet faucet: ~6 SOL for the deployer, 2 for the keeper; https://faucet.solana.com or `solana airdrop`)
solana-keygen new -o keypairs/devnet-deployer.json; solana-keygen new -o keypairs/devnet-keeper.json
solana airdrop 2 $(solana-keygen pubkey keypairs/devnet-deployer.json) -u devnet   # rate limited; repeat

# 1. program (685 KB .so ~ 4.8 SOL rent)
solana program deploy target/deploy/fi6900.so --program-id target/deploy/fi6900-keypair.json \
  --keypair keypairs/devnet-deployer.json --upgrade-authority keypairs/devnet-deployer.json -u devnet --use-rpc
anchor idl init -f target/idl/fi6900.json Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV --provider.cluster devnet --provider.wallet keypairs/devnet-deployer.json

# 2. fund (12 mints + metadata, fund, assets, ref prices, LUT, vault seed, bootstrap; funds AP + burner from the keeper)
pnpm e2e:setup:devnet            # == tsx apps/keeper/scripts/fund-setup.ts --cluster devnet [--rpc <url>] [--assets 12] [--no-metadata]
#   writes apps/keeper/.env.devnet, apps/web/.env.devnet (+ .env.local; copy to apps/web-v2/.env.local), keypairs/devnet-prices.json, keypairs/devnet.json

# 3. prove it with the SDK (AP wallet) — every signature is printed
pnpm devnet:ap status
pnpm devnet:ap create 10000
pnpm devnet:ap set-price WIF 2.25 && pnpm --filter @fi6900/keeper run keeper:devnet rebalance   # opens the auctions (150 slots ≈ 60 s each)
pnpm devnet:ap fill              # run right after: third-party fill of every live auction (ended ones are skipped); the keeper also self-fills from its inventory
pnpm devnet:ap redeem 5000       # needs open_auctions == 0 (let the keeper's auction-monitor cancel ended auctions first, or `cd apps/keeper && pnpm exec tsx --env-file=.env.devnet scripts/expire-auctions.ts`)
```

`pnpm devnet:keeper` / `pnpm devnet:ap` go through the package scripts `keeper:devnet` / `ap:devnet` in `apps/keeper/package.json`
(`pnpm --filter … exec tsx --env-file=…` does not work with pnpm 10: the flag is swallowed). A local live keeper against the
devnet fund is `pnpm devnet:keeper` (stop it before the hosted one is live, or both will cancel/open auctions).

## Keeper on Railway

Service `keeper` in project `fi6900`, built from the repo-root `Dockerfile` (`railway.toml` sets the `/health` healthcheck).
Deploy from the repo root with the Railway CLI (`railway link` once, then):

```bash
railway up --detach --service keeper      # upload working tree + build + deploy
railway logs                              # runtime logs; `railway logs --build` for the build
railway redeploy                          # same image, picks up variable changes
```

Variables (service scope, production environment). Secrets are contents, never file paths:

| Variable | Value |
|---|---|
| `MOCK_MODE` / `DRY_RUN` | `false` / `false` |
| `RPC_URL` | `https://api.devnet.solana.com` |
| `KEEPER_KEYPAIR_JSON` | `base64 -w0 keypairs/devnet-keeper.json` |
| `INDEX_MINT`, `LOOKUP_TABLE`, `FEE_RESERVED_UNITS` | from `apps/keeper/.env.devnet` |
| `PRICE_SOURCE` / `STATIC_PRICES_JSON_INLINE` | `static` / `base64 -w0 keypairs/devnet-prices.json` (hot-reload is lost; change prices by updating the variable) |
| `DB_PATH` | `/data/keeper.db` (volume `keeper-data` mounted at `/data`) |
| `PORT`, `CORS_ORIGIN` | `8787`, `*` (read-only public API; tighten to `https://fi6900.vercel.app` if preferred) |
| `ADMIN_TOKEN` | random, also stored in `keypairs/devnet.json` (`adminToken`) |
| cadence | `NAV_SNAPSHOT_SEC=30 REBALANCE_CHECK_SEC=60 AUCTION_MONITOR_SEC=15 ACTION_EXECUTE_SEC=60`, `AP_ENABLED=false FLYWHEEL_ENABLED=false`, `REF_PRICE_UPDATES=true`, `RECONSTITUTION_MODE=manual`, `PRIORITY_FEE_MICROLAMPORTS=0` |

Set them with the Railway dashboard, `railway variables --set K=V`, or the Railway MCP `set-variables`. Changing a variable redeploys.

## Site on Vercel

Project `fi6900` (team `xperts-projects-6c5c6371`), linked at the repo root via `.vercel/project.json`. The site is
`apps/web-v2` (`@fi6900/web-v2`, Next.js 15): **Root Directory** `apps/web-v2`, **Build Command**
`pnpm --filter @fi6900/sdk build && pnpm --filter @fi6900/web-v2 build` (the SDK is a workspace dependency, so it is
built first), **Install Command** `pnpm install` from the monorepo root. `apps/web` is the legacy site and is not deployed;
remove it after launch. Local dev: `pnpm --filter @fi6900/web-v2 dev` (`.claude/launch.json` entry `web-v2`, port 3100).

Env (Production + Preview): `NEXT_PUBLIC_API_URL=https://keeper-production-94c7.up.railway.app`,
`NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com`, `NEXT_PUBLIC_CLUSTER=devnet`, `NEXT_PUBLIC_INDEX_MINT`,
`NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_LOOKUP_TABLE`. `NEXT_PUBLIC_*` is baked at build time → redeploy after a change:

```bash
npx vercel env add NEXT_PUBLIC_INDEX_MINT production --scope xperts-projects-6c5c6371    # (and preview)
npx vercel deploy --prod --yes --scope xperts-projects-6c5c6371
```

With `NEXT_PUBLIC_CLUSTER=devnet` every Solscan link carries `?cluster=devnet` and the wallet modal offers the
**Devnet test wallet** (`apps/web-v2/src/lib/burnerWallet.ts`): an in-page keypair loaded from `?burner=<base58 secret>`
(stripped from the URL and kept in `localStorage`), so `/create` and `/auctions` can be driven without an extension.
The setup script funds `keypairs/devnet-burner.json` with 20 % of each vault; open
`https://fi6900.vercel.app/create?burner=<base58 of that secret>` once to load it.

## Rotation / redeploy cheatsheet

- **Keeper code**: `railway up --detach --service keeper`.
- **Keeper key**: new keypair → (timelock 0) `set_rebalancer`, `set_fee_recipient`, `propose/accept_authority` to it; move the
  1,000,000 seed units and the inventory; set `KEEPER_KEYPAIR_JSON`; redeploy. With the timelock armed these are `queue_action` kinds 2/3.
- **Admin token**: change `ADMIN_TOKEN` on Railway and in `keypairs/devnet.json`.
- **Program**: rebuild (see `Anchor.toml`), then upgrade in place: `solana program write-buffer` + (`solana program extend` if the .so grew) +
  `solana program upgrade`, or the one-shot `solana program deploy ... --program-id target/deploy/fi6900-keypair.json --upgrade-authority keypairs/devnet-deployer.json -u devnet`
  (default TPU mode, not `--use-rpc`); then `anchor idl upgrade`, copy the IDL into `packages/sdk`, `pnpm --filter @fi6900/sdk build`,
  `railway up --detach --service keeper` and redeploy the site. The fund survives upgrades as long as `Fund`/`Asset` layouts are unchanged
  (`docs/mainnet-go-live.md` §8 "How to ship a program fix"); the deployer needs the buffer rent (~3.5 SOL) up front, refunded on upgrade.
- **Fresh fund**: `pnpm e2e:setup:devnet` again (new index mint), then update `INDEX_MINT`/`LOOKUP_TABLE` on Railway and
  `NEXT_PUBLIC_INDEX_MINT`/`NEXT_PUBLIC_LOOKUP_TABLE` on Vercel and redeploy both.
- **Arm the timelock** (`set_timelock(432000)`) and hand the authority to a multisig exactly as in `docs/launch-runbook.md` §7.
