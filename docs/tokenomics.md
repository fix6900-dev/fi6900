# FI6900 token economics

Two tokens. One is an ETF. The other is the engine that grows it.

## 1. `$FI6900` — the index token

### What a unit is

A unit is a claim on a fixed fraction of the vault. The program enforces it:

- **Creation.** Deliver the pro-rata basket of every constituent to the vault. The program mints you new units. If the vault held 1,000,000 units' worth and you deliver 1% more of *every* holding, you receive 10,000 units. Nobody is diluted; the vault grew by the same fraction as the supply.
- **Redemption.** Burn units. The program hands you your fraction of every holding. Permissionless. No admin signature. No "we'll airdrop it."

Supply is therefore not fixed and is not minted by fees. It expands when someone wants exposure badly enough to deliver basket, and contracts when someone wants the basket badly enough to burn units. This is identical to how SPY shares come into existence.

### Why the price tracks the holdings

Let NAV be the dollar value of the vault divided by supply.

| Market price vs NAV | What an arbitrageur does | Effect |
|---|---|---|
| Price > NAV by more than fees | Buy basket on Jupiter, create units, sell units | Supply rises, price falls toward NAV |
| Price < NAV by more than fees | Buy units, redeem, sell basket on Jupiter | Supply falls, price rises toward NAV |

Fees (0.5% create, 0.5% redeem) set the width of the band the price can wander in before someone is paid to fix it. The keeper runs this loop itself so the peg holds from day one; anyone else can run it too and keep the profit.

This is the piece a "fees go into a wallet" token cannot have. Without redemption there is no floor, and without creation there is no ceiling. The holdings page becomes a decoration.

### Equal weight and the rebalancing premium

Every constituent targets 1/N of the vault. Winners drift above target and losers below, so a rebalance sells winners and buys losers. In a universe as volatile as memecoins this mechanically harvests volatility (the "rebalancing premium" in the equal-weight literature). Rebalances run through on-chain Dutch auctions so the vault never trusts a price oracle for 40 memecoins; the market fills the auction at the price it is willing to pay.

### Fees on the index

| Fee | Rate | Paid in | Where it goes |
|---|---|---|---|
| Creation | 0.50% | units | fee recipient |
| Redemption | 0.50% | units | fee recipient |
| Management | 1.00% / yr | units (minted, dilutive, continuous) | fee recipient |

There is **no transfer tax** on `$FI6900`. A transfer tax would require Token-2022, which breaks the create/redeem arbitrage math, hurts DEX routing, and is exactly the sort of thing that makes a token look like a trap. The index earns on creation, redemption and management, like a real ETF.

75% of index fee units are redeemed, sold for SOL, used to buy `$FIX6900` and the `$FIX6900` is burned on-chain. 25% goes to treasury for operations.

## 2. `$FIX6900` — the pump.fun coin

A plain pump.fun token. Dev wallet is the creator so creator fees accrue to it on both the bonding curve and PumpSwap.

Claimed creator fees are split:

- **50% liquidity.** Half of it buys `$FI6900`, the other half stays SOL, and both are deposited as LP into the `$FI6900`/SOL pool. Deeper liquidity means tighter arbitrage and a tighter peg.
- **50% airdrop.** Buys the basket, creates `$FI6900` units in-kind, and distributes them pro-rata to `$FIX6900` holders every 15 minutes. Holding `$FIX6900` is a continuous stream of index exposure.

So holding `$FIX6900` pays you in the ETF, and ETF fees buy and burn `$FIX6900`. Each one's volume pays the other.

## 3. What "tax" we use and don't use

- No transfer tax on either token. Pump.fun tokens cannot have one; the index should not.
- The pump.fun **creator fee** is the "tax" on `$FIX6900`. It is paid by the trading venue, not deducted from holders' transfers, so wallets and DEXes treat `$FIX6900` as a normal token.
- The index's **creation, redemption and management fees** are the "tax" on `$FI6900`.

## 4. Numbers to remember

| | |
|---|---|
| Constituents | 40 (target), max 64 |
| Weighting | equal, 1/N |
| Scheduled rebalance | weekly |
| Drift-band rebalance | any asset more than 2.5% abs off target |
| Reconstitution | 1st of each month, announced 48h ahead |
| Index base level | 1000 at inception, divisor-adjusted |
| Airdrop cadence | every 15 minutes |
