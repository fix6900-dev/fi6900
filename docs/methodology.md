# FI6900 Solana Memecoin Equal Weight Index

## Index Methodology

**Version 1.1.0 — effective at fund inception.** (1.1.0 replaces the Jupiter-verified-by-volume candidate universe of 1.0.0 with the CoinGecko "Solana Meme Coins" category; eligibility, selection and weighting are unchanged.) Governing document for the index tracked by the FI6900 fund (`$FI6900`). Implemented in `apps/keeper/src/methodology`; every threshold below is a named value in `apps/keeper/src/config/methodology.config.ts`.

---

### 1. Introduction

#### 1.1 Index Objective

The FI6900 Solana Memecoin Equal Weight Index measures the performance of the 40 largest liquid memecoins on Solana, weighted equally. It is designed to be *investable*: every rule is checkable from public on-chain and market data, and the fund that tracks it holds the constituents in program-owned vaults with in-kind creation and redemption.

#### 1.2 Highlights

| | |
|---|---|
| Universe | Members of CoinGecko's **Solana Meme Coins** category (`solana-meme-coins`) with a Solana SPL / Token-2022 mint, plus Index Committee additions (section 2.6) |
| Constituents | 40 (target) |
| Weighting | Equal weight (1/N), reset at every scheduled rebalance |
| Rebalance | Weekly (every 7 days), plus drift-triggered interim rebalances when a weight is more than 50% away from its target (relative) |
| Reconstitution | Monthly, 1st of the month 00:00 UTC, announced 48 hours ahead; proposals approved by the index committee and applied through a 48-hour on-chain timelock |
| Base level | 1000.00 at inception |
| Calculation | Divisor method (price-weighted aggregate of vault holdings / divisor) |
| Currency | USD |

#### 1.3 Family

Alternative weighting schemes are defined for the same universe and selection rules and can be published as separate indices:

- **Square-root market-cap weighted, capped** (`sqrt-cap`): weights proportional to √(market cap), individual cap 12%, floor 0.5%.
- **Capped market-cap weighted** (`capped-cap`): weights proportional to market cap, individual cap 20%.

Equal weight is the headline index because raw cap weighting of memecoins concentrates most of the fund in two names, and because the forced "sell winners / buy losers" discipline of equal weighting systematically harvests memecoin volatility (the rebalancing premium).

---

### 2. Eligibility Criteria

A token must be in the candidate universe (section 2.6) and satisfy **all** of the following at the evaluation date to be eligible.

#### 2.1 Immutability
- **Mint authority revoked.** No account may mint new supply.
- **Freeze authority revoked.** No account may freeze holders' token accounts.

Both are read directly from the mint account on-chain.

#### 2.2 Seasoning
- **Age ≥ 14 days** since the first observed trade. The earliest of DexScreener `pairCreatedAt` (across all Solana pools of the token) and Jupiter `firstPool.createdAt` is used as the proxy for first trade. Tokens whose age cannot be established are not eligible.

#### 2.3 Size
- **Fully diluted market capitalisation ≥ USD 2,000,000.**

#### 2.4 Liquidity
- **24-hour traded volume ≥ USD 250,000** across all Solana pools. Measured as the larger of Jupiter's token-level 24h buy + sell volume (all venues Jupiter indexes) and the sum of DexScreener's per-pool `volume.h24`; a single DexScreener pool is never used alone because `tokens/v1` reports only the primary pool.
- **7-day average daily volume ≥ USD 100,000.** The average uses the keeper's daily observations; when fewer than three observations exist (new candidate), the latest 24-hour volume is used as the proxy.
- **Price impact ≤ 2.00%** for a market sell of USD 10,000 worth of the token into USDC, quoted by the Jupiter aggregator at evaluation time. Tokens for which no route exists are not eligible.

#### 2.5 Exclusions
Not eligible regardless of the above:
- Stablecoins, liquid staking tokens, wrapped or bridged assets, tokenised stocks and real-world assets (denylist of mints plus symbol and tag heuristics: `USD*`, `*SOL`, `W(BTC|ETH|...)`, and the Jupiter token-list tags `stable`/`stablecoin`, `lst`, `wrapped`, `bridged`, `stocks`, `equities`, `xstocks`, `rwa`, `major`; `eligibility.excludedTags`).
- Governance / utility tokens of major protocols that are not memecoins (e.g. JUP). With the CoinGecko universe (2.6) this is enforced by construction: such tokens are not members of the category; the denylist remains as a backstop.
- Tokens on the manual exclusion list maintained by the Index Committee (`eligibility.denylist`).

#### 2.6 Candidate Universe and Memecoin Classification
- **The candidate universe is CoinGecko's "Solana Meme Coins" category** (`https://www.coingecko.com/en/categories/solana-meme-coins`, API `coins/markets?category=solana-meme-coins`), taken in CoinGecko's market-cap order, up to the top **150** members (`universe.maxCandidates`). **Membership in the category is the index's memecoin classification**: the Index Committee does not judge case by case whether a token "is a memecoin"; CoinGecko's categorisation is adopted as the external, independently maintained reference. Current constituents are always re-evaluated even if they drop out of the category (they then fail eligibility and are proposed for removal at the next reconstitution).
- Each member's **Solana mint** is taken from CoinGecko's platform data (`coins/list?include_platform=true`, falling back to `coins/{id}`); members without a Solana contract, or with a malformed one (not a 32-byte base58 key), are dropped. The mint is then verified on-chain (authorities, decimals, token program) exactly as in 2.1.
- **Ranking market capitalisation** (section 3) is CoinGecko's circulating market cap for category members; where CoinGecko reports none, the Jupiter/DexScreener figure (FDV where circulating is not reported) is used. The methodology run records each candidate's CoinGecko category rank (`cgRank`) and nominating source so every proposal shows e.g. "CG #12".
- **Liquidity, price impact, age, authorities and traded volume are never taken from CoinGecko.** CoinGecko volume includes centralised exchanges; the screens in 2.1-2.4 use Solana on-chain data (mint accounts, Jupiter aggregate DEX volume, DexScreener pools, Jupiter quotes) as before.
- **Manual additions.** The Index Committee may nominate a token that CoinGecko has not (yet) categorised by adding it through the governance path (`keeper add-asset` / `POST /v1/admin/add-asset`, recorded as a `manual` proposal with the committee's note). Manual additions must pass 2.1-2.5 like any other candidate and are reviewed at every reconstitution; the expectation is that CoinGecko catches up and the token becomes an ordinary member. Conversely a token the committee considers *not* a memecoin despite its CoinGecko categorisation is excluded through `eligibility.denylist` (2.5), with the reason published in the announcements.
- Alternative universes remain available for research and as a fallback should the CoinGecko API be unavailable: `universe.source = 'jupiter'` (Jupiter `verified` list ranked by 24h volume, the 1.0.0 definition, where the Jupiter `meme` tag can be required via `eligibility.requireAnyTag`) and `'merged'` (union of both). Switching the production universe is a methodology version change.

---

### 2.7 Token-2022 extensions

A constituent must not carry a Token-2022 `TransferFeeConfig` with a non-zero fee or a `TransferHook` extension. Both are read from the mint account on every methodology run. Metadata-only Token-2022 mints are eligible.

- **Transfer fee: ineligible by rule, admissible only by override.** A transfer fee is withheld on every transfer into or out of the vault. The program is robust to it — vaults are credited with the amount actually *received* (deposits and auction fills are sent gross; `ShortDeposit` / `ShortFill` reject under-paid transfers) and every withdrawal is debited exactly — so the fund is never under-collateralised. The economics are still bad for holders: creators pay the fee on every creation, redeemers receive the net amount on every redemption, every rebalance into or out of the token pays the fee to its fee authority, and the fee authority may raise the fee (one epoch ahead) at any time. The methodology therefore never selects such a token. The Index Committee (later the DAO vote) may admit one explicitly — `keeper add-asset <mint> --force`, or `"allowTransferFee": true` on the basket entry for `init-fund --basket` — and the admission is recorded with `transferFeeBps` in the proposal reason and shown on `/admin`; it is reviewed at every reconstitution like any manual addition.
- **Transfer hook: never.** A hook program runs inside every vault transfer and can make deposits, withdrawals and fills fail outright or depend on third-party state. No override exists (`--force` and the basket flag refuse hooked mints).

### 3. Constituent Selection

1. Eligible tokens are **ranked by market capitalisation** (circulating; FDV where circulating is not reported) in descending order.
2. **Buffer rule.** Current constituents remain in the index as long as they are eligible and ranked **50 or better**. This reduces turnover from tokens oscillating around the cut-off.
3. Open seats (40 minus retained incumbents) are filled by the highest-ranked non-constituents.
4. If more than 40 incumbents satisfy the buffer, the lowest-ranked incumbents are removed until 40 remain.
5. Ties are broken by mint address (deterministic).

If fewer than 40 tokens are eligible the index holds fewer constituents; no ineligible token is ever added to fill seats.

---

### 4. Constituent Weighting

#### 4.1 Equal Weight (headline)

Each constituent receives weight `1/N`, expressed in integer basis points summing to exactly 10,000 (largest-remainder rounding). With 40 constituents every weight is 250 bps.

#### 4.2 Square-root Cap (`sqrt-cap`)

Raw weight ∝ √(market cap). Weights above 12% are set to 12% and weights below 0.5% to 0.5%; the remaining weight is redistributed proportionally among unconstrained constituents and the procedure iterates until no constraint is breached (standard iterative capping; convergence is tested).

#### 4.3 Capped Cap (`capped-cap`)

Raw weight ∝ market cap, iterative 20% cap, no floor.

---

### 5. Index Maintenance

#### 5.1 Scheduled Rebalance
Target weights are restored every **7 days**. Trades are executed on-chain through **permissionless Dutch auctions**: the fund sells the overweight asset for the underweight asset, with the price decaying linearly from Jupiter mid × 1.03 to Jupiter mid × 0.96 over ~150 slots (~60 s). Anyone may fill; the keeper itself fills as a last resort once the price is at or below mid × 0.995, so auctions always complete.

#### 5.2 Drift-triggered Rebalance
Between scheduled dates, a rebalance is triggered when any constituent's effective weight deviates from its target by more than **50% of the target, relative** (`driftRelativeBps` = 5000): |actual − target| / target > 0.5. With 40 equal-weight constituents (target 2.5%) that is a weight above 3.75% or below 1.25%. A constituent in *Removing* status (target 0) with any remaining weight always triggers. The check runs every 60 seconds against the keeper's cached NAV snapshot.

#### 5.3 Liquidity Safety Valve
No single auction may sell more than **5% of the asset's 24-hour volume**. The remainder is queued and executed at the next check (every 60 seconds), subject to the same cap. Trades below USD 25 are ignored.

#### 5.3a Auction Price Bound
Every auction is bounded by on-chain **reference prices**: the program rejects any auction whose end price is more than `max_auction_discount_bps` (5%) below `ref_sell / ref_buy`. Reference prices are refreshed by the keeper after every NAV snapshot but may move at most 20% per day (`max_ref_move_bps` / `ref_move_period_slots`); larger moves require the authority through the 48-hour timelock. A rebalancer therefore cannot open an auction that gives the vault away below market.

#### 5.4 Trade Pairing
Overweight positions are sold into underweight positions, pairing the largest overweight with the largest underweight first (two-pointer matching), which minimises the number of auctions.

#### 5.5 Reconstitution
Eligibility and selection (sections 2 and 3) are evaluated daily, but additions and deletions take effect only at the **monthly reconstitution: 00:00 UTC on the 1st**. The daily run records **proposals** (`GET /v1/proposals`) with the metrics behind them; the **index committee** approves or rejects each one (a rejection is not re-proposed for 90 days). Approved changes are **announced at least 48 hours ahead** via the public `GET /v1/announcements` API and queued on-chain as timelocked actions that anyone can verify (`GET /v1/governance`) and that execute 48 hours later. Deleted constituents are placed in *Removing* status: they no longer participate in creations, their target weight is zero, and they are sold through auctions under the liquidity safety valve until the vault is empty.

#### 5.6 Corporate-action-like Events
Token migrations, contract redeployments and similar events are handled by the Index Committee by treating the new mint as a candidate under the normal rules and the old mint as *Removing*.

---

### 6. Index Calculation

#### 6.1 Divisor Method

```
Level_t   = Σ_i  Price_i,t × EffectiveBalance_i,t  /  Divisor_t
Divisor_0 = Σ_i  Price_i,0 × EffectiveBalance_i,0  /  1000
```

`EffectiveBalance` is the fund vault balance net of in-flight creation deposits and redemption reservations, read from the on-chain `Asset` accounts.

#### 6.2 Divisor Adjustments
Only price changes are index performance. Any change in balances — auction fills, creations, redemptions, additions, deletions — is treated like a share change in a traditional index and offset by re-setting the divisor so that the level is **continuous** at the instant of the event:

```
Divisor_after = Divisor_before × MV_after / MV_before
```

where both market values are computed at the same prices. The keeper performs this reconciliation on every 60-second snapshot and immediately after every detected auction fill.

#### 6.3 Net Asset Value
```
NAV per unit (USD) = Σ_i Price_i × EffectiveBalance_i / IndexSupply
```
NAV per unit was USD 1.00 at inception by construction (bootstrap mint). The index level and NAV per unit diverge over time only through fee accrual (management fee units) and auction slippage, both of which are reported.

#### 6.4 Prices
Spot USD prices from the Jupiter Price API, with DexScreener (liquidity-weighted best pool) as fallback. Constituents with no price are excluded from the level and flagged in the API. CoinGecko prices are not used for the level or NAV; CoinGecko supplies only the universe membership and the ranking market cap (2.6).

---

### 7. Governance

- The **Index Committee** owns this document and the configuration file. Changes are versioned (`version` in config) and announced via the announcements API.
- The fund's on-chain `authority` (multisig in production) is the only key able to add/remove assets or change target weights; the keeper only *proposes* unless it is the authority (test environments).
- All methodology runs (eligibility results with reasons, ranking, selection, weights) are persisted and published at `GET /v1/methodology`.

### 8. Disclaimer
This index measures a basket of highly volatile, speculative crypto-assets. Nothing in this document is investment advice.
