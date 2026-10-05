# Launch basket (approved 2026-10-05)

Equal weight, 14 constituents, 714 bps each. Source of truth: `apps/keeper/config/launch-basket.json`.

| # | Symbol | Name | Mint | Dec | Program | Weight |
|---|---|---|---|---|---|---|
| 1 | PENGU | Pudgy Penguins | `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv` | 6 | SPL | 7.15% |
| 2 | TRUMP | OFFICIAL TRUMP | `6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN` | 6 | SPL | 7.15% |
| 3 | BONK | Bonk | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | 5 | SPL | 7.15% |
| 4 | WIF | dogwifhat | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm` | 6 | SPL | 7.15% |
| 5 | USELESS | Useless Coin | `Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk` | 6 | SPL | 7.14% |
| 6 | FARTCOIN | Fartcoin | `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump` | 6 | SPL | 7.14% |
| 7 | BOME | BOOK OF MEME | `ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82` | 6 | SPL | 7.14% |
| 8 | ANSEM | The Black Bull | `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump` | 6 | Token-2022 | 7.14% |
| 9 | POPCAT | Popcat | `7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr` | 9 | SPL | 7.14% |
| 10 | MEW | cat in a dogs world | `MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5` | 5 | SPL | 7.14% |
| 11 | TROLL | Troll | `5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2` | 6 | SPL | 7.14% |
| 12 | NEET | neet | `Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump` | 6 | SPL | 7.14% |
| 13 | PIPPIN | pippin | `Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump` | 6 | SPL | 7.14% |
| 14 | CATE | Catecoin | `Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump` | 6 | Token-2022 | 7.14% |

All 14: mint authority revoked, freeze authority revoked, no transfer fee, no transfer hook (checked on-chain 2026-10-05).

## Excluded by the committee

| Symbol | Mint | Reason |
|---|---|---|
| FO | `JDzPbXboQYWVmdxXS3LbvjM52RtsV1QaSv2AzoCiai2o` | 92% top-holder concentration, FDV 8.6x mcap |
| BUTTCOIN | `Cm6fNnMk7NfzStP9CZpsQA2v3jjzbcYGAxdJySmHpump` | committee decision |
| ZCAT | `HcRLc9VDgjLeK154xDawfb1dmVJ98DoSqcwTHGqiDeJR` | Token-2022 transfer fee 3% (300 bps) — taxes every vault deposit, withdrawal and auction fill |
| SI | `DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP` | Token-2022 transfer fee 1% with a live fee authority; also 10 days old and >2% price impact |
| STONK | `6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx` | not a memecoin |
| CARDS | `CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp` | not a memecoin |

## Why transfer-fee tokens are excluded

A Token-2022 transfer fee is deducted on every transfer, including deposits into the vault, withdrawals on redemption and auction fills. Since 2026-10-05 the program credits vaults with the amount actually received (gross deposits/fills, `ShortDeposit` / `ShortFill` on under-payment), so a taxed constituent can no longer under-collateralise the fund — but holders would still pay the fee on every creation, redemption and rebalance, and the fee authority can raise it. The methodology therefore rejects any mint with a non-zero `transferFeeConfig` (eligibility rule 2.7); the committee can override that for a specific token with `"allowTransferFee": true` on its entry in `apps/keeper/config/launch-basket.json` (or `keeper add-asset --force`), which is logged loudly and recorded in the proposal. No entry in the launch basket uses the override. Mints with a `transferHook` extension are never admissible.
