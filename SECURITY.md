# Security

FI6900 holds user funds in a program-owned vault. If you find a vulnerability, please report it privately before disclosing it.

- Open a private security advisory on this repository (Security → Report a vulnerability), or
- Email the address listed on the project's X profile.

Please include steps to reproduce and, if possible, a transaction on devnet. We aim to acknowledge reports within 48 hours.

## Scope

- `programs/fi6900` — the on-chain program (highest severity: anything that mints units without basket, moves vault tokens outside redemption/auction rules, or bypasses the timelock or auction price bounds).
- `packages/sdk` — transaction construction.
- `apps/keeper` — rebalancer, authorized-participant loop, flywheel, admin API.
- `apps/web` — the site, including the admin page.

## Verified builds

The deployed program should match this source. Build with the pinned toolchain in `Anchor.toml` and compare the hash printed by `solana program dump` against `sha256sum target/deploy/fi6900.so`, or use `solana-verify` against this repository. The program id, upgrade authority and IDL account are shown on the site's `/verify` page.
