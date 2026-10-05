# FI6900 launch constituents (methodology dry run on live data)

Generated 2026-10-03T21:08:28.115Z by `keeper launch-report` against live sources (CoinGecko, Jupiter https://lite-api.jup.ag, DexScreener, RPC https://api.mainnet-beta.solana.com). SOL = $119.65. Methodology v1.1.0. Universe: CoinGecko category `solana-meme-coins` ranked by market cap (top 150).

**This is the list the index committee approves as the launch index.** Nothing here has been sent on-chain. Re-run before `init-fund`; prices, volumes and impacts move.

Universe 150 tokens → 16 eligible → 16 selected (equal weight, 625 bps each) + 0 alternates.

> Universe source: coingecko (CoinGecko category `solana-meme-coins`, https://api.coingecko.com/api/v3, free tier, no key, 2100 ms spacing); 150 candidates evaluated.
> Incumbents on-chain: 0 (a fresh fund has none; every selected token is an "add").
> 7-day average volume uses the 24h volume as proxy until the keeper has 3 daily observations (methodology 2.4).
> Runtime 229 s; Jupiter calls are rate-limited to one per 2000 ms (free tier).

## 0. Committee notes on this run (hand-written, 2026-10-03, methodology v1.1.0 / CoinGecko universe)

- **Universe change.** This run uses the new candidate universe (methodology 2.6): the top 150 of CoinGecko's "Solana Meme Coins" category ranked by CoinGecko market cap, instead of the Jupiter `verified` list by volume. Membership in the category is the memecoin classification, so the previous run's problem (PUMP, PYTH, RAY, JTO, ZBCN, CARDS, KMNO, MET, NOS and other protocol tokens in the basket; 9 denylist entries recommended) disappears by construction: none of them is in the category. Section 0b shows the raw CoinGecko top 40 as served (compare with the website) next to the screen each one hits. All 150 members resolved to a valid Solana mint (0 dropped, 0 `coins/{id}` lookups needed).
- **15 of CoinGecko's top 40 pass every screen; 25 do not.** By failing screen (a token can fail several): 24 fail the USD 250k 24h DEX-volume floor (methodology 2.4; CoinGecko's own `total_volume` is CEX+DEX and is not used) -- MELANIA ($19k DEX), DOG (Rune bridge, $31k), BABYDOGE ($9k), BAN ($120k), PNUT ($154k), MOODENG ($106k), $CWIF, ZEREBRO ($116k), WOULD, THEROS, GIGA, $FARTBOY, TDCCP, GOAT ($100k), BIRB, PEPECOIN, BINK, BERT, PONKE, HAROLD ($194k), CHILLGUY ($202k), GOLD, SLERF; 5 fail the 2% impact bound on a $10k sell -- SI (also 10 days old: `too_young`), BIRB, HAROLD, MANIFEST (the only top-40 name that fails *only* on impact), plus 2 that could not be quoted because they already failed volume; 2 have a live mint authority -- PEPECOIN (also no Jupiter price) and PONKE; 1 fails seasoning -- SI (Super Inu, first pool 10 days ago). `price_impact_unknown` appears only together with a failed volume screen (quotes run for everything with DEX volume >= $125k).
- **Recommended launch list at the current thresholds (16 names, 625 bps each):** PENGU (CG #1), TRUMP (#2), Bonk (#3), $WIF (#4), USELESS (#5), Fartcoin (#6), BOME (#10), ANSEM (#12), POPCAT (#14), MEW (#15), TROLL (#17), neet (#19), ZCAT (#20), pippin (#29), FO (#31), Buttcoin (#42). Section 1 is this list. 16 constituents is well short of 40; methodology section 3 allows it, but the committee should decide deliberately (see the next two points) rather than discover it on launch day.
- **Recommended launch list at `minVolume24hUsd` = USD 150k (18 names, 555 bps each):** the 16 above plus Pnut (CG #13, $154k DEX volume, 0.33-0.37% buy impact at every seed size) and CHILLGUY (CG #37, $202k, 0.34-0.38%). Section 2b is this list. Lowering the floor to 150k therefore buys only two names; the gap to 40 is structural: Solana memecoin DEX volume is concentrated in roughly 20 names right now, and the next tier (BAN, MOODENG, ZEREBRO, TDCCP, BIRB, HAROLD, GOAT at $100-130k/day) would need a $100k floor, which the 7-day rule (2.4, USD 100k/day) would then bind on. Recommendation: launch with the 16 (or 18 at 150k) and let reconstitution add names as volume returns; do not weaken the impact bound.
- **Names the committee should look at before approving:** ZCAT (CG #20) passes the $10k-sell screen at 1.22% but is 33 days old and a *buy* of 0.31 SOL (5 SOL seed / 16) already moves the price 6.97%; 2.92% even at 50 SOL. It is the only leg above 1% in section 3 and the first run of the evening had it failing the impact bound (1.72% -> 2.1%); it sits on the edge of eligibility and will churn. FO (CG #31): top holders hold 92% of supply, FDV $142.5M vs mcap $16.7M, Jupiter organic score 0 -- a candidate for `eligibility.denylist` on concentration grounds. TRUMP: 81% top holders, FDV 3.6x mcap (team unlocks). ANSEM: 65% top holders, FDV 2.4x mcap. Buttcoin (CG #42) enters only because 26 higher-ranked members fail. Token-2022 mints in the basket: ANSEM, ZCAT, Buttcoin -- check for transfer-fee / transfer-hook extensions (`spl-token display <mint>`) before `init-fund`.
- **Seed sizing:** apart from ZCAT every leg is <= 0.50% at all seed sizes from 5 to 50 SOL (16-name basket, 0.31-3.1 SOL per leg). With ZCAT excluded, any seed in that range is safe under the runbook's 1% rule; with ZCAT included no seed size is. The seed constraint is again AP working capital, not market impact.
- **CoinGecko vs on-chain figures:** ranking uses CoinGecko's circulating market cap (methodology 2.6); for the selected names it agrees with Jupiter within a few percent except ANSEM (CoinGecko $58M vs Jupiter $133M, both self-reported supplies). Volume differences are expected and large (TRUMP: $162M CoinGecko incl. CEX vs $5.4M Solana DEX).
- **Data / rate limits:** 0 rate-limit failures, 0 failed impact or seed quotes. 3 CoinGecko requests (2 category pages are not needed for 150 names: 1 page + the 3.9 MB coins list, now cached 24 h on disk), 2 s Jupiter spacing, 229 s total. CoinGecko free tier, no key.

## 0b. CoinGecko "solana-meme-coins" top 40 by market cap vs the screens

Raw category order as served by `/coins/markets?category=solana-meme-coins&order=market_cap_desc` at generation time (compare with https://www.coingecko.com/en/categories/solana-meme-coins). CoinGecko volume is CEX+DEX; the methodology volume floor uses Solana DEX volume (Jupiter/DexScreener), hence the differences. 15 of 40 are in the proposed basket.

| CG # | Token | CG id | CG mcap | CG 24h vol | DEX 24h vol | Result |
|---|---|---|---|---|---|---|
| 1 | PENGU [2zMM…uauv](https://solscan.io/token/2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv) | `pudgy-penguins` | $581.37M | $131.31M | $7.34M | **selected** #1 |
| 2 | TRUMP [6p6x…GiPN](https://solscan.io/token/6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN) | `official-trump` | $577.40M | $162.11M | $5.43M | **selected** #2 |
| 3 | BONK [DezX…B263](https://solscan.io/token/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263) | `bonk` | $335.42M | $39.87M | $1.86M | **selected** #3 |
| 4 | WIF [EKpQ…zcjm](https://solscan.io/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm) | `dogwifcoin` | $253.81M | $53.28M | $980k | **selected** #4 |
| 5 | USELESS [Dz9m…bonk](https://solscan.io/token/Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk) | `useless-3` | $238.98M | $35.57M | $18.42M | **selected** #5 |
| 6 | FARTCOIN [9BB6…pump](https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump) | `fartcoin` | $177.66M | $31.22M | $5.59M | **selected** #6 |
| 7 | MELANIA [FUAf…xM1P](https://solscan.io/token/FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P) | `melania-meme` | $103.99M | $5.82M | $19k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 8 | DOG [dog1…N65u](https://solscan.io/token/dog1viwbb2vWDpER5FrJ4YFG6gq6XuyFohUe9TXN65u) | `dog-go-to-the-moon-rune` | $94.19M | $567k | $31k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 9 | BABYDOGE [7dUK…xann](https://solscan.io/token/7dUKUopcNWW6CcU4eRxCHh1uiMh32zDrmGf6ufqhxann) | `baby-doge-coin` | $75.58M | $1.97M | $9k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 10 | BOME [ukHH…4J82](https://solscan.io/token/ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82) | `book-of-meme` | $69.23M | $6.56M | $1.06M | **selected** #7 |
| 11 | BAN [9PR7…pump](https://solscan.io/token/9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump) | `comedian` | $65.71M | $3.53M | $120k | fails: volume_24h_too_low, price_impact_unknown |
| 12 | ANSEM [9cRC…pump](https://solscan.io/token/9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump) | `the-black-bull` | $58.27M | $3.43M | $3.33M | **selected** #8 |
| 13 | PNUT [2qEH…pump](https://solscan.io/token/2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump) | `peanut-the-squirrel` | $53.95M | $5.47M | $154k | fails: volume_24h_too_low |
| 14 | POPCAT [7GCi…W2hr](https://solscan.io/token/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr) | `popcat` | $52.38M | $10.77M | $286k | **selected** #9 |
| 15 | MEW [MEW1…cPP5](https://solscan.io/token/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5) | `cat-in-a-dogs-world` | $47.83M | $5.88M | $709k | **selected** #10 |
| 16 | MOODENG [ED5n…PJBY](https://solscan.io/token/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY) | `moo-deng` | $45.87M | $4.04M | $106k | fails: volume_24h_too_low, price_impact_unknown |
| 17 | TROLL [5UUH…hgH2](https://solscan.io/token/5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2) | `troll-2` | $44.78M | $1.20M | $554k | **selected** #11 |
| 18 | SI [DEW9…8WDP](https://solscan.io/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP) | `super-inu-2` | $39.38M | $10.59M | $10.97M | fails: too_young, price_impact_too_high |
| 19 | NEET [Ce2g…pump](https://solscan.io/token/Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump) | `neet` | $37.67M | $2.13M | $2.88M | **selected** #12 |
| 20 | ZCAT [HcRL…DeJR](https://solscan.io/token/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR) | `anonymous-cat` | $35.55M | $4.10M | $3.89M | **selected** #13 |
| 21 | $CWIF [7atg…cFv1](https://solscan.io/token/7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1) | `catwifhat-2` | $32.47M | $324.39 | $300.11 | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 22 | ZEREBRO [8x5V…o2Wn](https://solscan.io/token/8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn) | `zerebro` | $31.37M | $3.88M | $116k | fails: volume_24h_too_low, price_impact_unknown |
| 23 | WOULD [J1Wp…pump](https://solscan.io/token/J1Wpmugrooj1yMyQKrdZ2vwRXG5rhfx3vTnYE39gpump) | `would` | $26.20M | $69k | $67k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 24 | THEROS [2UfB…cPa2](https://solscan.io/token/2UfBjNeDwzZsoUnr3hNKF4vkzAgiGmBNYCAxLq72cPa2) | `theros` | $22.29M | $43k | $42k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 25 | GIGA [63Lf…cqj9](https://solscan.io/token/63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9) | `gigachad-2` | $21.06M | $1.65M | $60k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 26 | $FARTBOY [y1AZ…pump](https://solscan.io/token/y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump) | `fartboy` | $19.49M | $1.15M | $77k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 27 | TDCCP [Hg8b…mfrD](https://solscan.io/token/Hg8bKz4mvs8KNj9zew1cEF9tDw1x2GViB4RFZjVEmfrD) | `tdccp` | $19.20M | $84k | $110k | fails: volume_24h_too_low, price_impact_unknown |
| 28 | GOAT [CzLS…pump](https://solscan.io/token/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump) | `goatseus-maximus` | $19.08M | $1.65M | $100k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 29 | PIPPIN [Dfh5…pump](https://solscan.io/token/Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump) | `pippin` | $18.50M | $1.51M | $255k | **selected** #14 |
| 30 | BIRB [G7vQ…KNwG](https://solscan.io/token/G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG) | `moonbirds` | $18.04M | $943k | $130k | fails: volume_24h_too_low, price_impact_too_high |
| 31 | FO [JDzP…ai2o](https://solscan.io/token/JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o) | `official-fo` | $16.65M | $281k | $458k | **selected** #15 |
| 32 | PEPECOIN [EXJv…1eZ6](https://solscan.io/token/EXJvx3KksbWP9QmPmtRr8mkQXD2kZrFRENCJitMs1eZ6) | `pepecoin-2` | $15.57M | $119k | $0.00 | fails: mint_authority, no_price, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 33 | BINK [CeK6…c3vz](https://solscan.io/token/CeK6k4BMmiqkxkzYAbQuUp3hrVFSHxuQ1LJXmNybc3vz) | `big-dog-fink` | $14.76M | $461.67 | $484.89 | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 34 | BERT [HgBR…pump](https://solscan.io/token/HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump) | `bertram-the-pomeranian` | $13.91M | $679k | $41k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 35 | PONKE [5z3E…mrRC](https://solscan.io/token/5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC) | `ponke` | $13.55M | $881k | $19k | fails: mint_authority, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 36 | HAROLD [3vgo…DzVt](https://solscan.io/token/3vgopg7xm3EWkXfxmWPUpcf7g939hecfqg18sLuXDzVt) | `haroldonsol` | $13.45M | $169k | $194k | fails: volume_24h_too_low, price_impact_too_high |
| 37 | CHILLGUY [Df6y…pump](https://solscan.io/token/Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump) | `chill-guy` | $13.15M | $3.48M | $202k | fails: volume_24h_too_low |
| 38 | GOLD [LRxb…pump](https://solscan.io/token/LRxbtkvPfpctgR6MS52MAwtobrCCY9KiJgKMmpPpump) | `stairway-to-gold` | $12.53M | $7k | $7k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 39 | SLERF [7BgB…VkM3](https://solscan.io/token/7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3) | `slerf` | $11.67M | $16k | $29k | fails: volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 40 | MANIFEST [BCdw…pump](https://solscan.io/token/BCdwQBAn8dYB5YjTsoB6TdHAWokxv28k2oZUodERpump) | `manifesting` | $10.55M | $458k | $415k | fails: price_impact_too_high |

## 1. Proposed basket (top 16, 625 bps each)

| # | Token | Source | Mcap | FDV | 24h vol | Liquidity | Age | $10k sell impact | Mint / freeze auth | Holders | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PENGU [2zMM…uauv](https://solscan.io/token/2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv) | CG #1 | $581.37M | $823.44M | $7.34M | $10.53M | 656d | 0.00% | revoked / revoked | 561155 |  |
| 2 | TRUMP [6p6x…GiPN](https://solscan.io/token/6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN) | CG #2 | $577.40M | $2.05B | $5.43M | $29.93M | 624d | 0.01% | revoked / revoked | 668986 | ⚠ top holders 81% of supply; FDV $2.05B vs mcap $577.40M (large non-circulating supply) |
| 3 | Bonk [DezX…B263](https://solscan.io/token/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263) | CG #3 | $335.42M | $338.95M | $1.86M | $6.76M | 1383d | 0.20% | revoked / revoked | 1026054 |  |
| 4 | $WIF [EKpQ…zcjm](https://solscan.io/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm) | CG #4 | $253.81M | $253.81M | $980k | $7.30M | 1048d | 0.48% | revoked / revoked | 264899 |  |
| 5 | USELESS [Dz9m…bonk](https://solscan.io/token/Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk) | CG #5 | $238.98M | $238.98M | $18.42M | $9.15M | 511d | 0.18% | revoked / revoked | 69397 |  |
| 6 | Fartcoin [9BB6…pump](https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump) | CG #6 | $177.66M | $177.66M | $5.59M | $10.70M | 715d | 0.25% | revoked / revoked | 192263 |  |
| 7 | BOME [ukHH…4J82](https://solscan.io/token/ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82) | CG #10 | $69.23M | $69.23M | $1.06M | $18.01M | 933d | 0.25% | revoked / revoked | 92278 |  |
| 8 | ANSEM [9cRC…pump](https://solscan.io/token/9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump) | CG #12 | $58.27M | $139.39M | $3.33M | $3.86M | 109d | 0.44% | revoked / revoked | 146301 | ⚠ top holders 65% of supply; FDV $139.39M vs mcap $58.27M (large non-circulating supply); Token-2022 mint (check transfer-fee / hook extensions) |
| 9 | POPCAT [7GCi…W2hr](https://solscan.io/token/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr) | CG #14 | $52.38M | $52.38M | $286k | $4.84M | 1026d | 0.39% | revoked / revoked | 142620 |  |
| 10 | MEW [MEW1…cPP5](https://solscan.io/token/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5) | CG #15 | $47.83M | $47.83M | $709k | $11.06M | 921d | 0.26% | revoked / revoked | 158963 | ⚠ top holders 55% of supply |
| 11 | TROLL [5UUH…hgH2](https://solscan.io/token/5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2) | CG #17 | $44.78M | $44.78M | $554k | $3.64M | 531d | 0.69% | revoked / revoked | 70272 |  |
| 12 | neet [Ce2g…pump](https://solscan.io/token/Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump) | CG #19 | $37.67M | $37.76M | $2.88M | $3.21M | 524d | 0.82% | revoked / revoked | 31895 |  |
| 13 | ZCAT [HcRL…DeJR](https://solscan.io/token/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR) | CG #20 | $35.55M | $37.33M | $3.89M | $1.73M | 33d | 1.22% | revoked / revoked | 29143 | ⚠ Token-2022 mint (check transfer-fee / hook extensions) |
| 14 | pippin [Dfh5…pump](https://solscan.io/token/Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump) | CG #29 | $18.50M | $18.50M | $255k | $4.32M | 693d | 0.80% | revoked / revoked | 48113 |  |
| 15 | FO [JDzP…ai2o](https://solscan.io/token/JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o) | CG #31 | $16.65M | $142.53M | $458k | $6.10M | 535d | 1.55% | revoked / revoked | 155028 | ⚠ top holders 92% of supply; low organic score 0; FDV $142.53M vs mcap $16.65M (large non-circulating supply) |
| 16 | Buttcoin [Cm6f…pump](https://solscan.io/token/Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump) | CG #42 | $10.18M | $10.18M | $367k | $1.21M | 267d | 1.63% | revoked / revoked | 21289 | ⚠ Token-2022 mint (check transfer-fee / hook extensions) |

## 2. Alternates (next 0 eligible by market cap)

| # | Token | Source | Mcap | FDV | 24h vol | Liquidity | Age | $10k sell impact | Mint / freeze auth | Holders | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|

## 2b. Variant: minVolume24hUsd = $150k

Same candidates and screens, with the 24h DEX-volume floor lowered from $250k to $150k (the alternative the committee is considering so the index reaches closer to 40 names). Everything else (FDV, age, authorities, 2% impact, 7d volume) is unchanged.

18 eligible -> 18 selected. Versus section 1: drops nothing; adds Pnut, CHILLGUY.

| # | Token | Source | Mcap | FDV | 24h vol | Liquidity | Age | $10k sell impact | Mint / freeze auth | Holders | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PENGU [2zMM…uauv](https://solscan.io/token/2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv) | CG #1 | $581.37M | $823.44M | $7.34M | $10.53M | 656d | 0.00% | revoked / revoked | 561155 |  |
| 2 | TRUMP [6p6x…GiPN](https://solscan.io/token/6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN) | CG #2 | $577.40M | $2.05B | $5.43M | $29.93M | 624d | 0.01% | revoked / revoked | 668986 | ⚠ top holders 81% of supply; FDV $2.05B vs mcap $577.40M (large non-circulating supply) |
| 3 | Bonk [DezX…B263](https://solscan.io/token/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263) | CG #3 | $335.42M | $338.95M | $1.86M | $6.76M | 1383d | 0.20% | revoked / revoked | 1026054 |  |
| 4 | $WIF [EKpQ…zcjm](https://solscan.io/token/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm) | CG #4 | $253.81M | $253.81M | $980k | $7.30M | 1048d | 0.48% | revoked / revoked | 264899 |  |
| 5 | USELESS [Dz9m…bonk](https://solscan.io/token/Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk) | CG #5 | $238.98M | $238.98M | $18.42M | $9.15M | 511d | 0.18% | revoked / revoked | 69397 |  |
| 6 | Fartcoin [9BB6…pump](https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump) | CG #6 | $177.66M | $177.66M | $5.59M | $10.70M | 715d | 0.25% | revoked / revoked | 192263 |  |
| 7 | BOME [ukHH…4J82](https://solscan.io/token/ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82) | CG #10 | $69.23M | $69.23M | $1.06M | $18.01M | 933d | 0.25% | revoked / revoked | 92278 |  |
| 8 | ANSEM [9cRC…pump](https://solscan.io/token/9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump) | CG #12 | $58.27M | $139.39M | $3.33M | $3.86M | 109d | 0.44% | revoked / revoked | 146301 | ⚠ top holders 65% of supply; FDV $139.39M vs mcap $58.27M (large non-circulating supply); Token-2022 mint (check transfer-fee / hook extensions) |
| 9 | Pnut [2qEH…pump](https://solscan.io/token/2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump) | CG #13 | $53.95M | $53.95M | $154k | $3.73M | 702d | 0.64% | revoked / revoked | 88381 |  |
| 10 | POPCAT [7GCi…W2hr](https://solscan.io/token/7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr) | CG #14 | $52.38M | $52.38M | $286k | $4.84M | 1026d | 0.39% | revoked / revoked | 142620 |  |
| 11 | MEW [MEW1…cPP5](https://solscan.io/token/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5) | CG #15 | $47.83M | $47.83M | $709k | $11.06M | 921d | 0.26% | revoked / revoked | 158963 | ⚠ top holders 55% of supply |
| 12 | TROLL [5UUH…hgH2](https://solscan.io/token/5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2) | CG #17 | $44.78M | $44.78M | $554k | $3.64M | 531d | 0.69% | revoked / revoked | 70272 |  |
| 13 | neet [Ce2g…pump](https://solscan.io/token/Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump) | CG #19 | $37.67M | $37.76M | $2.88M | $3.21M | 524d | 0.82% | revoked / revoked | 31895 |  |
| 14 | ZCAT [HcRL…DeJR](https://solscan.io/token/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR) | CG #20 | $35.55M | $37.33M | $3.89M | $1.73M | 33d | 1.22% | revoked / revoked | 29143 | ⚠ Token-2022 mint (check transfer-fee / hook extensions) |
| 15 | pippin [Dfh5…pump](https://solscan.io/token/Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump) | CG #29 | $18.50M | $18.50M | $255k | $4.32M | 693d | 0.80% | revoked / revoked | 48113 |  |
| 16 | FO [JDzP…ai2o](https://solscan.io/token/JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o) | CG #31 | $16.65M | $142.53M | $458k | $6.10M | 535d | 1.55% | revoked / revoked | 155028 | ⚠ top holders 92% of supply; low organic score 0; FDV $142.53M vs mcap $16.65M (large non-circulating supply) |
| 17 | CHILLGUY [Df6y…pump](https://solscan.io/token/Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump) | CG #37 | $13.15M | $13.15M | $202k | $1.57M | 727d | 1.34% | revoked / revoked | 117627 |  |
| 18 | Buttcoin [Cm6f…pump](https://solscan.io/token/Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump) | CG #42 | $10.18M | $10.18M | $367k | $1.21M | 267d | 1.63% | revoked / revoked | 21289 | ⚠ Token-2022 mint (check transfer-fee / hook extensions) |

## 3. Seed sizing (Jupiter ExactIn quotes SOL → token, per-asset buy = seed / N)

Price impact of each constituent buy at launch, for the candidate seed sizes. `—` = quote failed / no route at that size. The runbook treats a seed as safe when every leg is ≤ 1.00% impact; the $10k-sell screen (≤ 2%) is the methodology bound, the buy legs below are what `init-fund --sol` will actually pay.

| Token | 5 SOL (0.313 SOL/asset ≈ $37.39) | 10 SOL (0.625 SOL/asset ≈ $74.78) | 25 SOL (1.563 SOL/asset ≈ $186.95) | 50 SOL (3.125 SOL/asset ≈ $373.90) |
|---|---|---|---|---|
| PENGU | 0.00% | 0.00% | 0.02% | 0.00% |
| TRUMP | 0.00% | 0.00% | 0.06% | 0.01% |
| Bonk | 0.00% | 0.00% | 0.00% | 0.00% |
| $WIF | 0.00% | 0.00% | 0.00% | 0.09% |
| USELESS | 0.10% | 0.00% | 0.00% | 0.04% |
| Fartcoin | 0.00% | 0.00% | 0.10% | 0.05% |
| BOME | 0.11% | 0.23% | 0.34% | 0.33% |
| ANSEM | 0.00% | 0.00% | 0.34% | 0.00% |
| POPCAT | 0.34% | 0.46% | 0.49% | 0.49% |
| MEW | 0.38% | 0.34% | 0.32% | 0.34% |
| TROLL | 0.10% | 0.16% | 0.00% | 0.50% |
| neet | 0.21% | 0.22% | 0.27% | 0.27% |
| ZCAT | 6.97% | 6.33% | 3.25% | 2.92% |
| pippin | 0.00% | 0.00% | 0.00% | 0.00% |
| FO | 0.01% | 0.00% | 0.03% | 0.06% |
| Buttcoin | 0.12% | 0.08% | 0.15% | 0.25% |
| Pnut (variant only) | 0.37% | 0.36% | 0.33% | 0.35% |
| CHILLGUY (variant only) | 0.38% | 0.36% | 0.34% | 0.36% |

| Seed | Seed USD | Worst leg impact | legs > 0.50% | legs > 1.00% | legs unquoted |
|---|---|---|---|---|---|
| 5 SOL | $598.23 | 6.97% | 1 | 1 | 0 |
| 10 SOL | $1k | 6.33% | 1 | 1 | 0 |
| 25 SOL | $3k | 3.25% | 1 | 1 | 0 |
| 50 SOL | $6k | 2.92% | 1 | 1 | 0 |

## 4. Excluded tokens (and why)

| Token | Source | Mcap | 24h vol | Reasons |
|---|---|---|---|---|
| MELANIA [FUAf…xM1P](https://solscan.io/token/FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P) | CG #7 | $103.99M | $19k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| DOG [dog1…N65u](https://solscan.io/token/dog1viwbb2vWDpER5FrJ4YFG6gq6XuyFohUe9TXN65u) | CG #8 | $94.19M | $31k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BabyDoge [7dUK…xann](https://solscan.io/token/7dUKUopcNWW6CcU4eRxCHh1uiMh32zDrmGf6ufqhxann) | CG #9 | $75.58M | $9k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Ban [9PR7…pump](https://solscan.io/token/9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump) | CG #11 | $65.71M | $120k | volume_24h_too_low, price_impact_unknown |
| Pnut [2qEH…pump](https://solscan.io/token/2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump) | CG #13 | $53.95M | $154k | volume_24h_too_low |
| MOODENG [ED5n…PJBY](https://solscan.io/token/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY) | CG #16 | $45.87M | $106k | volume_24h_too_low, price_impact_unknown |
| SI [DEW9…8WDP](https://solscan.io/token/DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP) | CG #18 | $39.38M | $10.97M | too_young, price_impact_too_high |
| $CWIF [7atg…cFv1](https://solscan.io/token/7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1) | CG #21 | $32.47M | $300.11 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| ZEREBRO [8x5V…o2Wn](https://solscan.io/token/8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn) | CG #22 | $31.37M | $116k | volume_24h_too_low, price_impact_unknown |
| WOULD [J1Wp…pump](https://solscan.io/token/J1Wpmugrooj1yMyQKrdZ2vwRXG5rhfx3vTnYE39gpump) | CG #23 | $26.20M | $67k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| THEROS [2UfB…cPa2](https://solscan.io/token/2UfBjNeDwzZsoUnr3hNKF4vkzAgiGmBNYCAxLq72cPa2) | CG #24 | $22.29M | $42k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| GIGA [63Lf…cqj9](https://solscan.io/token/63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9) | CG #25 | $21.06M | $60k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| FARTBOY [y1AZ…pump](https://solscan.io/token/y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump) | CG #26 | $19.49M | $77k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| TDCCP [Hg8b…mfrD](https://solscan.io/token/Hg8bKz4mvs8KNj9zew1cEF9tDw1x2GViB4RFZjVEmfrD) | CG #27 | $19.20M | $110k | volume_24h_too_low, price_impact_unknown |
| GOAT [CzLS…pump](https://solscan.io/token/CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump) | CG #28 | $19.08M | $100k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BIRB [G7vQ…KNwG](https://solscan.io/token/G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG) | CG #30 | $18.04M | $130k | volume_24h_too_low, price_impact_too_high |
| pepecoin [EXJv…1eZ6](https://solscan.io/token/EXJvx3KksbWP9QmPmtRr8mkQXD2kZrFRENCJitMs1eZ6) | CG #32 | $15.57M | $0.00 | mint_authority, no_price, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BINK [CeK6…c3vz](https://solscan.io/token/CeK6k4BMmiqkxkzYAbQuUp3hrVFSHxuQ1LJXmNybc3vz) | CG #33 | $14.76M | $484.89 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Bert [HgBR…pump](https://solscan.io/token/HgBRWfYxEfvPhtqkaeymCQtHCrKE46qQ43pKe8HCpump) | CG #34 | $13.91M | $41k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| PONKE [5z3E…mrRC](https://solscan.io/token/5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC) | CG #35 | $13.55M | $19k | mint_authority, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| HAROLD [3vgo…DzVt](https://solscan.io/token/3vgopg7xm3EWkXfxmWPUpcf7g939hecfqg18sLuXDzVt) | CG #36 | $13.45M | $194k | volume_24h_too_low, price_impact_too_high |
| CHILLGUY [Df6y…pump](https://solscan.io/token/Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump) | CG #37 | $13.15M | $202k | volume_24h_too_low |
| GOLD [LRxb…pump](https://solscan.io/token/LRxbtkvPfpctgR6MS52MAwtobrCCY9KiJgKMmpPpump) | CG #38 | $12.53M | $7k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Old Slerf [7BgB…VkM3](https://solscan.io/token/7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3) | CG #39 | $11.67M | $29k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MANIFEST [BCdw…pump](https://solscan.io/token/BCdwQBAn8dYB5YjTsoB6TdHAWokxv28k2oZUodERpump) | CG #40 | $10.55M | $415k | price_impact_too_high |
| Clash [6nR8…pump](https://solscan.io/token/6nR8wBnfsmXfcdDr1hovJKjvFQxNSidN6XFyfAFZpump) | CG #41 | $10.34M | $37k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| ACT [GJAF…pump](https://solscan.io/token/GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump) | CG #43 | $10.10M | $64k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MCDULL [Buoj…6pCr](https://solscan.io/token/Buoj8HCZMnLRwzDmjzaswhkVhLZD58PG4pZ7rnYp6pCr) | CG #44 | $8.90M | $360.46 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| aura [DtR4…k9B2](https://solscan.io/token/DtR4D9FtVoTX2569gaL837ZgrB6wNjj6tkmnX9Rdk9B2) | CG #45 | $8.24M | $75k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| VINE [6AJc…pump](https://solscan.io/token/6AJcP7wuLwmRYLBNbi825wgguaPsWzPBEHcHndpRpump) | CG #46 | $7.99M | $23k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| UFD [eL5f…pump](https://solscan.io/token/eL5fUxj2J4CiQsmW85k5FG9DvuQjjUoBHoQBi2Kpump) | CG #47 | $7.85M | $17k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| TripleT [J8PS…pump](https://solscan.io/token/J8PSdNP3QewKq2Z1JJJFDMaqF7KcaiJhR7gbr5KZpump) | CG #48 | $7.70M | $299k | price_impact_too_high |
| CAW [CAW7…KiH8](https://solscan.io/token/CAW777xcHVTQZ4CRwVQGB8CV1BVKPm5bNVxFJHWFKiH8) | CG #49 | $6.19M | $381.12 | mint_authority, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| FWOG [A8C3…pump](https://solscan.io/token/A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump) | CG #50 | $6.16M | $21k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SOSANA [49jd…YFMj](https://solscan.io/token/49jdQxUkKtuvorvnwWqDzUoYKEjfgroTzHkQqXG9YFMj) | CG #51 | $5.94M | $318.57 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| PURPE [HBoN…GkvL](https://solscan.io/token/HBoNJ5v8g71s2boRivrHnfSB5MVPLDHHyVjruPfhGkvL) | CG #52 | $5.89M | $18k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| GBACK [Fh7m…pump](https://solscan.io/token/Fh7mLxtPAysdvHcMcJ37A3vc6WvBVh7JVDwxmwk6pump) | CG #53 | $5.75M | $6k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| DAWS [DAWS…PzVo](https://solscan.io/token/DAWSx42bkWESmss99qtQdrBggRKCaB5bFVt3q2vcPzVo) | CG #54 | $5.70M | $2k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BOBO [4nV5…pump](https://solscan.io/token/4nV5gNwwP68zUDat26ySChREqVaQaLudfJBkSgEzpump) | CG #55 | $5.56M | $32k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| ALLINU [4MMQ…XKY8](https://solscan.io/token/4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8) | CG #56 | $5.49M | $897k | price_impact_too_high |
| TBB [42cX…pump](https://solscan.io/token/42cXQvAAr7hcPBPWAS4ocVtDyeJ4Fa6gRR2uG4gppump) | CG #57 | $5.44M | $6k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| WEN [WENW…LCpk](https://solscan.io/token/WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk) | CG #58 | $4.97M | $16k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| jobcoin [AyrQ…pump](https://solscan.io/token/AyrQpt5xsVYiN4BqgZdd2tZJAWswT9yLUZmP1jKqpump) | CG #59 | $4.67M | $5k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| fone [CTPo…pump](https://solscan.io/token/CTPoyCwkjMvoJwU4xvZZqoD8tiYk6yDchySiN5gGpump) | CG #60 | $4.45M | $674k | price_impact_too_high |
| crypto [4ikw…pump](https://solscan.io/token/4ikwYoNvoGEwtMbziUyYBTz1zRM6nmxspsfw9G7Bpump) | CG #61 | $4.40M | $23k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| TSUKI [463S…URVA](https://solscan.io/token/463SK47VkB7uE7XenTHKiVcMtxRsfNE2X4Q9wByaURVA) | CG #62 | $4.38M | $6k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| LUX [3bSG…W3w2](https://solscan.io/token/3bSGpKYPut6RXDxp41nvb2GM7eR4kEmJExFFHoYkW3w2) | CG #63 | $4.18M | $0.00 | mint_authority, no_price, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Scam [9mNj…bonk](https://solscan.io/token/9mNjA6BizTwpvd4DS3o7BjwZ6aPM9DC2jLHS7JFGbonk) | CG #64 | $4.07M | $949.18 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| $NAP [4G86…72nu](https://solscan.io/token/4G86CMxGsMdLETrYnavMFKPhQzKTvDBYGMRAdVtr72nu) | CG #65 | $4.01M | $8.97 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| pwease [CniP…pump](https://solscan.io/token/CniPCE4b3s8gSUPhUiyMjXnytrEqUrMfSsnbBjLCpump) | CG #66 | $3.86M | $21k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| KORI [HtTY…bonk](https://solscan.io/token/HtTYHz1Kf3rrQo6AqDLmss7gq5WrkWAaXn3tupUZbonk) | CG #67 | $3.74M | $29k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| STNK [43VW…H7We](https://solscan.io/token/43VWkd99HjqkhFTZbWBpMpRhjG469nWa7x7uEsgSH7We) | CG #68 | $3.73M | $32k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| USDUC [CB9d…pump](https://solscan.io/token/CB9dDufT3ZuQXqqSfa1c5kY935TEreyBw9XJXxHKpump) | CG #69 | $3.71M | $63k | excluded_symbol, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| GME [8wXt…iHsB](https://solscan.io/token/8wXtPeU6557ETkp9WHFY1n1EcU6NxDvbAggHGsMYiHsB) | CG #70 | $3.64M | $95k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MORI [8ZHE…Df5e](https://solscan.io/token/8ZHE4ow1a2jjxuoMfyExuNamQNALv5ekZhsBn5nMDf5e) | CG #71 | $3.61M | $43k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| NEARKAT [6UtY…Zcxr](https://solscan.io/token/6UtY9iTZMQQ5QZVrbzFnNaJntV7oySm9k97mvwnuZcxr) | CG #72 | $3.59M | $201k | volume_24h_too_low, price_impact_too_high |
| BIRTHDAY [DY9e…pump](https://solscan.io/token/DY9eMcfexuwBzwYVBGodT941AhK8e1ABcBifHvKjpump) | CG #73 | $3.47M | $5k | too_young, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Chonketha [Hcfn…pump](https://solscan.io/token/HcfnJxLov6tY8i1dq9uYRRZKCvxADPpovcfkyXzdpump) | CG #74 | $3.44M | $13k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MICHI [AywA…pump](https://solscan.io/token/AywAYdNJnSLSXwKWYxDciPjqGRnwp4iZdQptuuQTpump) | CG #75 | $3.26M | $8k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| WADDLESLIV [Cgoz…pump](https://solscan.io/token/CgozZUAkJXYYBEiCmbeECxkQzVihahtncDho7pX9pump) | CG #76 | $3.20M | $14k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| PAIN [1Qf8…pain](https://solscan.io/token/1Qf8gESP4i6CFNWerUSDdLKJ9U1LpqTYvjJ2MM4pain) | CG #77 | $3.18M | $3k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| WSOS [wsos…Ehar](https://solscan.io/token/wsosWQDzBHibcjJefnfjd7VHQcReZQhhUNTxxgmEhar) | CG #78 | $2.91M | $89k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| KET [9Pfy…pump](https://solscan.io/token/9Pfync3ejPC9eHqVzq3nYQJAhyhjqpnB9UsaSfLxpump) | CG #79 | $2.81M | $77k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| V2EX [9raU…pump](https://solscan.io/token/9raUVuzeWUk53co63M4WXLWPWE4Xc6Lpn7RS9dnkpump) | CG #80 | $2.79M | $1k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| COIN [3xvL…LvXp](https://solscan.io/token/3xvLSHrLcM7246X1vu34cM9gNX741kQrzqj6T2HhLvXp) | CG #81 | $2.74M | $115k | volume_24h_too_low, price_impact_unknown |
| PUNDU [Wskz…DePC](https://solscan.io/token/WskzsKqEW3ZsmrhPAevfVZb6PuuLzWov9mJWZsfDePC) | CG #82 | $2.62M | $74.64 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| VIBECOIN [AZbe…tDUB](https://solscan.io/token/AZbem4s8iLJE5eniDZJ7c8q1ahbfMwWgCA8TxVW2tDUB) | CG #83 | $2.58M | $7k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| RAGEGUY [GvV7…pump](https://solscan.io/token/GvV7sFu6FHJsSVXfpG7xqFnWar3c7YkcC74rqe7Bpump) | CG #84 | $2.51M | $11k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SLOTH [HQ7D…dmBh](https://solscan.io/token/HQ7DaoiUxzC2K1Dr7KXRHccNtXvEYgNvoUextXe8dmBh) | CG #85 | $2.51M | $11k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| KNOTS [8RVB…EGkS](https://solscan.io/token/8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS) | CG #86 | $2.50M | $436k | price_impact_too_high |
| retire [zGh4…pump](https://solscan.io/token/zGh48JtNHVBb5evgoZLXwgPD2Qu4MhkWdJLGDAupump) | CG #87 | $2.50M | $10k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| LMAO! [H74C…pump](https://solscan.io/token/H74CYmXgMkYHYuSRsZt6RJb4NYp2u72Vw8BS5huApump) | CG #88 | $2.47M | $609k | price_impact_too_high |
| 67 [9Avy…pump](https://solscan.io/token/9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump) | CG #89 | $2.40M | $93k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MYRO [Bm3d…pump](https://solscan.io/token/Bm3dgkZrjH7eaz1GBH1R2ZHkp7nZUoPNJhjekoxepump) | CG #90 | $2.25M | $23k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Fapcoin [8vGr…pump](https://solscan.io/token/8vGr1eX9vfpootWiUPYa5kYoGx9bTuRy2Xc4dNMrpump) | CG #91 | $2.25M | $22k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| xavier [69G8…pump](https://solscan.io/token/69G8CpUVZAxbPMiEBrfCCCH445NwFxH6PzVL693Xpump) | CG #92 | $2.25M | $10k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| HODL [Hh3o…pump](https://solscan.io/token/Hh3oTaqDCKKfdBgsQEvxp9sUwyNf8x9qmKqEMLBWpump) | CG #93 | $2.21M | $28k | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| swordcat [5tCj…pump](https://solscan.io/token/5tCju6YNxHq5zrA6tGndr6F7TK42mpUFmeE31cSFpump) | CG #94 | $2.08M | $4.74M | too_young, price_impact_too_high |
| KIBSHI [BxBk…UN1R](https://solscan.io/token/BxBkTCHsrcYChcwB459CAGPX9x4fWSVnmzqh5efgUN1R) | CG #95 | $2.02M | $33.49 | mint_authority, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| POX [mpox…1xkn](https://solscan.io/token/mpoxP5wyoR3eRW8L9bZjGPFtCsmX8WcqU5BHxFW1xkn) | CG #96 | $1.94M | $1k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| EPIK [3Bgw…sBRw](https://solscan.io/token/3BgwJ8b7b9hHX4sgfZ2KJhv9496CoVfsMK2YePevsBRw) | CG #97 | $1.93M | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| CALI [8k4s…PbAA](https://solscan.io/token/8k4sBtEeK4pf26noKqApv8NBTnuSJcbdwpKYknk5PbAA) | CG #98 | $1.92M | $562k | fdv_too_low, price_impact_unknown |
| HEGE [ULwS…HXFy](https://solscan.io/token/ULwSJmmpxmnRfpu6BjnK6rprKXqD5jXUmPpS1FxHXFy) | CG #99 | $1.92M | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| TOAD [A13o…pump](https://solscan.io/token/A13oRB9FFaiUjfi6LdCg6p9ka1u8SfGkUFs4SKvPpump) | CG #100 | $1.90M | $103k | fdv_too_low, volume_24h_too_low, price_impact_unknown |
| Jotchua [BcHE…pump](https://solscan.io/token/BcHEaaTCvycPwwsJ9yQTXdHP9X2gCLkznDbZ8VySpump) | CG #101 | $1.90M | $38k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BP [3B1i…pump](https://solscan.io/token/3B1ijcocM5EDga6XxQ7JLW7weocQPWWjuhBYG8Vepump) | CG #102 | $1.89M | $53k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| $WHISKEY [9UNq…F5Ph](https://solscan.io/token/9UNqoPEXXxEnEphmyYsZYdL5dnmAUtdiKRUchpnUF5Ph) | CG #103 | $1.86M | $292.56 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Hosico [Dx2b…bonk](https://solscan.io/token/Dx2bQe2UPv4k3BmcW8G2KhaL5oKsxduM5XxLSV3Sbonk) | CG #104 | $1.83M | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| USA [69kd…cbAs](https://solscan.io/token/69kdRLyP5DTRkpHraaSZAQbWmAwzF9guKjZfzMXzcbAs) | CG #105 | $1.79M | $4k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SAMO [7xKX…gAsU](https://solscan.io/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU) | CG #106 | $1.78M | $7k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MANSION [3srd…pump](https://solscan.io/token/3srdiFxca22oK1g7qdbGGe9qXy4aS9QGVdTETCBFpump) | CG #107 | $1.63M | $49.14 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| QUACK [9HGz…No6N](https://solscan.io/token/9HGziACBczM3VorD3B6ZYtj6BA595jq8erzsSVtUNo6N) | CG #108 | $1.57M | $0.00 | mint_authority, no_price, age_unknown, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| RONNIE [FnYJ…Wray](https://solscan.io/token/FnYJv5yaNwiQAPmwXuiVtwCcRwNcVVWvbmujZXKUWray) | CG #109 | $1.56M | $22k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BITTY [dTzE…pump](https://solscan.io/token/dTzEP9JU2NRDPuWtM32gaVKip2fTHBqjheU1APBpump) | CG #110 | $1.55M | $15k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| OGDOGE [utLy…doge](https://solscan.io/token/utLyQQCPvjuCc6zeaXdsFeEC3JNdxKS3vxaZWoGdoge) | CG #111 | $1.55M | $24k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| PP [ch7r…pump](https://solscan.io/token/ch7rTovcUK7C1zNFM7F93kXU2CByYUsJT4pwYx7pump) | CG #112 | $1.49M | $910.59 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Tokabu [H8xQ…pump](https://solscan.io/token/H8xQ6poBjB9DTPMDTKWzWPrnxu4bDEhybxiouF8Ppump) | CG #113 | $1.47M | $11k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| NUMMUS [9JK2…5ray](https://solscan.io/token/9JK2U7aEkp3tWaFNuaJowWRgNys5DVaKGxWk73VT5ray) | CG #114 | $1.46M | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| CHILLHOUSE [GkyP…pump](https://solscan.io/token/GkyPYa7NnCFbduLknCfBfP7p8564X1VZhwZYJ6CZpump) | CG #115 | $1.45M | $36k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| ZReaL [GnFM…pump](https://solscan.io/token/GnFMf6JVRhAqPbA9r8yW16xycynKNkXfbaYbusLEpump) | CG #116 | $1.43M | $5k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| BELIEVE [BLVx…aCMf](https://solscan.io/token/BLVxek8YMXUQhcKmMvrFTrzh5FXg8ec88Crp6otEaCMf) | CG #117 | $1.42M | $9k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| TEB [Dx68…pump](https://solscan.io/token/Dx68jydZnXJkp6Xngku8FbjFFovp9tZmXT66jrLXpump) | CG #118 | $1.39M | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| RETARDIO [6ogz…hitx](https://solscan.io/token/6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx) | CG #119 | $1.35M | $65k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Chud [6yjN…syM6](https://solscan.io/token/6yjNqPzTSanBWSa6dxVEgTjePXBrZ2FoHLDQwYwEsyM6) | CG #120 | $1.34M | $13k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SOLANGELES [8wxk…pump](https://solscan.io/token/8wxkvAfEns76yBzu4MnbV7VnXWjg3iDPA9uwAQ6cpump) | CG #121 | $1.30M | $37k | excluded_symbol, fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SIGMA [5SVG…pump](https://solscan.io/token/5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump) | CG #122 | $1.29M | $12k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 401jk [Cz7L…pump](https://solscan.io/token/Cz7LGKdZPpAxonXx23ZYPW3RtDQvjcf17ZDCZEzFpump) | CG #123 | $1.24M | $1k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| HEEHEE [9dLu…xpHg](https://solscan.io/token/9dLuVbJMd4ZpTpFgmaFHAGSsFwVjtcnzFWaLAA1expHg) | CG #124 | $1.17M | $7k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MONKEYS [7TSC…kLqw](https://solscan.io/token/7TSCoke2mSZzAtyuRmzANf9virrnyv4xSUeaxUrKkLqw) | CG #125 | $1.15M | $0.99 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SHITZU [AFbJ…3VRS](https://solscan.io/token/AFbJW5rdaGidnF6o8ZqTtkDBpq3fotSBdJN8fGRN3VRS) | CG #126 | $1.14M | $818.01 | mint_authority, fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| LOCKIN [8Ki8…zBd5](https://solscan.io/token/8Ki8DpuWNxu9VsS3kQbarsCWMcFGWkzzA8pUPto9zBd5) | CG #127 | $1.13M | $9k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| SC [6D7N…i5Ui](https://solscan.io/token/6D7NaB2xsLd7cauWu1wKk6KBsJohJmP2qZH9GEfVi5Ui) | CG #128 | $1.13M | $4k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Shoggoth [H2c3…pump](https://solscan.io/token/H2c31USxu35MDkBrGph8pUDUnmzo2e4Rf4hnvL2Upump) | CG #129 | $1.11M | $49k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| FEELSGOOD [Hgcx…uYZT](https://solscan.io/token/HgcxVs6kJhPAaGqnPNGaa7zYgNT49hJrLufiqcNMuYZT) | CG #130 | $1.07M | $281k | fdv_too_low, price_impact_unknown |
| tomochi [6mJo…Hg9u](https://solscan.io/token/6mJoQqcPEjiQ1hFya9oH6NBCQLhvS3mwVQWV9EcTHg9u) | CG #131 | $1.01M | $7k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| mini [2JcX…2SbP](https://solscan.io/token/2JcXacFwt9mVAwBQ5nZkYwCyXQkRcdsYrDXn6hj22SbP) | CG #132 | $989k | $7k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| AU79 [AT13…Yo3o](https://solscan.io/token/AT13ipG8K4HDyEJm3H1ZVQV2Bw8sihewoLQReSMsYo3o) | CG #133 | $973k | $1k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| boden [3psH…QA4o](https://solscan.io/token/3psH1Mj1f7yUfaD5gh6Zj7epE8hhrMkMETgv5TshQA4o) | CG #134 | $967k | $8k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MASK [6MQp…pump](https://solscan.io/token/6MQpbiTC2YcogidTmKqMLK82qvE9z5QEm7EP3AEDpump) | CG #135 | $962k | $8k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| NORMIE [4Mrs…pump](https://solscan.io/token/4MrsXQzaosYNyFd4wKDvgnC5xRtRqgXRrijFTGj9pump) | CG #136 | $915k | $1k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| 9qri [9qri…pump](https://solscan.io/token/9qriMjPPAJTMCtfQnz7Mo9BsV2jAWTr2ff7yc3JWpump) | CG #137 | $903k | $883.65 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| LIBRA [Bo9j…vUsU](https://solscan.io/token/Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU) | CG #138 | $899k | $48.41 | volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| RNT [2fUF…pump](https://solscan.io/token/2fUFhZyd47Mapv9wcfXh5gnQwFXtqcYu9xAN4THBpump) | CG #139 | $896k | $23k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Pepe [B5WT…2R6B](https://solscan.io/token/B5WTLaRwaUQpKk7ir1wniNB6m5o8GgMrimhKMYan2R6B) | CG #140 | $895k | $112k | fdv_too_low, volume_24h_too_low, price_impact_unknown |
| KM [FThr…cs42](https://solscan.io/token/FThrNpdic79XRV6i9aCWQ2UTp7oRQuCXAgUWtZR2cs42) | CG #141 | $878k | $8k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| MADE [EpXt…swH1](https://solscan.io/token/EpXtn6xGoZ4Y45vRjiDUHSCGbBoJD5FaEqZbF98YswH1) | CG #142 | $877k | $139k | fdv_too_low, volume_24h_too_low, price_impact_unknown |
| hehe [Breu…pump](https://solscan.io/token/BreuhVohXX5fv6q41uyb3sojtAuGoGaiAhKBMtcrpump) | CG #143 | $866k | $636.22 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| House [DitH…pump](https://solscan.io/token/DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump) | CG #144 | $853k | $3k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| $HACHI [x95H…WKyp](https://solscan.io/token/x95HN3DWvbfCBtTjGm587z8suK3ec6cwQwgZNLbWKyp) | CG #145 | $852k | $79k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Rizzmas [85cQ…6mHg](https://solscan.io/token/85cQsFgbi8mBZxiPppbpPXuV7j1hA8tBwhjF4gKW6mHg) | CG #146 | $846k | $19k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| CYBERLEEK [ApZu…pbKg](https://solscan.io/token/ApZuxdpzMrbEYTGEzeY9afh5pj9d6qPRJCTgQYiipbKg) | CG #147 | $833k | $26k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| Plumber [GCa9…pump](https://solscan.io/token/GCa9TZMK9Q3VUSkhZgX76YAQBjqQd1dPxkBnZojFpump) | CG #148 | $801k | $2k | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| $BEER [AujT…ZLmG](https://solscan.io/token/AujTJJ7aMS8LDo3bFzoyXDwT3jBALUbu4VZhzZdTZLmG) | CG #149 | $800k | $101.18 | fdv_too_low, volume_24h_too_low, volume_7d_too_low, price_impact_unknown |
| RAYCAT [CFNR…upFL](https://solscan.io/token/CFNRDaxFcvRwRSNnA5cHrCCr6AHhk9dNkHWpRUjNupFL) | CG #150 | $797k | $105k | fdv_too_low, volume_24h_too_low, price_impact_unknown |

## 5. Flags on selected / alternate tokens

- **TRUMP** ([6p6x…GiPN](https://solscan.io/token/6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN)): top holders 81% of supply; FDV $2.05B vs mcap $577.40M (large non-circulating supply)
- **ANSEM** ([9cRC…pump](https://solscan.io/token/9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump)): top holders 65% of supply; FDV $139.39M vs mcap $58.27M (large non-circulating supply); Token-2022 mint (check transfer-fee / hook extensions)
- **MEW** ([MEW1…cPP5](https://solscan.io/token/MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5)): top holders 55% of supply
- **ZCAT** ([HcRL…DeJR](https://solscan.io/token/HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR)): Token-2022 mint (check transfer-fee / hook extensions)
- **FO** ([JDzP…ai2o](https://solscan.io/token/JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o)): top holders 92% of supply; low organic score 0; FDV $142.53M vs mcap $16.65M (large non-circulating supply)
- **Buttcoin** ([Cm6f…pump](https://solscan.io/token/Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump)): Token-2022 mint (check transfer-fee / hook extensions)

## 6. Eligibility reasons legend

Source column: `CG #n` = rank in the CoinGecko category by market cap (membership is the memecoin classification, methodology 2.6) · `Jup` = Jupiter verified list only (merged universe) · `inc.` = on-chain incumbent not in the universe.

`mint_authority` / `freeze_authority` = authority not revoked (read from the mint account) · `too_young` / `age_unknown` = < 14 days since first pool · `fdv_too_low` < $2M · `volume_24h_too_low` < $250k · `volume_7d_too_low` < $100k/day (24h proxy before 3 observations) · `price_impact_too_high` > 2% on a $10k sell into USDC · `price_impact_unknown` = no Jupiter route (or the quote was rate-limited; see the run log) · `missing_tag` = `requireAnyTag` set (jupiter universe only), token lacks the Jupiter `meme` tag · `denylisted` / `excluded_symbol` / `excluded_tag` = stable / LST / wrapped / stock / RWA / manual list.
