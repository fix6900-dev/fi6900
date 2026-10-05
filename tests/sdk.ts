/**
 * Integration tests for @fi6900/sdk against the local validator.
 * Requires `pnpm --filter @fi6900/sdk build` first (imports the built ESM dist via Node 22 require(esm)).
 */
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { expect } from "chai";
import * as sdk from "../packages/sdk/dist/index.js";
import { TestEnv, big, linearPrice, buyAmountFor, Q64, waitSlots, mulDivCeil, bitmapBig, slotsOf, tokenMetadataHash, type AssetInfo } from "./helpers";

const UNIT = 1_000_000n;

describe("@fi6900/sdk", function () {
  this.timeout(600_000);

  const env = new TestEnv();
  const user = Keypair.generate();
  let client: sdk.Fi6900Client;

  async function sendV0(txs: VersionedTransaction[], signer: Keypair): Promise<string[]> {
    const sigs: string[] = [];
    for (const tx of txs) {
      tx.sign([signer]);
      const sig = await env.connection.sendTransaction(tx, { skipPreflight: false });
      await env.connection.confirmTransaction({ signature: sig, ...(await env.connection.getLatestBlockhash()) }, "confirmed");
      sigs.push(sig);
    }
    return sigs;
  }

  before(async () => {
    await env.airdrop(env.authority.publicKey, 200);
    await env.airdrop(user.publicKey, 50);
    await env.createIndexMint();
    await env.initializeFund(50, 50, 100);
    const specs = [
      { decimals: 6, seed: 500_000n * 10n ** 6n },
      { decimals: 9, seed: 1_000n * 10n ** 9n },
      { decimals: 4, seed: 99_999_999n },
    ];
    for (const s of specs) {
      const mint = await env.createAssetMint(s.decimals);
      const a = await env.addAsset(mint, s.decimals, TOKEN_PROGRAM_ID, 3333);
      await env.mintTokens(mint, env.authority.publicKey, s.seed * 4n, TOKEN_PROGRAM_ID);
      await env.mintTokens(mint, user.publicKey, s.seed * 4n, TOKEN_PROGRAM_ID);
      await env.seedVault(a, s.seed);
    }
    await env.bootstrapMint(100_000n * UNIT);
    // every asset: 1 nUSD per raw unit -> fair auction price 1.0 between any pair
    await env.setRefPrices(env.assets, Q64);
    client = new sdk.Fi6900Client(env.connection, env.indexMint);
  });

  it("exposes PROGRAM_ID and PDA helpers consistent with the program", async () => {
    expect(sdk.PROGRAM_ID.toBase58()).to.eq(env.program.programId.toBase58());
    expect(sdk.fundPda(env.indexMint)[0].toBase58()).to.eq(env.fund.toBase58());
    expect(sdk.assetPda(env.fund, env.assets[0].mint)[0].toBase58()).to.eq(env.assets[0].asset.toBase58());
    expect(sdk.mintSessionPda(env.fund, user.publicKey, 7n)[0].toBase58()).to.eq(env.mintSessionPda(user.publicKey, 7n).toBase58());
    expect(sdk.redeemSessionPda(env.fund, user.publicKey, 7n)[0].toBase58()).to.eq(env.redeemSessionPda(user.publicKey, 7n).toBase58());
    expect(sdk.auctionPda(env.fund, 0n)[0].toBase58()).to.eq(env.auctionPda(0n).toBase58());
  });

  it("readFund / readAssets decode on-chain state", async () => {
    const fund = await client.readFund();
    expect(fund.authority.toBase58()).to.eq(env.authority.publicKey.toBase58());
    expect(fund.assetCount).to.eq(3);
    expect(fund.activeBitmap).to.eq(0b111n);
    expect(fund.timelockSlots).to.eq(0n);
    expect(fund.maxAuctionDiscountBps).to.eq(500);
    expect(fund.mintFeeBps).to.eq(50);
    const assets = await client.readAssets();
    expect(assets[0].refPrice).to.eq(Q64);
    expect(assets.map((a) => a.index)).to.deep.eq([0, 1, 2]);
    expect(assets[1].decimals).to.eq(9);
    expect(assets[2].vault.toBase58()).to.eq(env.assets[2].vault.toBase58());
    const eff = await client.readEffectiveBalances(assets);
    expect(eff[0].effective).to.eq(500_000n * 10n ** 6n);
  });

  it("createFundLookupTable builds a usable ALT with fund, assets, vaults, mints and programs", async () => {
    const plan = await client.createFundLookupTable(env.authority.publicKey);
    expect(plan.instructionGroups.length).to.be.greaterThan(0);
    for (const ixs of plan.instructionGroups) {
      await sendAndConfirmTransaction(env.connection, new Transaction().add(...ixs), [env.authority], { commitment: "confirmed" });
    }
    await waitSlots(env.connection, 2);
    const table = await env.connection.getAddressLookupTable(plan.lookupTable);
    const addrs = new Set(table.value!.state.addresses.map((a) => a.toBase58()));
    expect(addrs.has(env.fund.toBase58())).to.eq(true);
    expect(addrs.has(env.indexMint.toBase58())).to.eq(true);
    for (const a of env.assets) {
      expect(addrs.has(a.asset.toBase58())).to.eq(true);
      expect(addrs.has(a.vault.toBase58())).to.eq(true);
      expect(addrs.has(a.mint.toBase58())).to.eq(true);
    }
    client.lookupTable = plan.lookupTable;
  });

  it("quoteMint matches the program's ceil formula", async () => {
    const units = 1_234n * UNIT;
    const supply = await client.readSupply();
    const quote = await client.quoteMint(units);
    const eff = await client.readEffectiveBalances();
    quote.forEach((q, i) => expect(q.amount).to.eq(mulDivCeil(eff[i].effective, units, supply)));
  });

  it("buildMintTxs: ordered v0 txs that complete an in-kind creation", async () => {
    const units = 1_234n * UNIT;
    const supplyBefore = await client.readSupply();
    const feeAta = client.indexAta(env.authority.publicKey);
    const feeBefore = await env.tokenBalance(feeAta);
    const nonce = 99n;
    const txs = await client.buildMintTxs(user.publicKey, units, { nonce });
    expect(txs.length).to.eq(3); // begin, 1 deposit batch (3 assets), finalize
    for (const tx of txs) expect(tx.message.addressTableLookups.length).to.eq(1);
    await sendV0(txs, user);
    const fee = (units * 50n) / 10_000n;
    // tx[0] also accrues the management fee; everything minted to the fee ATA beyond `fee` is that accrual
    const accrued = (await env.tokenBalance(feeAta)) - feeBefore - fee;
    expect(accrued >= 0n).to.eq(true);
    expect(await client.readSupply()).to.eq(supplyBefore + units + accrued);
    expect(await env.tokenBalance(client.indexAta(user.publicKey))).to.eq(units - fee);
    expect(await client.readMintSession(user.publicKey, nonce)).to.eq(null);
  });

  it("buildRedeemTxs: ordered v0 txs that complete an in-kind redemption", async () => {
    const units = 500n * UNIT;
    const supplyBefore = await client.readSupply();
    const feeAta = client.indexAta(env.authority.publicKey);
    const feeBefore = await env.tokenBalance(feeAta);
    const userBefore = await env.tokenBalance(client.indexAta(user.publicKey));
    const quote = await client.quoteRedeem(units);
    const before = await Promise.all(env.assets.map((a) => env.tokenBalance(getAssociatedTokenAddressSync(a.mint, user.publicKey))));
    // skipAccrue keeps supply fixed between the quote and begin_redeem so the quote is exact
    const txs = await client.buildRedeemTxs(user.publicKey, units, { nonce: 100n, skipAccrue: true });
    expect(txs.length).to.eq(3);
    await sendV0(txs, user);
    const fee = (units * 50n) / 10_000n;
    expect((await env.tokenBalance(feeAta)) - feeBefore).to.eq(fee);
    expect(await client.readSupply()).to.eq(supplyBefore - (units - fee));
    expect(await env.tokenBalance(client.indexAta(user.publicKey))).to.eq(userBefore - units);
    const after = await Promise.all(env.assets.map((a) => env.tokenBalance(getAssociatedTokenAddressSync(a.mint, user.publicKey))));
    quote.forEach((q, i) => expect(after[i] - before[i]).to.eq(q.amount));
    expect(await client.readRedeemSession(user.publicKey, 100n)).to.eq(null);
  });

  it("buildCancelMintTxs refunds a stale session", async () => {
    const nonce = 101n;
    const txs = await client.buildMintTxs(user.publicKey, 10n * UNIT, { nonce });
    await sendV0(txs.slice(0, 2), user); // begin + deposits, never finalize
    const session = await client.readMintSession(user.publicKey, nonce);
    expect(session!.depositedBitmap).to.eq(0b111n);
    const cancel = await client.buildCancelMintTxs(user.publicKey, nonce);
    await sendV0(cancel, user);
    expect(await client.readMintSession(user.publicKey, nonce)).to.eq(null);
    for (const a of await client.readAssets()) expect(a.pendingDeposits).to.eq(0n);
  });

  it("auction ixs + pricing helpers agree with the on-chain fill", async () => {
    const assets = await client.readAssets();
    const start = sdk.toQ64("1.75");
    const end = sdk.toQ64("0.96"); // fair 1.0 * (1 - 5%) = 0.95 is the floor
    expect(start).to.eq((7n * Q64) / 4n);
    expect(sdk.fromQ64(start)).to.be.closeTo(1.75, 1e-12);
    expect(sdk.q64ToDecimalString(start)).to.eq("1.75");
    expect(sdk.minEndPriceQ64(sdk.fairPriceQ64(assets[0].refPrice, assets[1].refPrice), 500)).to.eq((Q64 * 95n) / 100n);

    const { instruction, auction } = await client.startAuctionIx(
      env.authority.publicKey,
      assets[0],
      assets[1],
      1_000n * 10n ** 6n,
      start,
      end,
      100n,
    );
    await sendAndConfirmTransaction(env.connection, new Transaction().add(instruction), [env.authority], { commitment: "confirmed" });
    const open = await client.readAuctions(sdk.AuctionStatus.Open);
    expect(open.length).to.eq(1);
    expect(open[0].address.toBase58()).to.eq(auction.toBase58());

    await waitSlots(env.connection, 3);
    // filler = authority (has every asset)
    await env.ensureAta(env.authority.publicKey, assets[0].mint, TOKEN_PROGRAM_ID);
    const fill = await client.fillAuctionIx(env.authority.publicKey, open[0], 300n * 10n ** 6n);
    const sig = await sendAndConfirmTransaction(env.connection, new Transaction().add(fill), [env.authority], { commitment: "confirmed" });
    const slot = await env.txSlot(sig);
    const ev = (await env.events(sig)).find((e) => e.name === "auctionFilled")!;
    const predicted = sdk.auctionPriceAt(open[0], slot);
    expect(predicted).to.eq(linearPrice(start, end, slot - open[0].startSlot, 100n));
    expect(big(ev.data.price)).to.eq(predicted);
    expect(big(ev.data.buyAmount)).to.eq(sdk.buyAmountFor(300n * 10n ** 6n, predicted));
    expect(sdk.buyAmountFor(300n * 10n ** 6n, predicted)).to.eq(buyAmountFor(300n * 10n ** 6n, predicted));

    const cancel = await client.cancelAuctionIx(env.authority.publicKey, auction);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(cancel), [env.authority], { commitment: "confirmed" });
    expect((await client.readAuction(auction)).status).to.eq(sdk.AuctionStatus.Cancelled);
    expect((await client.readFund()).openAuctions).to.eq(0);
  });

  it("extendFundLookupTable adds addresses for newly added assets", async () => {
    const mint = await env.createAssetMint(6);
    const ix = await client.addAssetIx(env.authority.publicKey, mint, 1000);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(ix), [env.authority], { commitment: "confirmed" });
    const groups = await client.extendFundLookupTable(client.lookupTable!, env.authority.publicKey);
    expect(groups.length).to.eq(1);
    for (const ixs of groups) {
      await sendAndConfirmTransaction(env.connection, new Transaction().add(...ixs), [env.authority], { commitment: "confirmed" });
    }
    const table = await env.connection.getAddressLookupTable(client.lookupTable!);
    const addrs = new Set(table.value!.state.addresses.map((a) => a.toBase58()));
    expect(addrs.has(client.assetPda(mint).toBase58())).to.eq(true);
    const again = await client.extendFundLookupTable(client.lookupTable!, env.authority.publicKey);
    expect(again.length).to.eq(0);
  });

  it("admin ix builders produce valid instructions", async () => {
    const auth = env.authority.publicKey;
    const ixs = [
      await client.setFeesIx(auth, 10, 20, 30),
      await client.setPausedIx(auth, sdk.PAUSE_AUCTIONS),
      await client.setTargetWeightIx(auth, env.assets[0].mint, 4321),
    ];
    await sendAndConfirmTransaction(env.connection, new Transaction().add(...ixs), [env.authority], { commitment: "confirmed" });
    const fund = await client.readFund();
    expect([fund.mintFeeBps, fund.redeemFeeBps, fund.mgmtFeeBps]).to.deep.eq([10, 20, 30]);
    expect(fund.paused).to.eq(sdk.PAUSE_AUCTIONS);
    const a0 = await sdk.readAsset(env.connection, env.assets[0].asset);
    expect(a0.targetWeightBps).to.eq(4321);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.setPausedIx(auth, 0)), [env.authority], {
      commitment: "confirmed",
    });
  });
  it("setTokenMetadataIx creates/updates the Metaplex metadata; tokenMetadataHash matches the program's commitment", async () => {
    const auth = env.authority.publicKey;
    const args = { name: "FIX6900 Index", symbol: "FIXIDX", uri: "https://fix6900index.com/token/fix6900-index.json" };
    expect(client.tokenMetadataPda().toBase58()).to.eq(env.tokenMetadataPda().toBase58());
    expect((await sdk.tokenMetadataHash(args)).toBase58()).to.eq(tokenMetadataHash(args.name, args.symbol, args.uri).toBase58());
    expect(await client.readTokenMetadata()).to.eq(null);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.setTokenMetadataIx(auth, args)), [env.authority], { commitment: "confirmed" });
    const md = (await client.readTokenMetadata())!;
    expect([md.name, md.symbol, md.uri]).to.deep.eq([args.name, args.symbol, args.uri]);
    expect(md.updateAuthority.toBase58()).to.eq(env.fund.toBase58());
    expect(md.isMutable).to.eq(true);
    // queued path at timelock 0: the hash is the action key and the same ix executes it
    const v2 = { ...args, uri: args.uri + "?v=2" };
    const q = await client.queueActionIx(auth, sdk.ActionPayloads.setTokenMetadata(await sdk.tokenMetadataHash(v2)));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q.instruction), [env.authority], { commitment: "confirmed" });
    const pending = (await client.readPendingActions()).find((a) => a.address.equals(q.action))!;
    expect(pending.kind).to.eq(sdk.ActionKind.SetTokenMetadata);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.setTokenMetadataIx(auth, v2, pending)), [env.authority], { commitment: "confirmed" });
    expect((await client.readTokenMetadata())!.uri).to.eq(v2.uri);
    expect(await env.connection.getAccountInfo(q.action)).to.eq(null);
    let threw = false;
    await client.setTokenMetadataIx(auth, { ...args, symbol: "WAYTOOLONGSYMBOL" }).catch(() => (threw = true));
    expect(threw).to.eq(true);
  });

  it("ref-price helpers mirror the program (numeraire, fair price, clamp)", () => {
    // WIF at $1.25 with 6 decimals = 1250 nano-USD per raw unit
    expect(sdk.usdToRefPriceQ64(1.25, 6)).to.eq(1250n * Q64);
    expect(sdk.refPriceQ64ToUsd(1250n * Q64, 6)).to.be.closeTo(1.25, 1e-9);
    // BONK-like: $0.00002 with 5 decimals = 0.2 nUSD per raw
    expect(sdk.fromQ64(sdk.usdToRefPriceQ64(0.00002, 5))).to.be.closeTo(0.2, 1e-9);
    expect(sdk.fairPriceQ64(2n * Q64, 4n * Q64)).to.eq(Q64 / 2n);
    expect(sdk.moveBps(1000n, 1200n)).to.eq(2000n);
    expect(sdk.moveBps(1000n, 1001n)).to.eq(10n);
    const c = sdk.clampRefPrice(1000n, 1300n, 2000);
    expect(c).to.deep.eq({ price: 1200n, clamped: true, targetMoveBps: 3000n });
    expect(sdk.clampRefPrice(1000n, 700n, 2000).price).to.eq(800n);
    expect(sdk.clampRefPrice(1000n, 1100n, 2000).clamped).to.eq(false);
    expect(sdk.effectiveRefAnchor({ refPrice: 5n, refPriceAnchor: 3n, refPriceAnchorSlot: 100n }, 10n, 105n)).to.eq(3n);
    expect(sdk.effectiveRefAnchor({ refPrice: 5n, refPriceAnchor: 3n, refPriceAnchorSlot: 100n }, 10n, 110n)).to.eq(5n);
  });

  it("setRefPriceIx + timelock builders: queue / readPendingActions / execute / cancel", async () => {
    const auth = env.authority.publicKey;
    const assets = await client.readAssets();
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.setRefPriceIx(auth, assets[0].mint, (Q64 * 11n) / 10n)), [env.authority], { commitment: "confirmed" });
    expect((await sdk.readAsset(env.connection, assets[0].address)).refPrice).to.eq((Q64 * 11n) / 10n);

    // timelock 0: queue -> execute immediately
    const q = await client.queueActionIx(auth, sdk.ActionPayloads.setFees(12, 34, 56));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q.instruction), [env.authority], { commitment: "confirmed" });
    const pending = await client.readPendingActions();
    expect(pending.length).to.eq(1);
    expect(pending[0].address.toBase58()).to.eq(q.action.toBase58());
    expect(pending[0].kind).to.eq(sdk.ActionKind.SetFees);
    expect(pending[0].values).to.deep.eq([12n, 34n, 56n, 0n]);
    expect((await client.readDueActions()).length).to.eq(1);
    const ex = await client.executeActionIx(user.publicKey, pending[0]);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(ex), [user], { commitment: "confirmed" });
    const fund = await client.readFund();
    expect([fund.mintFeeBps, fund.redeemFeeBps, fund.mgmtFeeBps]).to.deep.eq([12, 34, 56]);
    expect((await client.readPendingActions()).length).to.eq(0);

    // ref-price override payload round-trips a full u128 and executes with the asset account
    const big128 = (123456789n << 64n) | 987654321n;
    const q2 = await client.queueActionIx(auth, sdk.ActionPayloads.refPriceOverride(assets[1].mint, big128));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q2.instruction), [env.authority], { commitment: "confirmed" });
    const [p2] = await client.readPendingActions();
    expect(sdk.actionRefPrice(p2)).to.eq(big128);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.executeActionIx(user.publicKey, p2)), [user], { commitment: "confirmed" });
    expect((await sdk.readAsset(env.connection, assets[1].address)).refPrice).to.eq(big128);

    // cancel
    const q3 = await client.queueActionIx(auth, sdk.ActionPayloads.setRebalancer(user.publicKey));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q3.instruction), [env.authority], { commitment: "confirmed" });
    const [p3] = await client.readPendingActions();
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.cancelActionIx(auth, p3)), [env.authority], { commitment: "confirmed" });
    expect((await client.readPendingActions()).length).to.eq(0);
    expect((await client.readFund()).rebalancer.toBase58()).to.eq(auth.toBase58());

    // add_asset through the queue (execute_action_add_asset picked by kind)
    const mint = await env.createAssetMint(9);
    const q4 = await client.queueActionIx(auth, sdk.ActionPayloads.addAsset(mint, 100));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q4.instruction), [env.authority], { commitment: "confirmed" });
    const [p4] = await client.readPendingActions();
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.executeActionIx(user.publicKey, p4)), [user], { commitment: "confirmed" });
    const added = await sdk.readAsset(env.connection, client.assetPda(mint));
    expect(added.targetWeightBps).to.eq(100);
    expect(added.decimals).to.eq(9);
    // and remove it again (queue + execute), restoring the fund for the following tests
    const q5 = await client.queueActionIx(auth, sdk.ActionPayloads.beginRemoveAsset(mint));
    await sendAndConfirmTransaction(env.connection, new Transaction().add(q5.instruction), [env.authority], { commitment: "confirmed" });
    const [p5] = await client.readPendingActions();
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.executeActionIx(user.publicKey, p5)), [user], { commitment: "confirmed" });
    await sendAndConfirmTransaction(env.connection, new Transaction().add(await client.finalizeRemoveAssetIx(auth, await sdk.readAsset(env.connection, added.address))), [env.authority], { commitment: "confirmed" });
    // restore fees + ref prices
    await sendAndConfirmTransaction(
      env.connection,
      new Transaction().add(await client.setFeesIx(auth, 50, 50, 100), await client.setRefPriceIx(auth, assets[0].mint, Q64), await client.setRefPriceIx(auth, assets[1].mint, Q64)),
      [env.authority],
      { commitment: "confirmed" },
    );
  });

  it("grossForNet / transferFeeFor: smallest gross whose net clears the requirement", () => {
    expect(sdk.transferFeeFor(10_000n, 300, 10n ** 12n)).to.eq(300n);
    expect(sdk.transferFeeFor(10_001n, 300, 10n ** 12n)).to.eq(301n); // ceil
    expect(sdk.transferFeeFor(10_000n, 300, 100n)).to.eq(100n); // capped
    expect(sdk.transferFeeFor(10_000n, 0, 100n)).to.eq(0n);
    expect(sdk.grossForNet(10_000n, 300, 10n ** 12n)).to.eq(10_310n);
    expect(sdk.grossForNet(10_000n, 300, 100n)).to.eq(10_100n);
    expect(sdk.grossForNet(10_000n, 0, 10n ** 12n)).to.eq(10_000n);
    expect(sdk.grossForNet(0n, 300, 10n ** 12n)).to.eq(0n);
    expect(sdk.grossForNet(5n, 10_000, 3n)).to.eq(8n); // 100 % fee, capped at 3
    const max = 10n ** 15n;
    for (const bps of [1, 25, 300, 999, 5000, 9999]) {
      for (const net of [1n, 2n, 99n, 10_000n, 123_456_789n, 10n ** 12n + 7n]) {
        const g = sdk.grossForNet(net, bps, max);
        expect(g - sdk.transferFeeFor(g, bps, max) >= net, `${bps} ${net}`).to.eq(true);
        expect(g - 1n - sdk.transferFeeFor(g - 1n, bps, max) < net, `${bps} ${net} minimal`).to.eq(true);
      }
    }
  });

  it("buildMintTxs sends gross deposits for a Token-2022 fee-on-transfer constituent", async () => {
    const auth = env.authority.publicKey;
    const FEE_BPS = 300;
    const MAX = 10n ** 15n;
    // committee override: add a 3 % fee mint (weight 0) and donate a basket slice to its vault
    const feeMint = await env.createTransferFeeMint(6, FEE_BPS, MAX);
    const addIx = await client.addAssetIx(auth, feeMint, 0, sdk.TOKEN_2022_PROGRAM_ID);
    await sendAndConfirmTransaction(env.connection, new Transaction().add(addIx), [env.authority], { commitment: "confirmed" });
    const feeAsset = await sdk.readAsset(env.connection, client.assetPda(feeMint));
    expect(feeAsset.tokenProgram.toBase58()).to.eq(sdk.TOKEN_2022_PROGRAM_ID.toBase58());
    expect(await client.transferFee(feeMint, feeAsset.tokenProgram)).to.deep.eq({ feeBps: FEE_BPS, maxFee: MAX });
    expect(await client.transferFee(env.assets[0].mint, env.assets[0].tokenProgram)).to.eq(null);
    await env.mintTokens(feeMint, auth, 2_000_000n * 10n ** 6n, sdk.TOKEN_2022_PROGRAM_ID);
    await env.mintTokens(feeMint, user.publicKey, 2_000_000n * 10n ** 6n, sdk.TOKEN_2022_PROGRAM_ID);
    const info: AssetInfo = { mint: feeMint, decimals: 6, tokenProgram: sdk.TOKEN_2022_PROGRAM_ID, asset: feeAsset.address, vault: feeAsset.vault, slot: feeAsset.index };
    await env.seedVault(info, 100_000n * 10n ** 6n);
    for (const ixs of await client.extendFundLookupTable(client.lookupTable!, auth)) {
      await sendAndConfirmTransaction(env.connection, new Transaction().add(...ixs), [env.authority], { commitment: "confirmed" });
    }
    await waitSlots(env.connection, 2);
    // the user needs a token account for every active asset (the 4th asset from the LUT test has an empty vault)
    for (const a of await client.readActiveAssets()) await env.ensureAta(user.publicKey, a.mint, a.tokenProgram);

    const units = 777n * UNIT;
    const nonce = 102n;
    const vaultBefore = await env.tokenBalance(feeAsset.vault, sdk.TOKEN_2022_PROGRAM_ID);
    const supplyBefore = await client.readSupply();
    const quote = (await client.quoteMint(units)).find((q) => q.asset.address.equals(feeAsset.address))!;
    const g = await client.depositGross(feeAsset, quote.amount);
    expect(g).to.eq(sdk.grossForNet(quote.amount, FEE_BPS, MAX));
    const userFeeAta = getAssociatedTokenAddressSync(feeMint, user.publicKey, true, sdk.TOKEN_2022_PROGRAM_ID);
    const userBefore = await env.tokenBalance(userFeeAta, sdk.TOKEN_2022_PROGRAM_ID);

    // skipAccrue keeps the supply fixed so the predicted gross is exact
    const txs = await client.buildMintTxs(user.publicKey, units, { nonce, skipAccrue: true });
    await sendV0(txs, user);
    expect(await client.readMintSession(user.publicKey, nonce)).to.eq(null);
    expect(await client.readSupply()).to.eq(supplyBefore + units);
    const received = (await env.tokenBalance(feeAsset.vault, sdk.TOKEN_2022_PROGRAM_ID)) - vaultBefore;
    expect(received).to.eq(g - sdk.transferFeeFor(g, FEE_BPS, MAX));
    expect(received >= quote.amount).to.eq(true);
    expect(userBefore - (await env.tokenBalance(userFeeAta, sdk.TOKEN_2022_PROGRAM_ID))).to.eq(g);
    const after = await sdk.readAsset(env.connection, feeAsset.address);
    expect(after.pendingDeposits).to.eq(0n);
    expect(await client.fillGrossFor(feeAsset, 10_000n)).to.eq(10_310n);
  });
});

// ---------------------------------------------------------------------------
// Scale: 40 constituents in-kind round trip (the production target) with CU / size measurements,
// and a 301-slot fund proving the 512-bit bitmaps + chunked begin at slot 300.
// ---------------------------------------------------------------------------

describe("@fi6900/sdk at scale", function () {
  this.timeout(1_200_000);

  const UNITS_BOOTSTRAP = 1_000_000n * UNIT;
  const SEED = 1_000_000n * 10n ** 6n;

  async function sendV0All(env: TestEnv, txs: VersionedTransaction[], signer: Keypair, label: string): Promise<{ sigs: string[]; cu: number[]; bytes: number[] }> {
    const sigs: string[] = [];
    const cu: number[] = [];
    const bytes: number[] = [];
    for (const tx of txs) {
      tx.sign([signer]);
      bytes.push(tx.serialize().length);
      const sig = await env.connection.sendTransaction(tx, { skipPreflight: false });
      const conf = await env.connection.confirmTransaction({ signature: sig, ...(await env.connection.getLatestBlockhash()) }, "confirmed");
      if (conf.value.err) throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
      sigs.push(sig);
      cu.push(await env.txCu(sig));
    }
    console.log(`      ${label}: ${txs.length} txs, CU ${cu.join("/")}, bytes ${bytes.join("/")}`);
    return { sigs, cu, bytes };
  }

  async function setupFund(env: TestEnv, user: Keypair, nAssets: number, seededAssets = nAssets): Promise<{ client: sdk.Fi6900Client; assets: AssetInfo[] }> {
    await env.airdrop(env.authority.publicKey, 500);
    await env.airdrop(user.publicKey, 200);
    await env.createIndexMint();
    await env.initializeFund(50, 50, 100);
    const mints = await env.createMints(nAssets, 6);
    await env.mintManyTo(mints.slice(0, seededAssets), [env.authority.publicKey, user.publicKey], SEED * 4n);
    const first = await env.addAssets(mints.slice(0, seededAssets), 6, Math.floor(10_000 / nAssets));
    await env.seedVaults(first, SEED);
    await env.setRefPrices(first, Q64);
    const client = new sdk.Fi6900Client(env.connection, env.indexMint);
    // bootstrap needs [Asset, vault] for every active slot -> v0 + lookup table
    const plan0 = await client.createFundLookupTable(env.authority.publicKey);
    for (const ixs of plan0.instructionGroups) await env.send(ixs);
    await waitSlots(env.connection, 2);
    const tables0 = [];
    for (const t of plan0.lookupTables) tables0.push((await env.connection.getAddressLookupTable(t)).value!);
    const userAta = await env.ensureAta(user.publicKey, env.indexMint, TOKEN_PROGRAM_ID);
    const boot = await env.sendV0([await client.bootstrapMintIx(env.authority.publicKey, UNITS_BOOTSTRAP, userAta)], [env.authority], tables0);
    console.log(`      bootstrap_mint (${seededAssets} assets): CU ${boot.cu}, bytes ${boot.bytes}`);
    if (nAssets > seededAssets) {
      // the remaining slots are added with empty vaults (required = entitled = 0)
      await env.addAssets(mints.slice(seededAssets), 6, 0);
    }
    const grow = await client.extendFundLookupTables(env.authority.publicKey, env.authority.publicKey, plan0.lookupTables);
    for (const ixs of grow.instructionGroups) await env.send(ixs);
    await waitSlots(env.connection, 2);
    client.lookupTables = grow.lookupTables;
    console.log(`      ${nAssets} assets: ${grow.lookupTables.length} lookup table(s), ${plan0.addresses.length + grow.missing} addresses`);
    return { client, assets: env.assets };
  }

  describe("40-asset fund: creation and redemption round trip", () => {
    const env = new TestEnv();
    const user = Keypair.generate();
    let client: sdk.Fi6900Client;

    before(async () => {
      ({ client } = await setupFund(env, user, 40));
    });

    it("begin_mint covers all 40 slots in ONE transaction; the full creation is 9 txs", async () => {
      const units = 1_000n * UNIT;
      const supplyBefore = await client.readSupply();
      const nonce = 4040n;
      const txs = await client.buildMintTxs(user.publicKey, units, { nonce, skipAccrue: true });
      // [begin] + ceil(40/6)=7 deposit batches + [finalize]
      expect(txs.length).to.eq(1 + 7 + 1);
      const r = await sendV0All(env, txs.slice(0, 1), user, "begin_mint(40)");
      const session = await client.readMintSession(user.publicKey, nonce);
      expect(session!.ready).to.eq(true);
      expect(session!.nextSlot).to.eq(40);
      expect(session!.required.filter((x) => x > 0n).length).to.eq(40);
      expect(r.cu[0]).to.be.lessThan(1_400_000);
      expect(r.bytes[0]).to.be.lessThan(1232);
      await sendV0All(env, txs.slice(1, 8), user, "deposit batches");
      const fin = await sendV0All(env, txs.slice(8), user, "finalize_mint(40)");
      expect(fin.cu[0]).to.be.lessThan(1_400_000);
      expect(await client.readSupply()).to.eq(supplyBefore + units);
      expect(await env.tokenBalance(client.indexAta(user.publicKey))).to.eq(UNITS_BOOTSTRAP + units - (units * 50n) / 10_000n);
      expect(await client.readMintSession(user.publicKey, nonce)).to.eq(null);
      for (const a of await client.readAssets()) expect(a.pendingDeposits).to.eq(0n);
    });

    it("redemption of 40 assets is 1 begin + 5 withdraw batches + close", async () => {
      const units = 500n * UNIT;
      const supplyBefore = await client.readSupply();
      const txs = await client.buildRedeemTxs(user.publicKey, units, { nonce: 4041n, skipAccrue: true });
      expect(txs.length).to.eq(1 + 5 + 1);
      const r = await sendV0All(env, txs, user, "redeem(40)");
      expect(r.cu[0]).to.be.lessThan(1_400_000);
      expect(await client.readSupply()).to.eq(supplyBefore - (units - (units * 50n) / 10_000n));
      expect(await client.readRedeemSession(user.publicKey, 4041n)).to.eq(null);
      for (const a of await client.readAssets()) expect(a.pendingWithdrawals).to.eq(0n);
    });

    it("effective/supply ratios survive the round trip (non-dilutive)", async () => {
      const eff = await client.readEffectiveBalances();
      const supply = await client.readSupply();
      for (const e of eff) {
        // seeded SEED per asset against UNITS_BOOTSTRAP: ratio must not have dropped
        expect(e.effective * UNITS_BOOTSTRAP >= SEED * supply).to.eq(true);
      }
    });
  });

  describe("301-slot fund: 512-bit bitmaps and chunked begin at slot 300", () => {
    const env = new TestEnv();
    const user = Keypair.generate();
    let client: sdk.Fi6900Client;

    before(async () => {
      ({ client } = await setupFund(env, user, 301, 50));
    });

    it("occupies slots 0..300 and reports them through the SDK bitmap helpers", async () => {
      const fund = await client.readFund();
      expect(fund.assetCount).to.eq(301);
      expect(sdk.bitmapSlots(fund.activeBitmap).length).to.eq(301);
      expect((fund.activeBitmap >> 300n) & 1n).to.eq(1n);
      expect((fund.occupiedBitmap >> 301n) & 1n).to.eq(0n);
      const onchain = await env.fetchFund();
      expect(bitmapBig(onchain.activeBitmap)).to.eq(fund.activeBitmap);
      expect(slotsOf(fund.activeBitmap)[300]).to.eq(300);
    });

    it("begin_mint needs ceil(301/50) = 7 chunk txs; deposit at slot 300 sets bit 300; cancel refunds", async () => {
      const nonce = 3001n;
      const assets = await client.readActiveAssets();
      expect(assets.length).to.eq(301);
      const ixs = await client.beginMintIxs(user.publicKey, 10n * UNIT, nonce, assets);
      expect(ixs.length).to.eq(7);
      const tables = [];
      for (const t of client.lookupTables) tables.push((await env.connection.getAddressLookupTable(t)).value!);
      const cu: number[] = [];
      for (const [i, ix] of ixs.entries()) {
        const r = await env.sendV0([ix], [user], tables);
        cu.push(r.cu);
        const s = await client.readMintSession(user.publicKey, nonce);
        expect(s!.ready).to.eq(i === ixs.length - 1);
        expect(s!.nextSlot).to.eq(Math.min(301, (i + 1) * 50));
      }
      console.log(`      begin_mint chunks (301 assets): CU ${cu.join("/")}`);
      // a further continue is rejected once ready
      let rejected = false;
      await env.sendV0([await client.beginMintContinueIx(user.publicKey, nonce, assets.slice(0, 1))], [user], tables).catch(() => (rejected = true));
      expect(rejected).to.eq(true);
      const slot300 = assets.find((a) => a.index === 300)!;
      // required is 0 for the empty slot 300; deposit through the owner's ATA of that mint
      await env.ensureAta(user.publicKey, slot300.mint, TOKEN_PROGRAM_ID);
      await env.sendV0([await client.depositIx(user.publicKey, nonce, slot300)], [user], tables);
      const s = await client.readMintSession(user.publicKey, nonce);
      expect((s!.depositedBitmap >> 300n) & 1n).to.eq(1n);
      expect(s!.required[300]).to.eq(0n);
      expect(s!.required[0] > 0n).to.eq(true);
      const cancel = await client.buildCancelMintTxs(user.publicKey, nonce);
      await sendV0All(env, cancel, user, "cancel mint (301)");
      expect(await client.readMintSession(user.publicKey, nonce)).to.eq(null);
    });

    it("redemption across 301 slots: 7 begin chunks + 38 withdraw batches + close; slot 300 withdrawn", async () => {
      const units = 100n * UNIT;
      const supplyBefore = await client.readSupply();
      const txs = await client.buildRedeemTxs(user.publicKey, units, { nonce: 3002n, skipAccrue: true });
      expect(txs.length).to.eq(7 + 38 + 1);
      const r = await sendV0All(env, txs.slice(0, 7), user, "begin_redeem chunks (301)");
      const session = await client.readRedeemSession(user.publicKey, 3002n);
      expect(session!.ready).to.eq(true);
      expect(session!.entitled.filter((x) => x > 0n).length).to.eq(50);
      expect(session!.entitled[300]).to.eq(0n);
      expect(Math.max(...r.cu)).to.be.lessThan(1_400_000);
      await sendV0All(env, txs.slice(7, 45), user, "withdraw batches (301)");
      const s2 = await client.readRedeemSession(user.publicKey, 3002n);
      expect((s2!.withdrawnBitmap >> 300n) & 1n).to.eq(1n);
      expect(sdk.bitmapSlots(s2!.withdrawnBitmap).length).to.eq(301);
      await sendV0All(env, txs.slice(45), user, "close_redeem (301)");
      expect(await client.readRedeemSession(user.publicKey, 3002n)).to.eq(null);
      expect(await client.readSupply()).to.eq(supplyBefore - (units - (units * 50n) / 10_000n));
    });
  });
});
