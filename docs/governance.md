# FIX6900 holder governance v1

Token-weighted, signature-based (gasless) voting by `$FIX6900` holders, binding through the keeper.
Code: `apps/keeper/src/governance/{voting,holder-gov}.ts`, `apps/keeper/src/jobs/gov-job.ts`,
`apps/web-v2/src/lib/gov.ts`, routes under `/governance`. API shapes: ARCHITECTURE.md §5.

## 1. What is votable

| kind | payload | binding path |
|---|---|---|
| `add_asset` | `{ mint, symbol?, weightBps?, allowTransferFee? }` | approved reconstitution proposal → `queue_action(add_asset)` through the on-chain timelock (48 h on mainnet) → anyone executes after the ETA |
| `remove_asset` | `{ mint, symbol? }` (must be an active constituent) | approved reconstitution proposal → `queue_action(begin_remove_asset)` → timelock → sold down by auctions |
| `set_param` | `{ key, value }` (whitelist + bounds below) | keeper config store (`kv` row `cfg.<key>`), read at the point of use; takes effect at once and survives restarts |

`add_asset` payloads must pass the same mint checks as a manual add: the mint exists on the cluster, mint and
freeze authority are revoked, no Token-2022 transfer hook. A Token-2022 transfer fee is rejected unless the
payload carries `allowTransferFee: true` (rule 2.7 override; depositors/fillers pay the fee).

Votable parameters (`GOV_ALLOWED_PARAMS`, default = all four; bounds are fixed in `governance/voting.ts`):

| key | bounds | where it applies |
|---|---|---|
| `eligibility.minVolume24hUsd` | 50 000 .. 2 000 000 USD | methodology eligibility (rule 2) via `withConfigOverrides` |
| `rebalance.driftRelativeBps` | 1 000 .. 10 000 bps | rebalancer drift check (rule 5) |
| `FEE_BURN_PCT` | 0 .. 100 % | fee processing: share of ETF fees bought back and burned |
| `flywheel.airdropShareBps` | 0 .. 10 000 bps | flywheel split: share of each claimed creator-fee amount that goes to the airdrop leg (rest LP/burn) |

`GET /v1/methodology` reports the config **with** overrides applied, so the public rulebook shows the numbers in force.
`GET /v1/governance` lists the active overrides under `governance.overrides`.

## 2. Rules

| rule | default (env) |
|---|---|
| voting window | 48 h (`GOV_VOTING_HOURS`) |
| quorum | 5 % of circulating snapshot supply (`GOV_QUORUM_BPS=500`); for + against + abstain count |
| passes when | quorum reached **and** for > against (a tie fails) |
| proposal threshold | 0.5 % of circulating supply held by the proposer at proposal time (`GOV_PROPOSAL_THRESHOLD_BPS=50`); the admin bearer token bypasses it |
| open proposals per wallet | 1 (`GOV_MAX_OPEN_PER_WALLET`) |
| vote weight | the wallet's `$FIX6900` balance at the proposal's snapshot (raw units); 0 → cannot vote |
| re-vote | replaces the earlier vote (one row per wallet and proposal) |
| cancel | index committee (`ADMIN_TOKEN`) may cancel an `open` or `passed` proposal |
| dev flag | `GOV_DEV_ACCEPT_ANY_BALANCE=true` lets a wallet with no snapshot balance propose and vote with 1 unit. Local use only. |

### Snapshot and circulating supply

When a proposal opens the keeper fetches every holder of the coin mint (Helius DAS, gPA fallback), drops the
airdrop exclusion set (`flywheel/exclusions.ts`: LP pool vaults and every other off-curve owner, program-owned
and multisig-owned accounts, the incinerator, `AIRDROP_DENYLIST`, the treasury, the keeper and dev wallets) and
stores the rest in `gov_snapshots`. `snapshot_supply` = the sum of those balances = circulating supply; quorum and
the proposal threshold are measured against it. The snapshot is cached for 5 minutes across proposals and the
eligibility endpoint.

### Lifecycle

```
open ──(end_ts, gov-job)──▶ passed ──▶ queued ──▶ executed      add_asset / remove_asset (PendingAction on-chain)
                           passed ──▶ executed                 set_param (kv override)
                       └──▶ failed                              quorum missed or for <= against
open | passed ──(admin)──▶ cancelled
```

`jobs/gov-job.ts` runs every 60 s: closes proposals past `end_ts`, applies passed ones, and mirrors the
reconstitution proposal's state (queued → executed via `reconcileExecuted`, rejected → failed) onto the governance
row (`queued_action_pda`, `queued_sig`). If auctions are open when a passed add/remove is applied, the
reconstitution proposal stays `approved` and is queued at the next window (`queueApproved`); the governance row stays
`passed` until then. Every transition writes a `flywheel_events` row of kind `governance` (sig `off-chain`, or the
queue transaction once one exists) so the site feed and SSE stream show it.

## 3. Canonical messages (what the wallet signs)

Both are plain UTF-8 strings signed with the wallet's ed25519 key (`signMessage` in wallet-adapter; Phantom,
Solflare, Backpack and the devnet burner wallet all support it). The keeper verifies with `tweetnacl` and rejects
any byte difference. Nothing is sent on-chain and no program is approved.

```
FIX6900 governance: propose <sha256 hex of canonical JSON>
FIX6900 governance: vote <for|against|abstain> on proposal <id> (snapshot slot <slot>)
```

Canonical JSON for `propose` is `{ kind, payload, title, description, proposer }` with keys sorted recursively, no
whitespace, `undefined` dropped, bigint as decimal strings (`canonicalJson` in `voting.ts` and `lib/gov.ts`;
both sides must produce the same bytes). The vote message binds the choice, the proposal id and its snapshot slot,
so a signature cannot be replayed on another proposal or choice. Signatures are accepted as base58 (default), base64
or hex of the 64-byte detached signature.

## 4. API

```
GET  /v1/governance                              { ..., governance: { enabled, coinMint, counts{open,passed,failed,queued,executed,cancelled}, params{votingHours,quorumBps,proposalThresholdBps,maxOpenPerWallet,allowedParams[],devAcceptAnyBalance}, overrides{key:value}, lastSnapshot } }
GET  /v1/governance/proposals?status=&wallet=    [GovProposal]   open first, then passed, queued, executed, failed, cancelled; ?wallet adds myVote/myWeight
GET  /v1/governance/proposals/:id?wallet=        GovProposal + votes[] (top 100 by weight)
GET  /v1/governance/eligibility?wallet=          { wallet, balance, circulatingSupply, thresholdUnits, eligible, openProposals, maxOpenPerWallet }
POST /v1/governance/proposals                    { kind, payload, title, description, proposer, message, signature } → 201 GovProposal
                                                 Authorization: Bearer ADMIN_TOKEN creates without signature/threshold (proposer 'admin')
POST /v1/governance/proposals/:id/vote           { wallet, choice, message, signature } → GovProposal (with myVote)
POST /v1/admin/governance/proposals/:id/cancel   { note? }   (ADMIN_TOKEN)
```

Errors use the standard envelope with 400 (validation / message mismatch), 403 (bad signature, below threshold,
no snapshot balance, disabled), 404, 409 (closed, duplicate open proposal, already a constituent), 429 (rate limit:
20 POSTs per minute per IP+wallet), 503 (governance disabled on this keeper).

`GovProposal`: `{ id, kind, payload, summary, title, description, proposer, createdTs, snapshotSlot, snapshotSupply,
snapshotHolders, startTs, endTs, quorumBps, status, timeLeftSec, tally{ for, against, abstain, participation, voters,
quorumUnits, quorumReached, majority, passed, forBps, againstBps, abstainBps, participationBps }, result, queuedActionPda,
queuedSig, myVote?, myWeight?, votes? }`. Raw units are decimal strings (6 dp).

## 5. Web

`/governance` (list, tally bars, quorum meter, time left, snapshot slot, proposer, eligibility and rules in the
margin), `/governance/:id` (detail, For / Against / Abstain buttons that sign and submit, vote ledger, result with
the on-chain action link), `/governance/new` (kind picker, mint checks, whitelisted parameter with bounds, title,
description; signs and submits). Methodology §9 summarises the rules live; `/admin` lists holder proposals with a
cancel button. When the keeper is unreachable the pages fall back to demo fixtures and refuse writes.

## 6. Limits of v1 and the next step

- Off-chain tally: the keeper is the verifier and the executor. The ledger (every signed message) is in SQLite and
  the API, so anyone can re-verify every vote against the snapshot, but the snapshot itself is the keeper's read of
  the chain at one slot. Delegation, vote escrow and on-chain enforcement are out of scope.
- Binding is through the keeper being the fund authority (or the multisig acting on its queued action). The on-chain
  timelock is the public notice period for constituent changes; parameter changes are keeper-side and immediate.
- Sybil is irrelevant (weight is balance) but balance can be borrowed for one slot; the 48 h window and the public
  snapshot slot make that visible.
- Next step: Realms (SPL Governance) with the `$FIX6900` mint as the community token, the fund authority transferred
  to the Realm's native treasury PDA, and `queue_action` / `cancel_action` executed by passed Realms proposals. The
  keeper's `execute_action` loop already executes anything due regardless of who queued it, and the governance
  table layout (`gov_proposals.queued_action_pda`) is where a Realms proposal id would be mirrored.

## 7. Env

```
GOV_ENABLED=true
GOV_VOTING_HOURS=48
GOV_QUORUM_BPS=500
GOV_PROPOSAL_THRESHOLD_BPS=50
GOV_MAX_OPEN_PER_WALLET=1
GOV_ALLOWED_PARAMS=eligibility.minVolume24hUsd,rebalance.driftRelativeBps,FEE_BURN_PCT,flywheel.airdropShareBps
GOV_DEV_ACCEPT_ANY_BALANCE=false
```

Governance needs `COIN_MINT` (the snapshot mint) and a holder source (`HELIUS_API_KEY` recommended). Local
development: `node apps/keeper/scripts/dev-mock.mjs` (MOCK_MODE keeper with seeded, signed proposals and the dev
flag on) and `node apps/web-v2/scripts/dev-local.mjs` (site pointed at it with the devnet burner wallet enabled).
