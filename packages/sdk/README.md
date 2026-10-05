# @fi6900/sdk

TypeScript client for the FI6900 on-chain index fund program (`programs/fi6900`).
ESM only. Depends on `@coral-xyz/anchor` 0.31, `@solana/web3.js` 1.9x and `@solana/spl-token`.

```bash
pnpm --filter @fi6900/sdk build      # -> dist/
```

The IDL lives at `idl/fi6900.json` and the generated Anchor types at `src/types/fi6900.ts`;
both are copied from `target/` after `anchor build` + `anchor idl build`.

## Exports

| Export | What |
|---|---|
| `PROGRAM_ID` | Program id from the IDL (`Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV`). |
| `fundPda(indexMint)`, `assetPda(fund, mint)`, `mintSessionPda(fund, owner, nonce)`, `redeemSessionPda(...)`, `auctionPda(fund, nonce)`, `pendingActionPda(fund, nonce)` | PDA helpers returning `[PublicKey, bump]`. |
| `readFund`, `readAssets`, `readActiveAssets`, `readAuctions`, `readMintSession`, `readRedeemSession`, `readMintSessions`, `readRedeemSessions`, `readPendingActions`, `readPendingAction` | Account readers (bigint fields; the `[u64; 8]` bitmaps are one 512-bit `bigint`, `bitmapSlots()` lists the set slots). `decode*` variants take raw bytes. |
| `Fi6900Client` | Wraps the Anchor `Program`. One `*Ix` method per instruction, returning `TransactionInstruction`. `buildMintTxs` / `buildRedeemTxs` / `buildCancelMintTxs` return ordered `VersionedTransaction[]` (chunked `begin_*` hidden). `quoteMint` / `quoteRedeem` compute baskets off-chain with the exact program math. |
| `ActionPayloads`, `ActionKind`, `ACTION_KIND_NAMES` | Payload builders for every timelocked admin action (`queueActionIx`). |
| `createFundLookupTable`, `extendFundLookupTables`, `extendFundLookupTable` | Plan address lookup table(s) with the fund, all Asset PDAs, vaults, mints and programs — one table per 256 addresses. |
| `pricing`: `toQ64`, `fromQ64`, `q64ToDecimalString`, `auctionPriceAt(auction, slot)`, `buyAmountFor`, `linearPrice`, `mulDivCeil`, `mulDivFloor`, `feeAmount`, `mgmtFeeUnits`, `humanPriceToQ64`, `usdToRefPriceQ64`, `refPriceQ64ToUsd`, `fairPriceQ64`, `minEndPriceQ64`, `moveBps`, `maxRefPriceDelta`, `clampRefPrice`, `effectiveRefAnchor` | Pure integer math mirroring `programs/fi6900/src/math.rs` and `governance.rs`. |
| constants | `MAX_ASSETS` (512), `BEGIN_PAIRS_PER_TX` (50), `MAX_FINALIZE_ASSETS` (118), `DEPOSITS_PER_TX` (6), `WITHDRAWS_PER_TX` (8), `ALT_MAX_ADDRESSES` (256), `REF_PRICE_NUMERAIRE_USD` (1e-9), `MAINNET_TIMELOCK_SLOTS` (432000), pause bits, enums. |

## Usage

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { Fi6900Client, auctionPriceAt, fromQ64 } from "@fi6900/sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const client = new Fi6900Client(connection, new PublicKey(INDEX_MINT), {
  lookupTables: [new PublicKey(FUND_ALT)], // optional; created once via createFundLookupTable
});

// In-kind creation of 10 units (6 decimals)
const txs = await client.buildMintTxs(wallet.publicKey, 10_000_000n);
for (const tx of txs) {
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
}

// Dutch auctions
for (const a of await client.readAuctions(0 /* open */)) {
  const slot = await connection.getSlot();
  console.log(a.address.toBase58(), fromQ64(auctionPriceAt(a, slot)));
}
```

### Transaction ordering

`buildMintTxs(owner, units)` returns, in order:

1. `setComputeUnitLimit` + create fee-recipient index ATA (idempotent) + `accrue_management_fee` + `begin_mint` (first ≤ 50 `[Asset, vault]` pairs)
2. one `begin_mint_continue` per further chunk of 50 assets (funds with > 50 active assets only)
3. deposit batches (`DEPOSITS_PER_TX` = 6 per tx)
4. create owner index ATA (idempotent) + `finalize_mint`

`buildRedeemTxs(owner, units)` returns:

1. `accrue_management_fee` + `begin_redeem` (burns net units, pays fee units; first chunk)
2. one `begin_redeem_continue` per further chunk
3. withdraw batches (`WITHDRAWS_PER_TX` = 8 per tx, each preceded by an idempotent ATA create)
4. `close_redeem`

A 40-asset fund creates in 9 transactions and redeems in 7 (measured: `begin_mint` 174k CU / 545 bytes, `finalize_mint` 139k CU). All transactions share one recent blockhash; send them sequentially and promptly (rebuild if any expires).
Pass `nonce` in the options when you need to recover a session later (`buildCancelMintTxs(owner, nonce)` refunds a stale one).

### Reference prices and auction bounds

```ts
import { usdToRefPriceQ64, fairPriceQ64, minEndPriceQ64, clampRefPrice } from "@fi6900/sdk";

// rebalancer: push a price (Q64.64 nano-USD per raw base unit)
await send(await client.setRefPriceIx(rebalancer, wifMint, usdToRefPriceQ64(1.25, 6)));

// the move cap: clamp a target into the window the program accepts
const asset = (await client.readAssets())[0];
const { price, clamped } = clampRefPrice(asset.refPriceAnchor, usdToRefPriceQ64(2.0, 6), fund.maxRefMoveBps);

// the auction bound start_auction enforces
const minEnd = minEndPriceQ64(fairPriceQ64(sell.refPrice, buy.refPrice), fund.maxAuctionDiscountBps);
```

### Timelock

```ts
import { ActionPayloads } from "@fi6900/sdk";

const { instruction, action } = await client.queueActionIx(authority, ActionPayloads.setFees(40, 40, 100));
// ... after fund.timelockSlots:
for (const a of await client.readDueActions()) await send(await client.executeActionIx(anyone, a)); // picks execute_action / execute_action_add_asset
await send(await client.cancelActionIx(authority, pending)); // authority only
```

The direct setters (`setFeesIx`, `setTargetWeightIx`, `setRebalancerIx`, `setFeeRecipientIx`, `addAssetIx`, `beginRemoveAssetIx`, `setTimelockIx`, `setAuctionParamsIx`) only work while `fund.timelockSlots == 0n`.

### Lookup tables

```ts
const plan = await client.createFundLookupTable(keeper.publicKey); // plan.lookupTables: one per 256 addresses
for (const ixs of plan.instructionGroups) await sendTx(ixs);         // first group of each table: create + extend
client.lookupTables = plan.lookupTables;
// after add_asset:
const grow = await client.extendFundLookupTables(keeper.publicKey);  // fills existing tables, creates new ones when full
for (const ixs of grow.instructionGroups) await sendTx(ixs);
client.lookupTables = grow.lookupTables;
```

### Limits

`begin_mint` / `begin_redeem` take `[Asset, vault]` for every active slot (2 accounts per asset) and are chunked at
`BEGIN_PAIRS_PER_TX` = 50 pairs per transaction (runtime cap of 128 account locks). The program has 512 slots;
redemption works across all of them (a 301-slot fund redeems in 46 transactions), while **in-kind creation is capped at
≈118 active assets** because `finalize_mint` must pass one Asset account per active slot in a single transaction
(`MAX_FINALIZE_ASSETS`). `bootstrap_mint` is likewise capped at ≈58 assets per transaction.
