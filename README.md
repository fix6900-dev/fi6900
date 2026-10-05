# FI6900

An on-chain, equal-weight memecoin index fund on Solana that works the way SPY works: a program-owned vault, in-kind creation and redemption, Dutch-auction rebalancing, and an arbitrage loop that pins the token price to the value of the holdings. A pump.fun coin feeds it.

- [Architecture](ARCHITECTURE.md): the contract between program, keeper and web.
- [Tokenomics](docs/tokenomics.md): why buying the token gives you the basket, and what fees do.
- [Methodology](docs/methodology.md): index rules, written like an index provider's document.
- [Operations](docs/operations.md) and [Launch runbook](docs/launch-runbook.md).

## Layout

```
programs/fi6900   Anchor program (Rust)
packages/sdk      TypeScript client (@fi6900/sdk)
apps/keeper       pricing, methodology, NAV, rebalancer, AP arbitrage, flywheel, HTTP API
apps/web          Next.js site
tests             program integration tests
docs              methodology, operations, runbook, tokenomics
```

## Prerequisites

- Node 22 and pnpm 10 (Windows or Linux).
- Anchor 0.31.1 and Solana CLI 2.1 for the program. On this machine they live in WSL Ubuntu.

## Quick start

```bash
pnpm install
```

Frontend with demo data, no backend needed:

```bash
pnpm --filter @fi6900/web dev
```

Keeper API in mock mode:

```bash
MOCK_MODE=true pnpm --filter @fi6900/keeper dev
```

Program build and tests (from WSL):

```bash
anchor build
```

See [docs/operations.md](docs/operations.md) for the local-validator test flow and the dry-run to live checklist.

## Trust model

- The vault is program-owned. No key can mint units without depositing the basket, and nothing leaves the vault except through redemption or an auction fill at a bounded price.
- Admin changes (fees, weights, constituents, roles) sit behind an on-chain timelock. Pause is instant and only ever stops activity.
- The program is **upgradeable** and the upgrade authority is disclosed on the site's `/verify` page. The plan is to move it to a Realms DAO governed by `$FI` holders, see [docs/mainnet-go-live.md](docs/mainnet-go-live.md). Until then, holders are trusting that key.
- Builds are reproducible with the pinned toolchain; see [SECURITY.md](SECURITY.md) for how to verify the deployed bytes against this repository.

## License

Apache-2.0. See [LICENSE](LICENSE).
