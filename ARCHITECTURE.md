# FI6900 — An on-chain memecoin index fund that actually works

Two tokens, one flywheel:

| Token | Type | Role |
|---|---|---|
| **FI6900 Index** (`$FI6900`) | SPL mint, authority = program PDA | The ETF. Every unit is redeemable in-kind for a pro-rata slice of the vault. |
| **FI6900 Coin** (`$FIX6900` on pump.fun) | pump.fun SPL mint | The engine. Creator fees fund the ETF; ETF fees buy back & burn the coin. |

This document is the contract between the three workstreams (program / keeper / web).
Do not change account layouts or API shapes without updating this file.

---

## 1. Why the reference project doesn't work, and what fixes it

A real index ETF (SPY) is three mechanisms:

1. **Methodology** — rules decide constituents and weights (float-adjusted market cap, capped).
2. **In-kind creation / redemption** — an Authorized Participant (AP) delivers the basket and
   receives shares, or returns shares and receives the basket. Shares are *literally* claims on the vault.
3. **Arbitrage** — if market price > NAV, APs create shares and sell them; if price < NAV, APs buy
   shares and redeem. Price is forced to track NAV.

FIX6900 has (1) loosely, and has neither (2) nor (3). Its token is an IOU to a wallet. FI6900 implements all three on-chain:

- `Fund` program vault holds every constituent in PDA-owned token accounts.
- `begin_mint / deposit / finalize_mint` = in-kind creation. `begin_redeem / withdraw` = in-kind redemption. Permissionless.
- Keeper runs an AP loop: closes NAV ↔ market price gaps via Jupiter + create/redeem. Anyone else can too.
- Rebalancing uses **permissionless Dutch auctions** bounded by on-chain **reference prices** (no price oracle for fills — the market sets the price inside a band the rebalancer cannot rig).
- Every admin change except `set_paused` goes through an on-chain **timelock** (`PendingAction`, 48 h on mainnet).

---

## 2. On-chain program (`programs/fi6900`, Anchor 0.31.1)

Program name: `fi6900`. **512 constituent slots** per fund (bitmaps are `[u64; 8]`). Token program agnostic (`token_interface`), so Token-2022 constituents are supported — including fee-on-transfer mints, because every vault credit is measured as a balance delta (see "Fee-on-transfer constituents" below). Program id: `Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV`.

### Accounts

```
Fund  (PDA: ["fund", index_mint])                      borsh, 8 + 391 bytes
  authority: Pubkey            // admin (Squads multisig in prod)
  pending_authority: Pubkey    // 2-step transfer
  rebalancer: Pubkey           // may open/cancel auctions and set ref prices (within the move cap)
  fee_recipient: Pubkey        // receives fee units (index tokens)
  index_mint: Pubkey           // SPL mint, decimals = 6, mint authority = fund PDA
  bump: u8
  asset_count: u16
  active_bitmap: [u64; 8]      // bit i set if asset slot i is active (participates in mint/redeem)
  mint_fee_bps: u16            // default 50  (0.5%)
  redeem_fee_bps: u16          // default 50
  mgmt_fee_bps: u16            // annual, default 100 (1%), accrued as new units to fee_recipient
  last_fee_accrual_ts: i64
  epoch: u64                   // increments on every auction fill; invalidates open mint sessions
  open_auctions: u16
  paused: u8                   // bit0 = mint paused, bit1 = redeem paused, bit2 = auctions paused
  auction_nonce: u64
  occupied_bitmap: [u64; 8]    // bit i set if slot i holds an Asset account (Active OR Removing); add_asset picks the lowest clear bit
  max_auction_discount_bps: u16 // default 500: end_price >= fair * (1 - this)
  max_ref_move_bps: u16        // default 2000: rebalancer ref-price moves per period
  ref_move_period_slots: u64   // default 216_000 (~1 day)
  timelock_slots: u64          // default 432_000 on mainnet (~48 h); 0 = direct admin ixs (localnet/tests)
  action_nonce: u64            // next PendingAction nonce
  reserved: [u8; 64]

Asset (PDA: ["asset", fund, mint])                      borsh, 8 + 237 bytes
  fund: Pubkey
  mint: Pubkey
  vault: Pubkey                // ATA(fund PDA, mint)
  token_program: Pubkey
  index: u16                   // slot 0..511
  status: u8                   // 0 = Active, 1 = Removing (weight 0, no deposits; withdrawals/auctions still allowed)
  decimals: u8
  target_weight_bps: u16       // informational; keeper reads it, auctions enforce it
  pending_deposits: u64        // tokens sitting in vault from unfinalized mint sessions (excluded from NAV); credited with the RECEIVED amount (balance delta)
  pending_withdrawals: u64     // tokens reserved by open redeem sessions (excluded from NAV)
  bump: u8                     // PDA bump, lets begin_mint/redeem verify Asset PDAs with create_program_address
  ref_price: u128              // Q64.64 "fund numeraire per raw base unit"; 0 = unset (asset cannot be auctioned)
  ref_price_updated_slot: u64
  ref_price_anchor: u128       // ref_price at the start of the current move window
  ref_price_anchor_slot: u64
  reserved: [u8; 32]

  effective_balance = vault.amount - pending_deposits - pending_withdrawals

MintSession (PDA: ["mint_session", fund, owner, nonce_le])     zero-copy (bytemuck), 8 + 4264 bytes
  fund, owner: Pubkey
  nonce: u64
  units: u64                   // index units requested (gross, before fee)
  epoch: u64                   // fund.epoch at begin; finalize requires equality
  created_slot: u64
  next_slot: u16               // chunked begin: next active slot to compute
  ready: u8                    // 1 once every active slot is computed (gates deposit / finalize)
  _pad: [u8; 5]
  deposited_bitmap: [u64; 8]
  required: [u64; 512]         // per-slot required deposit, computed at begin (possibly over several chunks); deposit overwrites the slot with the amount received

RedeemSession (PDA: ["redeem_session", fund, owner, nonce_le]) zero-copy (bytemuck), 8 + 4256 bytes
  fund, owner: Pubkey
  nonce: u64
  units: u64                   // net units burned
  created_slot: u64
  next_slot: u16
  ready: u8
  _pad: [u8; 5]
  withdrawn_bitmap: [u64; 8]
  entitled: [u64; 512]         // per-slot amount owed, computed & reserved at begin (possibly over several chunks)

Auction (PDA: ["auction", fund, auction_nonce_le])
  fund: Pubkey
  sell_asset: Pubkey           // Asset PDA being sold from vault
  buy_asset: Pubkey            // Asset PDA being bought into vault
  sell_remaining: u64
  sell_total: u64
  start_price: u128            // buy_token per sell_token, Q64.64 — decays linearly to end_price
  end_price: u128
  start_slot: u64
  end_slot: u64
  bought_total: u64            // buy tokens the vault actually received (>= the price-implied amounts)
  status: u8                   // 0 open, 1 filled, 2 cancelled, 3 expired
  nonce: u64                   // fund.auction_nonce at creation (the PDA seed), appended for indexers

PendingAction (PDA: ["pending", fund, action_nonce_le])        borsh, 8 + 146 bytes
  fund: Pubkey
  nonce: u64
  kind: u8                     // see "Action kinds"
  proposer: Pubkey             // authority that queued it; receives the rent on execute/cancel
  queued_slot: u64
  eta_slot: u64                // queued_slot + fund.timelock_slots
  key: Pubkey                  // pubkey payload (asset mint / new rebalancer / new fee recipient) or default
  values: [u64; 4]             // numeric payload
  bump: u8
```

Upgrade compatibility: the program is upgradeable in place (`docs/mainnet-go-live.md` §8). `Fund` and `Asset` hold the money and must stay byte-compatible once a fund exists — new fields go into their `reserved` tail (`Fund.reserved: [u8; 64]`, `Asset.reserved: [u8; 32]`), never reordered or resized; `MintSession` / `RedeemSession` are short-lived (minutes) and may change shape between upgrades as long as it is documented and no session is open across the upgrade; `Auction` and `PendingAction` have no reserved bytes (append only with a space change, i.e. only while none is open). The fee-on-transfer upgrade (2026-10-05) changed no account layout, only instruction arguments and error codes. The token-metadata upgrade (2026-10-06) added the `set_token_metadata` instruction, action kind 10 and the `TokenMetadataSet` event; no account layout, instruction argument or error code changed, so old clients keep working (the .so grew 689,464 → 727,480 bytes, hence a `solana program extend` before the upgrade).

Layout notes (implemented): the 64-slot `u64` bitmaps became `[u64; 8]` (512 slots) and `Asset.index` became `u16`; `asset_count` is `u16`. The two session accounts carry 512 `u64`s (4 KB) and are therefore `#[account(zero_copy)]` loaded through `AccountLoader` (no 4 KB struct ever touches the SBF stack); their TS decoding is byte-identical to borsh because the layout has no padding (`_pad` is explicit). `Fund` gained the governance fields; `Asset` gained the ref-price fields (`reserved` is 32 bytes). Additional error codes beyond the original list: `InvalidMint`, `InvalidArgument`, `EmptyVault`, `InsufficientBalance`, `AlreadyWithdrawn`, `WrongAssetStatus`, `SessionNotReady`, `SessionAlreadyReady`, `RefPriceUnset`, `RefPriceMoveTooLarge`, `PriceBelowBound`, `TimelockRequired`, `TimelockNotElapsed`, `InvalidActionKind`, `WrongActionKind`, `WrongActionTarget`, `ShortDeposit`, `ShortFill`. Fees are capped at 1000 bps each. `set_paused` bit0 also blocks `deposit`/`finalize_mint`; bit2 also blocks `fill_auction`. `close_redeem` treats "bitmap complete" as "every slot with a non-zero entitlement has been withdrawn". `fill_auction` additionally requires `sell_amount <= effective_balance` of the sell asset so open mint/redeem reservations can never be sold.

### Fee-on-transfer constituents (Token-2022 `TransferFeeConfig`)

A transfer fee is withheld on the *receiving* account, so a vault that is told to receive `x` gets `x - fee(x)` while a vault that sends `x` is debited exactly `x`. The program therefore never trusts an instructed inbound amount:

- `deposit(slot, gross_amount: Option<u64>)` transfers `gross_amount` (default `required[slot]`) from the owner, reloads the vault and credits `received = after - before`. It requires `received >= required[slot]` (`ShortDeposit` otherwise; the error also fires when `gross_amount < required`). `asset.pending_deposits += received` and `session.required[slot]` is overwritten with `received`, so `finalize_mint` / `cancel_mint_refund` release exactly what was credited (the original requirement is not needed after the deposit; a separate `received: [u64; 512]` would double the 4 KB session). Any excess over `required` stays in the vault and accrues to every holder at finalize. A refund of a fee-mint slot debits the vault by `received` and the owner gets `received - fee`.
- `fill_auction(sell_amount, gross_buy_amount: Option<u64>)` transfers `gross_buy_amount` (default = the price-implied `buy_amount`) from the filler and requires the buy vault to receive `>= buy_amount` (`ShortFill`). `bought_total` and `AuctionFilled.buy_amount` record the received amount. The sell leg is unchanged: the vault is debited exactly `sell_amount`; a fee on the sell token comes out of what the filler receives.
- Outbound legs (`withdraw`, `cancel_mint_refund`, auction sell) transfer the entitled/instructed amount; the recipient receives net. Vault debits are exact, so `effective_balance = vault.amount - pending_deposits - pending_withdrawals` can never underflow (`Asset::effective_balance` is `checked_sub` and unit-tested).
- The SDK computes the gross: `grossForNet(net, feeBps, maxFee)` = smallest `g` with `g - min(ceil(g*bps/10_000), maxFee) >= net`, reading the mint's `TransferFeeConfig` (epoch fee) via `Fi6900Client.transferFee`; `buildMintTxs` applies it to fee assets automatically, `depositIx` / `fillAuctionIx` take the gross as an optional argument, and for ordinary mints gross == required (the optional argument is omitted, so the program moves exactly `required`). Fee tokens remain ineligible by methodology rule 2.7 and are admitted only by an explicit committee override (`docs/methodology.md`).

### Reference prices (auction price bounds)

`Asset.ref_price` is a Q64.64 price in a **fund numeraire per raw base unit**. The program only ever uses *ratios* of two ref prices, so the numeraire is a convention: the SDK/keeper use **nano-USD (1e-9 USD)** per raw unit (`usdToRefPriceQ64(priceUsd, decimals)`), which keeps every memecoin price well inside the fixed-point range. `start_auction` enforces

```
fair      = ref_sell / ref_buy                         // buy-raw per sell-raw, Q64.64 (256-bit intermediate)
end_price >= fair * (10_000 - fund.max_auction_discount_bps) / 10_000     else PriceBelowBound
start_price >= end_price > 0                           // unchanged
```

Both assets need a ref price (`RefPriceUnset` otherwise). The rebalancer refreshes prices after every NAV snapshot; a move is measured against `ref_price_anchor` (the value at the start of the current `ref_move_period_slots` window, re-anchored when the window rolls) and may not exceed `max_ref_move_bps` (`RefPriceMoveTooLarge`). The first value (ref_price == 0) is authority-only and unrestricted. The authority may override the cap directly only while `timelock_slots == 0`; otherwise it queues `ACTION_REF_PRICE_OVERRIDE`, which re-anchors.

### Admin timelock

Every admin change except the protective `set_paused` (and the completion step `finalize_remove_asset`, which only works once a vault is empty) is timelocked: `queue_action(kind, key, values)` creates a `PendingAction` with `eta = now + timelock_slots`; after the eta **anyone** executes it; the authority may cancel. The direct setters (`set_fees`, `set_target_weight`, `set_rebalancer`, `set_fee_recipient`, `add_asset`, `begin_remove_asset`, `set_timelock`, `set_auction_params`) remain callable **only while `fund.timelock_slots == 0`** (`TimelockRequired` otherwise) — that is how localnet/tests and the launch sequence work; `set_timelock(432_000)` then arms the lock, and lowering it again is itself a timelocked action.

Action kinds (`kind`, payload):

| kind | name | key | values |
|---|---|---|---|
| 0 | `set_fees` | — | `[mint_bps, redeem_bps, mgmt_bps]` |
| 1 | `set_target_weight` | asset mint | `[bps]` |
| 2 | `set_rebalancer` | new rebalancer | — |
| 3 | `set_fee_recipient` | new fee recipient | — |
| 4 | `ref_price_override` | asset mint | `[lo64, hi64]` of the Q64.64 price |
| 5 | `set_max_auction_discount` | — | `[bps]` (≤ 5000) |
| 6 | `set_timelock` | — | `[slots]` |
| 7 | `add_asset` | mint | `[target_weight_bps]` (executed with `execute_action_add_asset`, which creates the Asset + vault) |
| 8 | `begin_remove_asset` | asset mint | — |
| 9 | `set_ref_move_policy` | — | `[max_ref_move_bps, ref_move_period_slots]` |
| 10 | `set_token_metadata` | `token_metadata_hash(name, symbol, uri)` = sha256 over the three strings, each u32-LE-length-prefixed | — (executed with `set_token_metadata(name, symbol, uri)` by the authority; `execute_action` refuses this kind) |

### Instructions

Admin / setup
- `initialize_fund(mint_fee_bps, redeem_fee_bps, mgmt_fee_bps, timelock_slots)` — creates Fund, takes over mint authority of a fresh 6-decimal mint; governance defaults 500 / 2000 / 216_000.
- `add_asset(target_weight_bps)` — direct (timelock 0): creates Asset + vault ATA, assigns the lowest free slot, sets both bits.
- `set_target_weight(bps)`, `set_fees(...)`, `set_rebalancer`, `set_fee_recipient`, `begin_remove_asset` — direct (timelock 0); otherwise queue the matching action.
- `set_paused(mask)` — never timelocked (protective).
- `set_timelock(slots)` — arms the timelock while it is 0. `set_auction_params(max_auction_discount_bps, max_ref_move_bps, ref_move_period_slots)` — direct (timelock 0).
- `finalize_remove_asset` — requires vault.amount == 0 && pending == 0; closes Asset, clears both bits.
- `propose_authority`, `accept_authority`
- `set_token_metadata(name, symbol, uri)` — authority. Creates (`CreateMetadataAccountV3`) or updates (`UpdateMetadataAccountV2`) the index mint's Metaplex metadata PDA `["metadata", metaqbx…, index_mint]` by CPI with the fund PDA signing as mint authority **and** update authority (`is_mutable`, no creators, 0 seller fee); the two instructions are hand-encoded, the program has no mpl crate dependency. Limits 32 / 10 / 200 bytes (`InvalidArgument`). Direct while the timelock is 0; once armed the call must carry a due `ACTION_SET_TOKEN_METADATA` whose `key` equals the payload hash (`TimelockRequired` / `WrongActionTarget` / `TimelockNotElapsed`), which it closes (rent → proposer) and reports with `ActionExecuted`. Emits `TokenMetadataSet { created }`.
- `bootstrap_mint(units)` — authority only, supply must be 0; the basket must already be in the vaults (`[Asset, vault]` for every active slot in ONE tx → ≤ ~58 assets; larger funds bootstrap with the first ≤58 and add the rest with empty vaults). Used once at launch.

Governance
- `set_ref_price(price)` — rebalancer or authority (rules above). Emits `RefPriceSet`.
- `queue_action(kind, key, values)` — authority; validates the payload now. Emits `ActionQueued`.
- `execute_action()` — anyone after `eta_slot`; every kind except `add_asset`. Optional `asset` account for weight / ref-price / remove kinds (`WrongActionTarget` if it is missing or not the action's mint). Closes the PendingAction, rent → proposer. Emits `ActionExecuted`.
- `execute_action_add_asset()` — anyone after eta; kind 7 only; creates the Asset PDA + vault ATA (payer = executor).
- `cancel_action()` — authority. Emits `ActionCancelled`.

Fees
- `accrue_management_fee()` — permissionless; mints supply * mgmt_bps * dt / (10_000 * 31_557_600) to fee_recipient ATA. Called by SDK before begin_mint/begin_redeem.

Creation (in-kind)
- `begin_mint(units, nonce)` — remaining_accounts: `[Asset, vault]` for the first N active slots in index order. Requires `fund.open_auctions == 0`. For each asset `required[i] = ceil(effective_balance_i * units / supply)`. With every active slot supplied the session is `ready` at once.
- `begin_mint_continue()` — next chunk of `[Asset, vault]` pairs (from `session.next_slot`); same formula with the *current* supply, so every chunk is individually fair. Rejected once `ready` (`SessionAlreadyReady`) or when the epoch moved.
- `deposit(slot: u16, gross_amount: Option<u64>)` — requires `ready`; transfers `gross_amount` (default `required[slot]`) from owner ATA → vault, credits the received balance delta (`>= required[slot]`, else `ShortDeposit`): `asset.pending_deposits += received`, `required[slot] = received`, sets bit.
- `finalize_mint()` — remaining_accounts `[Asset]` for every active slot. Requires `ready`, bitmap == fund.active_bitmap && session.epoch == fund.epoch. Decrements pending_deposits, mints `units - fee` to owner ATA and `fee` to fee_recipient ATA. Closes session, rent → owner.
- `cancel_mint_refund(slot)` / `cancel_mint_close()` — refund each deposited slot (the received amount, gross from the vault), then close.

Redemption (in-kind)
- `begin_redeem(units, nonce)` — remaining_accounts `[Asset (writable), vault]` for the first N active slots. fee = units*redeem_fee_bps/10_000 transferred to fee_recipient ATA; burns `units - fee` now; `entitled[i] = floor(effective_balance_i * net_units / supply_before)`; `asset.pending_withdrawals += entitled[i]`.
- `begin_redeem_continue()` — next chunk; `entitled[i] = floor(effective_i * net / (supply_now + net))` (the net units were already burned).
- `withdraw(slot: u16)` — requires `ready`; vault → owner ATA for `entitled[slot]`, decrements pending_withdrawals, sets bit. Batched by the SDK (8 per tx, each preceded by an idempotent ATA create).
- `close_redeem()` — requires `ready` and bitmap complete; rent → owner.

Rebalancing (Dutch auction, permissionless fill)
- `start_auction(sell_amount, start_price, end_price, duration_slots)` — rebalancer only; enforces the ref-price bound. `fund.open_auctions += 1`.
- `fill_auction(sell_amount, gross_buy_amount: Option<u64>)` — anyone. `price = start - (start-end) * elapsed/duration` (Q64.64). `buy_amount = ceil(sell_amount * price)`. Filler transfers `gross_buy_amount` (default `buy_amount`) buy_token → vault and the vault must receive `>= buy_amount` (`ShortFill`); `bought_total += received`. Vault transfers sell_amount sell_token → filler. `fund.epoch += 1`. Auto-closes when sell_remaining == 0 (`open_auctions -= 1`).
- `cancel_auction()` — rebalancer; or anyone after end_slot (marks expired). `open_auctions -= 1`.

### Scaling (measured on solana-test-validator, Anchor 0.31.1, v0 transactions + address lookup tables)

| | 5 assets | 40 assets | 301 assets (slot 300 occupied) |
|---|---|---|---|
| lookup tables (256 addresses each; 3 per asset + 9) | 1 | 1 (129 addresses) | 4 (912 addresses) |
| `bootstrap_mint` | 1 tx | 1 tx, 135,658 CU, 421 bytes | first 50 assets only (1 tx, 166,538 CU); rest added with empty vaults |
| `begin_mint` | 1 tx | **1 tx**, 172,495 CU, 545 bytes | 7 txs (50 pairs each: 179,545 / 172,496 ×5 / 6,536 CU) |
| deposits (6 per tx) | 1 tx | 7 txs, ≤ 89,082 CU, 612 bytes | 51 txs |
| `finalize_mint` | 1 tx | **1 tx**, 139,029 CU, 451 bytes | **not possible**: needs 1 account per active asset in one tx (128-lock cap → ceiling ≈ 118 active assets) |
| creation total | 3 txs | **9 txs** | — |
| `begin_redeem` | 1 tx | 1 tx, 198,975 CU, 580 bytes | 7 txs (249,392 / 170,266 ×5 / 6,658 CU) |
| withdraws (8 per tx) | 1 tx | 5 txs, ≤ 167,362 CU, 837 bytes | 38 txs, ≤ 241,510 CU, ≤ 905 bytes (each withdraw preceded by an ATA create) |
| redemption total | 3 txs | **7 txs** | **46 txs** |

Practical ceilings: `begin_*` chunk at 50 `[Asset, vault]` pairs per transaction (`BEGIN_PAIRS_PER_TX`; the runtime locks ≤ 128 accounts per tx), so any fund ≤ 50 active assets begins in one transaction and 512 slots need 11 chunks. **In-kind creation is capped at ≈118 active assets** by `finalize_mint`, which must release every slot's pending deposits atomically; redemption scales to all 512 slots. `bootstrap_mint` is capped at ≈58 assets per transaction. Every `begin`/`finalize`/withdraw transaction stays far below the 1.4M CU limit (worst measured 249,392 CU) and under 1232 bytes.

Errors: `Paused`, `AuctionsOpen`, `StaleEpoch`, `IncompleteDeposits`, `IncompleteWithdrawals`, `WrongRemainingAccounts`, `SlotNotActive`, `AlreadyDeposited`, `AuctionNotOpen`, `AuctionEnded`, `AuctionNotEnded`, `ExceedsRemaining`, `ZeroAmount`, `SupplyZero`, `SupplyNotZero`, `MaxAssets`, `AssetNotEmpty`, `Unauthorized`, `MathOverflow`, `InvalidMint`, `InvalidArgument`, `EmptyVault`, `InsufficientBalance`, `AlreadyWithdrawn`, `WrongAssetStatus`, `SessionNotReady`, `SessionAlreadyReady`, `RefPriceUnset`, `RefPriceMoveTooLarge`, `PriceBelowBound`, `TimelockRequired`, `TimelockNotElapsed`, `InvalidActionKind`, `WrongActionKind`, `WrongActionTarget`, `ShortDeposit`, `ShortFill`.

Events: `FundInitialized, AssetAdded{index: u16}, AssetRemoved{index: u16}, MintFinalized{owner, units, fee}, RedeemBegun{owner, units, fee}, AuctionStarted, AuctionFilled{filler, sell_amount, buy_amount, price, epoch}, AuctionClosed, FeesAccrued, RefPriceSet{asset, mint, old_price, new_price, signer, slot}, ActionQueued{action, nonce, kind, key, values, eta_slot, proposer}, ActionExecuted{action, nonce, kind, executor}, ActionCancelled{action, nonce, kind}`.

---

## 3. Index methodology (keeper, `apps/keeper/src/methodology`)

Mirrors S&P style rules, tuned for Solana memecoins. All thresholds in `methodology.config.ts`.

Eligibility (all must hold):
- Mint authority revoked AND freeze authority revoked.
- Age ≥ 14 days (first trade).
- Fully diluted market cap ≥ $2M.
- 24h volume ≥ $250k and 7d average ≥ $100k/day.
- Jupiter quote for a $10k sell has price impact ≤ 2%.
- Not a stablecoin / LST / wrapped asset (denylist + heuristics).
- Not on the manual exclusion list.

Selection: top 40 eligible by market cap. Incumbents keep their seat unless they fall below rank 50 (buffer rule, like S&P).

Weighting: configurable `weighting.scheme` with three options. **Default is `equal`** (every constituent 1/N, like the S&P 500 Equal Weight Index / RSP). Alternatives: `sqrt-cap` (square-root market cap, capped 12%, floored 0.5%) and `capped-cap` (raw market cap, capped 20%). Equal weight is the default because raw cap weighting of memecoins puts most of the fund in two names, and because the forced "sell winners / buy losers" rebalance harvests memecoin volatility (the rebalancing premium).

Cadence:
- Scheduled rebalance back to target weights every `rebalance.intervalDays` (default 7). Between schedules, auctions open only when an asset's weight drifts **relative to its target** by more than `rebalance.driftRelativeBps` (default 5000 = the actual weight is more than 50% above or below target: |actual − target| / target > 0.5; a Removing asset with any weight always triggers). The drift check runs every `REBALANCE_CHECK_SEC` (default 60 s) off the cached NAV snapshot, so it is cheap.
- Liquidity safety valve: no single auction may sell more than `rebalance.maxTradePctOfDailyVolume` (default 5%) of the asset's 24h volume; the remainder is queued to the next cycle. This is the "don't flash-crash the small names" constraint from the equal-weight literature.
- Auction curves start at mid × (1 + startPremiumBps) and decay to mid × (1 − maxDiscountBps), but never below the on-chain bound `fair × (1 − max_auction_discount_bps)` computed from the two assets' ref prices (the keeper lifts the end price to the bound and logs it).
- Reconstitution (add/remove constituents) on the 1st of each month, 00:00 UTC, announced 48h ahead via API `announcements`. The methodology job never applies changes itself: it records **proposals**; in `reconstitution.mode = manual` (default) the index committee approves/rejects them (CLI `keeper approve|reject`, `POST /v1/admin/...`), in `auto` they are approved automatically. Approved items are queued as timelocked `PendingAction`s at the window (or at once with `--immediate`) and execute after the timelock. Rejections suppress re-proposal for `reconstitution.rejectCooldownDays` (default 90).
- **Holder governance (v1, `docs/governance.md`).** `$FIX6900` holders vote on `add_asset` / `remove_asset` and on a whitelisted set of parameters (`eligibility.minVolume24hUsd` 50k..2M, `rebalance.driftRelativeBps` 1000..10000, `FEE_BURN_PCT` 0..100, `flywheel.airdropShareBps` 0..10000). A vote is an ed25519-signed message (gasless), weighted by the wallet's balance at the proposal's snapshot slot; the snapshot drops the airdrop exclusion set (pools, PDAs, program accounts, incinerator, denylist, own wallets) and its sum is the circulating supply. Window 48 h, quorum 5 % of circulating (for+against+abstain), passes when for > against; proposing needs 0.5 % of circulating. The `governance` job (60 s) closes ended proposals; a passed add/remove becomes an approved reconstitution proposal queued through the timelock (status `queued` → `executed` via `reconcileExecuted`), a passed parameter is written to the kv store as `cfg.<key>` and read by the methodology job, rebalancer, fee processor and flywheel at the point of use (`config/overrides.ts`; `GET /v1/methodology` reports the effective config). Every step is a `flywheel_events` row of kind `governance`.

Index level (divisor method, like S&P):
```
level_t = Σ_i price_i,t × effective_balance_i,t / divisor_t
divisor_0 = Σ price × balance / 1000      (base level 1000 at inception)
```
On any auction fill, `divisor` is re-set so the level is continuous across the fill.

NAV per unit (USD) = Σ price_i × effective_balance_i / index supply.

---

## 4. Flywheel (keeper, `apps/keeper/src/flywheel`)

```
pump.fun coin trades  ──creator fee──▶  dev wallet
                                           │ claim (pump + PumpSwap collect_creator_fee)
                                  ┌────────┴────────┐
                                50%                 50%
                                 │                   │
                       buy $FI6900 (Jupiter)   buy basket via Jupiter → create units
                       + pair with SOL         → airdrop to $FIX6900 holders (every DIST_INTERVAL,
                       → add LP (Meteora)        default 15m; pro-rata, min-balance threshold)

ETF fees (mint/redeem/mgmt, paid in $FI6900 units) → fee_recipient
   75%: redeem → sell basket → SOL → buy $FIX6900 → burn (SPL burn, provable)
   25%: treasury
```

Rules:
- Airdrops are sent as direct SPL transfers in batches of 18 per tx. Wallets whose share is worth less than the ATA rent (≈0.002 SOL) are skipped that round and their share is carried forward (`carry` table), so dust never burns SOL.
- Every flywheel action writes a row to `flywheel_events` with tx signatures; the API exposes it and the site renders it. "Don't trust it. Verify it." means every number on the site links to a signature.

---

## 5. Keeper API (`apps/keeper`, Hono, default `http://localhost:8787`)

All responses `{ ok: true, data, asOf: ISO }` or `{ ok: false, error }`.

```
GET /v1/fund                 { indexMint, fundPda, supply, navUsd, navPerUnitUsd, indexLevel, marketPriceUsd, premiumBps, fees:{mintBps,redeemBps,mgmtBps}, assetCount, epoch, openAuctions, paused }
GET /v1/holdings             [{ slot, mint, symbol, name, logo, decimals, balance, balanceUi, priceUsd, valueUsd, weightBps, targetWeightBps, driftBps, change24hPct, marketCapUsd, status, vault, verifyUrl }]
GET /v1/history?range=1d|7d|30d|all   [{ t, navPerUnitUsd, indexLevel, marketPriceUsd, supply }]
GET /v1/auctions?status=open|all      [{ pda, sellMint, buyMint, sellRemaining, sellTotal, startPrice, endPrice, currentPrice, startSlot, endSlot, status, fills:[{sig, filler, sellAmount, buyAmount, price, slot}] }]
GET /v1/flywheel             { coinMint, creatorFeesClaimedSol, lpAddedSol, airdroppedUnits, airdropRounds, buybackSol, burnedCoin, treasurySol,
                               next: { airdropAt, rebalanceCheckAt, scheduledRebalanceAt } }   // scheduledRebalanceAt = next weekly scheduled rebalance
GET /v1/flywheel/events?limit=50&cursor=   [{ id, kind: 'claim'|'buy_index'|'add_lp'|'airdrop'|'buyback'|'burn'|'create'|'redeem'|'auction_start'|'auction_fill'|'fee_accrual', ts, sig, amounts:{...}, note }]
GET /v1/airdrops/:wallet     [{ roundId, ts, units, sig }]
GET /v1/methodology          { config, lastRun: { ts, eligible:[...], selected:[...], weights:[...] }, nextReconstitution }
                             // config.rebalance.driftRelativeBps is the band in force; config.rebalance.driftBandBps is a derived legacy alias (absolute bps)
GET /v1/announcements        [{ ts, title, body }]
GET /v1/verify               { fundPda, indexMint, mintAuthority, vaults:[{mint, vault, owner, amount}], lookupTable, programId, idlHash,
                               programDataAddress, upgradeAuthority }          // upgradeAuthority null once burned
GET /v1/governance           { timelockSlots, pending:[{ pda, nonce, kind, kindName, payload, etaSlot, queuedSlot, proposer, queuedSig, due }],
                               upgradeAuthority, programDataAddress, fundAuthority, pendingAuthority, rebalancer, feeRecipient,
                               maxAuctionDiscountBps, maxRefMoveBps, refMovePeriodSlots, reconstitutionMode, currentSlot }
GET /v1/proposals?status=    [{ id, mint, symbol, action:'add'|'remove', reason:{...metrics}, status:'proposed'|'approved'|'rejected'|'queued'|'executed',
                               weightBps, proposedTs, decidedTs, queuedTs, executedTs, actionPda, queuedSig, note }]
GET /v1/quote/create?units=  { basket:[{mint, amount}], estCostSol, estNavUsd }   // for the AP / power-user UI
GET /v1/quote/redeem?units=  { basket:[{mint, amount}], estValueUsd }

POST /v1/admin/proposals/:mint/approve   body { weightBps?, immediate? }      // Authorization: Bearer ADMIN_TOKEN (403 when ADMIN_TOKEN unset)
POST /v1/admin/proposals/:mint/reject    body { note? }
POST /v1/admin/assets                    body { mint, action?: 'add'|'remove', weightBps?, immediate?, force? }

GET  /v1/governance/proposals?status=&wallet=   [{ id, kind:'add_asset'|'remove_asset'|'set_param', payload, summary, title, description, proposer, createdTs, snapshotSlot, snapshotSupply,
                                                  snapshotHolders, startTs, endTs, quorumBps, status:'open'|'passed'|'failed'|'queued'|'executed'|'cancelled', timeLeftSec,
                                                  tally:{ for, against, abstain, participation, voters, quorumUnits, quorumReached, majority, passed, forBps, againstBps, abstainBps, participationBps },
                                                  result, queuedActionPda, queuedSig, myVote?, myWeight? }]      // open first; ?wallet adds myVote / myWeight
GET  /v1/governance/proposals/:id?wallet=       GovProposal + votes:[{ wallet, choice, weight, ts }]
GET  /v1/governance/eligibility?wallet=         { wallet, balance, circulatingSupply, thresholdUnits, eligible, openProposals, maxOpenPerWallet }
POST /v1/governance/proposals                   body { kind, payload, title, description, proposer, message, signature } -> 201 GovProposal
                                                // message = `FIX6900 governance: propose <sha256 of canonical JSON {kind,payload,title,description,proposer}>`, ed25519 by proposer;
                                                // Authorization: Bearer ADMIN_TOKEN creates without signature / threshold (proposer 'admin')
POST /v1/governance/proposals/:id/vote          body { wallet, choice:'for'|'against'|'abstain', message, signature } -> GovProposal
                                                // message = `FIX6900 governance: vote <choice> on proposal <id> (snapshot slot <slot>)`; weight = snapshot balance; re-vote replaces
POST /v1/admin/governance/proposals/:id/cancel  body { note? }     // ADMIN_TOKEN; open or passed only
```

Holder-governance POSTs are rate-limited (20 per minute per IP + wallet, 429) and answer 400 (validation / message mismatch), 403 (bad signature, below threshold, no snapshot balance), 404, 409 (closed, duplicate, already a constituent) or 503 (`GOV_ENABLED=false` or no `COIN_MINT`). `GET /v1/governance` carries a `governance` block: `{ enabled, coinMint, counts:{open,passed,failed,queued,executed,cancelled}, params:{ votingHours, quorumBps, proposalThresholdBps, maxOpenPerWallet, allowedParams:[{key,label,unit,min,max,integer,applies}], devAcceptAnyBalance }, overrides:{ '<key>': value }, lastSnapshot:{ proposalId, slot, supply, holders } | null }`. `flywheel/events` gains kinds `treasury` and `governance` (sig `off-chain` until a queue transaction exists). Full rules and message formats: `docs/governance.md`.

`upgradeAuthority` / `programDataAddress` are read from the BPF upgradeable loader: the program account points at its ProgramData account, whose `Option<Pubkey>` upgrade authority is `null` once burned.

SSE: `GET /v1/stream` emits `fund`, `holdings`, `auction`, `flywheel_event` messages.

---

## 6. SDK (`packages/sdk`)

TypeScript. Exports: PDAs (incl. `pendingActionPda`), `Fi6900Client` (wraps Anchor Program): `beginMint`/`beginMintContinue`, `deposit`, `finalizeMint`, `beginRedeem`/`beginRedeemContinue`, `withdraw`, `closeRedeem`, `fillAuction`, `startAuction`, admin ixs, `setRefPriceIx`, `queueActionIx` + `ActionPayloads`, `executeActionIx` (picks `execute_action` / `execute_action_add_asset`), `cancelActionIx`, `readPendingActions`/`readDueActions`, `buildMintTxs(units)` / `buildRedeemTxs(units)` which return ordered `VersionedTransaction[]` (chunked `begin_*` hidden, 50 pairs per tx) using the fund's address lookup table(s), and `readFund`, `readAssets`, `readAuctions`. Pricing helpers mirror `math.rs`, including `usdToRefPriceQ64`, `fairPriceQ64`, `minEndPriceQ64`, `moveBps`, `clampRefPrice`. `createFundLookupTable()` plans one table per 256 addresses; `extendFundLookupTables()` grows them. Bitmaps are exposed as one 512-bit `bigint`.

---

## 7. Web (`apps/web`, Next.js 15 App Router, Tailwind v4, Framer Motion, wallet-adapter)

Routes:
- `/` — hero with live index level ticker, NAV vs market price, premium/discount badge, live holdings table (sortable, sparklines), NAV chart, flywheel diagram with live numbers, "verify" strip.
- `/buy` — Jupiter swap (SOL → $FI6900) embedded; shows NAV, market price, premium; warns if premium > 1.5%.
- `/create` — AP console: in-kind create/redeem with step progress (begin → deposits → finalize), basket preview, est. cost.
- `/auctions` — live Dutch auctions with decaying price curve, fill button.
- `/flywheel` — fee flow Sankey, airdrop history (lookup by wallet), burn counter, LP depth.
- `/verify` — every vault account, mint authority proof, program ID, IDL hash, lookup table, upgrade authority, all deep-linked to Solscan.
- `/methodology` — rules, last run, next reconstitution, announcements.

Design direction: dark, editorial, financial-terminal density with generous type. Monospace numerals. One accent (acid green `#B6FF3B`) on near-black (`#0A0B0D`). No gradients-for-the-sake-of-it. Motion is informative (numbers tick, rows reorder), never decorative.

---

## 8. Repo layout

```
programs/fi6900/        Anchor program (Rust)
tests/                  ts-mocha tests against local validator (fi6900.ts, sdk.ts incl. 40- and 301-asset scale suites)
packages/sdk/           TypeScript client
apps/keeper/            pricing, methodology, NAV, rebalancer, governance (ref prices, timelock, proposals), AP arbitrage, flywheel, API
apps/web/               Next.js site
docs/                   methodology.md, operations.md, launch-runbook.md, localnet-e2e.md (full loop on solana-test-validator, PRICE_SOURCE=static)
```

Toolchain: Anchor 0.31.1 + Solana 2.3 CLI with platform-tools v1.52 (run in WSL Ubuntu; see Anchor.toml), Node 22, pnpm workspaces.
