import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  ActionKind,
  AssetInfo,
  PROGRAM_ID,
  bitmapBig,
  Q64,
  TestEnv,
  big,
  bn,
  buyAmountFor,
  expectAnchorError,
  grossForNet,
  linearPrice,
  mulDivCeil,
  mulDivFloor,
  sleep,
  transferFeeFor,
  waitSlots,
} from "./helpers";

const UNIT = 1_000_000n; // 6 decimals
const MINT_FEE_BPS = 50;
const REDEEM_FEE_BPS = 50;
const MGMT_FEE_BPS = 100;
const SECONDS_PER_YEAR = 31_557_600n;

describe("fi6900 program", function () {
  this.timeout(600_000);

  const env = new TestEnv();
  const user = Keypair.generate();
  const filler = Keypair.generate();

  // asset configs: [decimals, tokenProgram, seed amount for bootstrap]
  const assetSpecs: { decimals: number; program: PublicKey; seed: bigint }[] = [
    { decimals: 6, program: TOKEN_PROGRAM_ID, seed: 1_000_000n * 10n ** 6n },
    { decimals: 9, program: TOKEN_PROGRAM_ID, seed: 250_000n * 10n ** 9n },
    { decimals: 5, program: TOKEN_PROGRAM_ID, seed: 7_777_777n * 10n ** 5n },
    { decimals: 6, program: TOKEN_PROGRAM_ID, seed: 123_456_789n },
    { decimals: 8, program: TOKEN_2022_PROGRAM_ID, seed: 42_000n * 10n ** 8n },
  ];
  const BOOTSTRAP_UNITS = 1_000_000n * UNIT;

  let nonceCounter = 1n;
  const nextNonce = () => nonceCounter++;

  async function vaultBalances(assets: AssetInfo[]): Promise<bigint[]> {
    return Promise.all(assets.map((a) => env.tokenBalance(a.vault, a.tokenProgram)));
  }

  /** Full in-kind creation for `owner`. Returns the nonce. */
  async function doMint(owner: Keypair, units: bigint): Promise<bigint> {
    const nonce = nextNonce();
    await env.beginMint(owner, units, nonce);
    for (const a of await env.activeAssets()) await env.deposit(owner, nonce, a);
    await env.finalizeMint(owner, nonce);
    return nonce;
  }

  before(async () => {
    await env.airdrop(env.authority.publicKey, 500);
    await env.airdrop(user.publicKey, 100);
    await env.airdrop(filler.publicKey, 100);
    await env.createIndexMint();
  });

  // -------------------------------------------------------------------------

  describe("setup", () => {
    it("initialize_fund takes over the index mint and stores fees", async () => {
      await env.initializeFund(MINT_FEE_BPS, REDEEM_FEE_BPS, MGMT_FEE_BPS);
      const fund = await env.fetchFund();
      expect(fund.authority.toBase58()).to.eq(env.authority.publicKey.toBase58());
      expect(fund.rebalancer.toBase58()).to.eq(env.authority.publicKey.toBase58());
      expect(fund.feeRecipient.toBase58()).to.eq(env.authority.publicKey.toBase58());
      expect(fund.indexMint.toBase58()).to.eq(env.indexMint.toBase58());
      expect(fund.mintFeeBps).to.eq(MINT_FEE_BPS);
      expect(fund.redeemFeeBps).to.eq(REDEEM_FEE_BPS);
      expect(fund.mgmtFeeBps).to.eq(MGMT_FEE_BPS);
      expect(fund.assetCount).to.eq(0);
      expect(big(fund.epoch)).to.eq(0n);
      expect(big(fund.timelockSlots)).to.eq(0n);
      expect(fund.maxAuctionDiscountBps).to.eq(500);
      expect(fund.maxRefMoveBps).to.eq(2000);
      expect(big(fund.refMovePeriodSlots)).to.eq(216_000n);
      expect(fund.bump).to.eq(env.fundBump);

      const mint = await getMint(env.connection, env.indexMint);
      expect(mint.mintAuthority?.toBase58()).to.eq(env.fund.toBase58());
      expect(mint.decimals).to.eq(6);
    });

    it("rejects fees above the cap", async () => {
      await expectAnchorError(
        env.program.methods.setFees(5000, 50, 100).accountsStrict({ authority: env.authority.publicKey, fund: env.fund }).rpc(),
        "InvalidArgument",
      );
    });

    it("add_asset x5 assigns slots 0..4 and creates vault ATAs (incl. Token-2022)", async () => {
      for (const [i, spec] of assetSpecs.entries()) {
        const mint = await env.createAssetMint(spec.decimals, spec.program);
        const info = await env.addAsset(mint, spec.decimals, spec.program, 2000);
        expect(info.slot).to.eq(i);
        const acc = await env.fetchAsset(info.asset);
        expect(acc.decimals).to.eq(spec.decimals);
        expect(acc.status).to.eq(0);
        expect(acc.targetWeightBps).to.eq(2000);
        expect(acc.tokenProgram.toBase58()).to.eq(spec.program.toBase58());
        expect(acc.vault.toBase58()).to.eq(getAssociatedTokenAddressSync(mint, env.fund, true, spec.program).toBase58());
        // fund everyone with plenty of each asset
        for (const who of [env.authority.publicKey, user.publicKey, filler.publicKey]) {
          await env.mintTokens(mint, who, spec.seed * 10n, spec.program);
        }
      }
      const fund = await env.fetchFund();
      expect(fund.assetCount).to.eq(5);
      expect(bitmapBig(fund.activeBitmap)).to.eq(0b11111n);
      expect(bitmapBig(fund.occupiedBitmap)).to.eq(0b11111n);
    });

    it("set_ref_price: first value is authority-only; non-rebalancer callers are rejected", async () => {
      // asset0 1 nUSD/raw, asset1 2 nUSD/raw -> fair price 0.5 buy-raw per sell-raw for the 0->1 auctions below
      await expectAnchorError(env.setRefPrice(env.assets[0], Q64, user), "Unauthorized");
      await env.setRefPrice(env.assets[0], Q64);
      await env.setRefPrice(env.assets[1], 2n * Q64);
      for (const a of env.assets.slice(2)) await env.setRefPrice(a, Q64);
      const a0 = await env.fetchAsset(env.assets[0].asset);
      expect(big(a0.refPrice)).to.eq(Q64);
      expect(big(a0.refPriceAnchor)).to.eq(Q64);
      expect(big(a0.refPriceUpdatedSlot) > 0n).to.eq(true);
      await expectAnchorError(env.setRefPrice(env.assets[0], 0n), "InvalidArgument");
    });

    it("bootstrap_mint fails while a vault is empty", async () => {
      await expectAnchorError(env.bootstrapMint(BOOTSTRAP_UNITS), "EmptyVault");
    });

    it("bootstrap_mint mints the initial supply once the basket is in the vaults", async () => {
      for (const [i, a] of env.assets.entries()) await env.seedVault(a, assetSpecs[i].seed);
      await env.bootstrapMint(BOOTSTRAP_UNITS);
      expect(await env.supply()).to.eq(BOOTSTRAP_UNITS);
      expect(await env.tokenBalance(env.indexAta(env.authority.publicKey))).to.eq(BOOTSTRAP_UNITS);
      // second bootstrap must fail: supply != 0
      await expectAnchorError(env.bootstrapMint(1n), "SupplyNotZero");
    });

    it("begin_mint rejects wrong remaining accounts", async () => {
      const active = await env.activeAssets();
      const nonce = nextNonce();
      // swap order of first two assets
      const swapped = [active[1], active[0], ...active.slice(2)];
      await expectAnchorError(
        env.program.methods
          .beginMint(bn(UNIT), bn(nonce))
          .accountsStrict({
            owner: user.publicKey,
            fund: env.fund,
            indexMint: env.indexMint,
            session: env.mintSessionPda(user.publicKey, nonce),
            systemProgram: new PublicKey("11111111111111111111111111111111"),
          })
          .remainingAccounts(env.assetVaultMetas(swapped, false))
          .signers([user])
          .rpc(),
        "WrongRemainingAccounts",
      );
    });
  });

  // -------------------------------------------------------------------------

  describe("management fee", () => {
    it("accrue_management_fee mints supply * bps * dt / (10_000 * year) to the fee recipient", async () => {
      const feeAta = env.indexAta(env.authority.publicKey);
      const before = await env.fetchFund();
      const supplyBefore = await env.supply();
      const balBefore = await env.tokenBalance(feeAta);
      await sleep(2500);
      await env.accrueManagementFee();
      const after = await env.fetchFund();
      const dt = big(after.lastFeeAccrualTs) - big(before.lastFeeAccrualTs);
      expect(dt > 0n).to.eq(true);
      const expected = (supplyBefore * BigInt(MGMT_FEE_BPS) * dt) / (10_000n * SECONDS_PER_YEAR);
      expect(expected > 0n).to.eq(true);
      const minted = (await env.tokenBalance(feeAta)) - balBefore;
      expect(minted).to.eq(expected);
      expect(await env.supply()).to.eq(supplyBefore + expected);
    });

    it("is permissionless and emits FeesAccrued", async () => {
      await sleep(1200);
      const fund = await env.fetchFund();
      const sig = await env.program.methods
        .accrueManagementFee()
        .accountsStrict({
          fund: env.fund,
          indexMint: env.indexMint,
          feeRecipientAta: env.indexAta(fund.feeRecipient),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      const evs = await env.events(sig);
      expect(evs.map((e) => e.name)).to.include("feesAccrued");
    });
  });

  // -------------------------------------------------------------------------

  describe("in-kind creation", () => {
    const units = 10_000n * UNIT;
    let nonce: bigint;
    let supplyBefore: bigint;
    let vaultsBefore: bigint[];
    let active: AssetInfo[];

    it("begin_mint computes required[i] = ceil(effective_i * units / supply)", async () => {
      active = await env.activeAssets();
      supplyBefore = await env.supply();
      vaultsBefore = await vaultBalances(active);
      nonce = nextNonce();
      await env.beginMint(user, units, nonce);
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      expect(big(session.units)).to.eq(units);
      expect(big(session.epoch)).to.eq(big((await env.fetchFund()).epoch));
      expect(bitmapBig(session.depositedBitmap)).to.eq(0n);
      expect(session.ready).to.eq(1);
      expect(session.nextSlot).to.eq(5);
      for (const [i, a] of active.entries()) {
        const asset = await env.fetchAsset(a.asset);
        const effective = vaultsBefore[i] - big(asset.pendingDeposits) - big(asset.pendingWithdrawals);
        expect(big(session.required[a.slot])).to.eq(mulDivCeil(effective, units, supplyBefore));
      }
    });

    it("finalize_mint fails before all deposits", async () => {
      await expectAnchorError(env.finalizeMint(user, nonce), "IncompleteDeposits");
    });

    it("deposit moves required[slot] into the vault and tracks pending_deposits", async () => {
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      for (const [i, a] of active.entries()) {
        const userAta = getAssociatedTokenAddressSync(a.mint, user.publicKey, true, a.tokenProgram);
        const userBefore = await env.tokenBalance(userAta, a.tokenProgram);
        await env.deposit(user, nonce, a);
        const req = big(session.required[a.slot]);
        expect(await env.tokenBalance(a.vault, a.tokenProgram)).to.eq(vaultsBefore[i] + req);
        expect(await env.tokenBalance(userAta, a.tokenProgram)).to.eq(userBefore - req);
        expect(big((await env.fetchAsset(a.asset)).pendingDeposits)).to.eq(req);
      }
      const s2 = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      expect(bitmapBig(s2.depositedBitmap)).to.eq(0b11111n);
      await expectAnchorError(env.deposit(user, nonce, active[0]), "AlreadyDeposited");
    });

    it("finalize_mint mints units-fee to owner and fee to recipient, clears pending, closes session", async () => {
      const feeAta = env.indexAta(env.authority.publicKey);
      const feeBefore = await env.tokenBalance(feeAta);
      const sig = await env.finalizeMint(user, nonce);
      const fee = (units * BigInt(MINT_FEE_BPS)) / 10_000n;
      expect(await env.tokenBalance(env.indexAta(user.publicKey))).to.eq(units - fee);
      expect((await env.tokenBalance(feeAta)) - feeBefore).to.eq(fee);
      expect(await env.supply()).to.eq(supplyBefore + units);
      for (const a of active) expect(big((await env.fetchAsset(a.asset)).pendingDeposits)).to.eq(0n);
      expect(await env.connection.getAccountInfo(env.mintSessionPda(user.publicKey, nonce))).to.eq(null);
      const evs = await env.events(sig);
      const ev = evs.find((e) => e.name === "mintFinalized");
      expect(ev).to.not.eq(undefined);
      expect(big(ev!.data.units)).to.eq(units);
      expect(big(ev!.data.fee)).to.eq(fee);
    });

    it("keeps vault/supply ratios constant (never dilutes existing holders)", async () => {
      const supplyAfter = await env.supply();
      const vaultsAfter = await vaultBalances(active);
      for (let i = 0; i < active.length; i++) {
        // vault_after / supply_after >= vault_before / supply_before  (ceil rounding favours the fund)
        expect(vaultsAfter[i] * supplyBefore >= vaultsBefore[i] * supplyAfter).to.eq(true);
        // and the excess is at most one base unit of the asset per unit minted
        const excess = vaultsAfter[i] * supplyBefore - vaultsBefore[i] * supplyAfter;
        expect(excess <= supplyBefore).to.eq(true);
      }
    });

    it("handles an asset with zero effective balance (required = 0) in a full round trip", async () => {
      // add a 6th asset with an empty vault, mint through it, then remove it
      const mint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
      const info = await env.addAsset(mint, 6, TOKEN_PROGRAM_ID, 0);
      expect(info.slot).to.eq(5);
      await env.mintTokens(mint, user.publicKey, 1_000_000n, TOKEN_PROGRAM_ID);
      const n = nextNonce();
      const small = 7n * UNIT;
      await env.beginMint(user, small, n);
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, n));
      expect(big(session.required[5])).to.eq(0n);
      for (const a of await env.activeAssets()) await env.deposit(user, n, a);
      await env.finalizeMint(user, n);
      expect(await env.tokenBalance(info.vault)).to.eq(0n);

      // remove it again
      await env.program.methods
        .beginRemoveAsset()
        .accountsStrict({ authority: env.authority.publicKey, fund: env.fund, asset: info.asset })
        .rpc();
      let fund = await env.fetchFund();
      expect(bitmapBig(fund.activeBitmap)).to.eq(0b11111n);
      expect((await env.fetchAsset(info.asset)).status).to.eq(1);
      await env.program.methods
        .finalizeRemoveAsset()
        .accountsStrict({
          authority: env.authority.publicKey,
          fund: env.fund,
          asset: info.asset,
          vault: info.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      fund = await env.fetchFund();
      expect(fund.assetCount).to.eq(5);
      expect(bitmapBig(fund.occupiedBitmap)).to.eq(0b11111n);
      expect(await env.connection.getAccountInfo(info.asset)).to.eq(null);
      expect(await env.connection.getAccountInfo(info.vault)).to.eq(null);
      env.assets.splice(env.assets.indexOf(info), 1);
    });
  });

  // -------------------------------------------------------------------------

  describe("in-kind redemption", () => {
    const units = 4_000n * UNIT;
    let nonce: bigint;
    let supplyBefore: bigint;
    let vaultsBefore: bigint[];
    let active: AssetInfo[];
    let userIndexBefore: bigint;
    let feeBefore: bigint;
    const fee = (units * BigInt(REDEEM_FEE_BPS)) / 10_000n;
    const net = units - fee;

    it("begin_redeem pays the fee, burns net units, and reserves entitled[i] = floor(effective_i * net / supply)", async () => {
      active = await env.activeAssets();
      supplyBefore = await env.supply();
      vaultsBefore = await vaultBalances(active);
      userIndexBefore = await env.tokenBalance(env.indexAta(user.publicKey));
      feeBefore = await env.tokenBalance(env.indexAta(env.authority.publicKey));
      nonce = nextNonce();
      const sig = await env.beginRedeem(user, units, nonce);

      expect(await env.tokenBalance(env.indexAta(user.publicKey))).to.eq(userIndexBefore - units);
      expect(await env.tokenBalance(env.indexAta(env.authority.publicKey))).to.eq(feeBefore + fee);
      expect(await env.supply()).to.eq(supplyBefore - net);

      const session = await env.program.account.redeemSession.fetch(env.redeemSessionPda(user.publicKey, nonce));
      expect(big(session.units)).to.eq(net);
      for (const [i, a] of active.entries()) {
        const expected = mulDivFloor(vaultsBefore[i], net, supplyBefore);
        expect(big(session.entitled[a.slot])).to.eq(expected);
        expect(big((await env.fetchAsset(a.asset)).pendingWithdrawals)).to.eq(expected);
      }
      const ev = (await env.events(sig)).find((e) => e.name === "redeemBegun");
      expect(big(ev!.data.units)).to.eq(units);
      expect(big(ev!.data.fee)).to.eq(fee);
    });

    it("close_redeem fails before all withdrawals", async () => {
      await expectAnchorError(env.closeRedeem(user, nonce), "IncompleteWithdrawals");
    });

    it("withdraw pays entitled[slot] from the vault and clears pending_withdrawals", async () => {
      const session = await env.program.account.redeemSession.fetch(env.redeemSessionPda(user.publicKey, nonce));
      for (const [i, a] of active.entries()) {
        const userAta = getAssociatedTokenAddressSync(a.mint, user.publicKey, true, a.tokenProgram);
        const before = await env.tokenBalance(userAta, a.tokenProgram);
        await env.withdraw(user, nonce, a);
        const ent = big(session.entitled[a.slot]);
        expect((await env.tokenBalance(userAta, a.tokenProgram)) - before).to.eq(ent);
        expect(await env.tokenBalance(a.vault, a.tokenProgram)).to.eq(vaultsBefore[i] - ent);
        expect(big((await env.fetchAsset(a.asset)).pendingWithdrawals)).to.eq(0n);
      }
      await expectAnchorError(env.withdraw(user, nonce, active[0]), "AlreadyWithdrawn");
    });

    it("close_redeem returns rent and keeps ratios non-dilutive", async () => {
      await env.closeRedeem(user, nonce);
      expect(await env.connection.getAccountInfo(env.redeemSessionPda(user.publicKey, nonce))).to.eq(null);
      const supplyAfter = await env.supply();
      const vaultsAfter = await vaultBalances(active);
      for (let i = 0; i < active.length; i++) {
        expect(vaultsAfter[i] * supplyBefore >= vaultsBefore[i] * supplyAfter).to.eq(true);
      }
    });
  });

  // -------------------------------------------------------------------------

  describe("pause flags", () => {
    it("bit0 blocks begin_mint, bit1 blocks begin_redeem, bit2 blocks start_auction", async () => {
      const set = (mask: number) =>
        env.program.methods.setPaused(mask).accountsStrict({ authority: env.authority.publicKey, fund: env.fund }).rpc();
      await set(1);
      await expectAnchorError(env.beginMint(user, UNIT, nextNonce()), "Paused");
      await set(2);
      await expectAnchorError(env.beginRedeem(user, UNIT, nextNonce()), "Paused");
      await set(4);
      await expectAnchorError(env.startAuction(env.assets[0], env.assets[1], 1n, Q64, Q64, 10), "Paused");
      await set(0);
      expect((await env.fetchFund()).paused).to.eq(0);
    });

    it("rejects unknown mask bits and non-authority callers", async () => {
      await expectAnchorError(
        env.program.methods.setPaused(8).accountsStrict({ authority: env.authority.publicKey, fund: env.fund }).rpc(),
        "InvalidArgument",
      );
      await expectAnchorError(
        env.program.methods.setPaused(1).accountsStrict({ authority: user.publicKey, fund: env.fund }).signers([user]).rpc(),
        "Unauthorized",
      );
    });
  });

  // -------------------------------------------------------------------------

  describe("dutch auctions", () => {
    const sellTotal = 1_000n * 10n ** 6n; // asset0 (6 dec)
    const startPrice = 2n * Q64 + Q64 / 2n; // 2.5 buy per sell (base units)
    const endPrice = Q64 / 2n; // 0.5
    const duration = 60;
    let auction: PublicKey;
    let sell: AssetInfo;
    let buy: AssetInfo;

    it("start_auction (rebalancer only) opens an auction and bumps open_auctions", async () => {
      sell = env.assets[0];
      buy = env.assets[1];
      await expectAnchorError(
        env.startAuction(sell, buy, sellTotal, startPrice, endPrice, duration, user),
        "Unauthorized",
      );
      const res = await env.startAuction(sell, buy, sellTotal, startPrice, endPrice, duration);
      auction = res.auction;
      const fund = await env.fetchFund();
      expect(fund.openAuctions).to.eq(1);
      expect(big(fund.auctionNonce)).to.eq(res.nonce + 1n);
      const a = await env.program.account.auction.fetch(auction);
      expect(big(a.sellRemaining)).to.eq(sellTotal);
      expect(big(a.startPrice)).to.eq(startPrice);
      expect(big(a.endPrice)).to.eq(endPrice);
      expect(big(a.endSlot) - big(a.startSlot)).to.eq(BigInt(duration));
      expect(a.status).to.eq(0);
      expect(big(a.nonce)).to.eq(res.nonce);
    });

    it("begin_mint is blocked while an auction is open", async () => {
      await expectAnchorError(env.beginMint(user, UNIT, nextNonce()), "AuctionsOpen");
    });

    it("fill_auction clears at the linearly decayed price with ceil(sell*price), bumps epoch", async () => {
      await waitSlots(env.connection, 5);
      const fillAmount = 400n * 10n ** 6n;
      const epochBefore = big((await env.fetchFund()).epoch);
      const sellVaultBefore = await env.tokenBalance(sell.vault, sell.tokenProgram);
      const buyVaultBefore = await env.tokenBalance(buy.vault, buy.tokenProgram);
      const fillerBuyAta = getAssociatedTokenAddressSync(buy.mint, filler.publicKey, true, buy.tokenProgram);
      const fillerBuyBefore = await env.tokenBalance(fillerBuyAta, buy.tokenProgram);

      const sig = await env.fillAuction(filler, auction, sell, buy, fillAmount);
      const slot = await env.txSlot(sig);
      const a = await env.program.account.auction.fetch(auction);
      const elapsed = slot - big(a.startSlot);
      const expectedPrice = linearPrice(startPrice, endPrice, elapsed, BigInt(duration));
      const expectedBuy = buyAmountFor(fillAmount, expectedPrice);
      expect(expectedPrice < startPrice).to.eq(true);

      const ev = (await env.events(sig)).find((e) => e.name === "auctionFilled");
      expect(ev).to.not.eq(undefined);
      expect(big(ev!.data.price)).to.eq(expectedPrice);
      expect(big(ev!.data.buyAmount)).to.eq(expectedBuy);
      expect(big(ev!.data.sellAmount)).to.eq(fillAmount);

      expect(big(a.sellRemaining)).to.eq(sellTotal - fillAmount);
      expect(big(a.boughtTotal)).to.eq(expectedBuy);
      expect(a.status).to.eq(0);
      expect(await env.tokenBalance(sell.vault, sell.tokenProgram)).to.eq(sellVaultBefore - fillAmount);
      expect(await env.tokenBalance(buy.vault, buy.tokenProgram)).to.eq(buyVaultBefore + expectedBuy);
      expect(await env.tokenBalance(fillerBuyAta, buy.tokenProgram)).to.eq(fillerBuyBefore - expectedBuy);
      expect(big((await env.fetchFund()).epoch)).to.eq(epochBefore + 1n);
    });

    it("price keeps decaying between fills", async () => {
      await waitSlots(env.connection, 5);
      const a0 = await env.program.account.auction.fetch(auction);
      const sig = await env.fillAuction(filler, auction, sell, buy, 100n * 10n ** 6n);
      const ev = (await env.events(sig)).find((e) => e.name === "auctionFilled")!;
      const slot = await env.txSlot(sig);
      const expectedPrice = linearPrice(startPrice, endPrice, slot - big(a0.startSlot), BigInt(duration));
      expect(big(ev.data.price)).to.eq(expectedPrice);
      // monotonic: later fill price < first fill price (first fill was at a lower elapsed)
      const first = await env.program.account.auction.fetch(auction);
      expect(big(first.sellRemaining)).to.eq(sellTotal - 500n * 10n ** 6n);
    });

    it("rejects fills above sell_remaining, then auto-closes on the final fill", async () => {
      const a = await env.program.account.auction.fetch(auction);
      const remaining = big(a.sellRemaining);
      await expectAnchorError(env.fillAuction(filler, auction, sell, buy, remaining + 1n), "ExceedsRemaining");
      const sig = await env.fillAuction(filler, auction, sell, buy, remaining);
      const after = await env.program.account.auction.fetch(auction);
      expect(after.status).to.eq(1);
      expect(big(after.sellRemaining)).to.eq(0n);
      expect((await env.fetchFund()).openAuctions).to.eq(0);
      const names = (await env.events(sig)).map((e) => e.name);
      expect(names).to.include("auctionClosed");
      await expectAnchorError(env.fillAuction(filler, auction, sell, buy, 1n), "AuctionNotOpen");
    });

    it("cancel_auction: rebalancer any time; others only after end_slot (expired)", async () => {
      const r1 = await env.startAuction(sell, buy, 10n * 10n ** 6n, startPrice, endPrice, 200);
      await expectAnchorError(env.cancelAuction(user, r1.auction), "AuctionNotEnded");
      await env.cancelAuction(env.authority, r1.auction);
      expect((await env.program.account.auction.fetch(r1.auction)).status).to.eq(2);
      expect((await env.fetchFund()).openAuctions).to.eq(0);

      const r2 = await env.startAuction(sell, buy, 10n * 10n ** 6n, startPrice, endPrice, 2);
      await waitSlots(env.connection, 4);
      await expectAnchorError(env.fillAuction(filler, r2.auction, sell, buy, 1n), "AuctionEnded");
      await env.cancelAuction(user, r2.auction);
      expect((await env.program.account.auction.fetch(r2.auction)).status).to.eq(3);
      expect((await env.fetchFund()).openAuctions).to.eq(0);
    });

    it("start_auction cannot sell more than the effective balance or sell into a non-active asset", async () => {
      const vault = await env.tokenBalance(sell.vault, sell.tokenProgram);
      await expectAnchorError(env.startAuction(sell, buy, vault + 1n, startPrice, endPrice, 10), "InsufficientBalance");
      await expectAnchorError(env.startAuction(sell, sell, 1n, startPrice, endPrice, 10), "InvalidArgument");
      await expectAnchorError(env.startAuction(sell, buy, 1n, endPrice, startPrice, 10), "InvalidArgument");
    });
  });

  // -------------------------------------------------------------------------

  describe("auction price bounds (ref prices)", () => {
    it("start_auction rejects end_price below fair * (1 - max_auction_discount) and accepts at the bound", async () => {
      const sell = env.assets[0];
      const buy = env.assets[1];
      // fair = ref0/ref1 = 0.5; max discount 500 bps -> min end = 0.475
      const fair = Q64 / 2n;
      const minEnd = (fair * 9500n) / 10_000n;
      await expectAnchorError(env.startAuction(sell, buy, 1_000n, Q64, minEnd - 1n, 50), "PriceBelowBound");
      const r = await env.startAuction(sell, buy, 1_000n, Q64, minEnd, 50);
      expect(big((await env.program.account.auction.fetch(r.auction)).endPrice)).to.eq(minEnd);
      await env.cancelAuction(env.authority, r.auction);
      // the bound is buy-side agnostic: selling 1 -> 0 has fair = 2.0, so end 1.0 is far too low
      await expectAnchorError(env.startAuction(buy, sell, 1_000n, 3n * Q64, Q64, 50), "PriceBelowBound");
      const r2 = await env.startAuction(buy, sell, 1_000n, 3n * Q64, 2n * Q64, 50);
      await env.cancelAuction(env.authority, r2.auction);
    });

    it("an asset without a ref price cannot be auctioned", async () => {
      const mint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
      const tmp = await env.addAsset(mint, 6, TOKEN_PROGRAM_ID, 0);
      await expectAnchorError(env.startAuction(env.assets[0], tmp, 1n, Q64, Q64, 10), "RefPriceUnset");
      await env.program.methods.beginRemoveAsset().accountsStrict({ authority: env.authority.publicKey, fund: env.fund, asset: tmp.asset }).rpc();
      await env.program.methods
        .finalizeRemoveAsset()
        .accountsStrict({ authority: env.authority.publicKey, fund: env.fund, asset: tmp.asset, vault: tmp.vault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      env.assets.splice(env.assets.indexOf(tmp), 1);
    });

    it("rebalancer moves are capped at max_ref_move_bps per period; authority may override while timelock is 0", async () => {
      const auth = env.authority.publicKey;
      const a = env.assets[2];
      await env.program.methods.setRebalancer(filler.publicKey).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      // anchor = 1.0; 30% move rejected, 20% accepted (ceil(move) <= 2000), then 10% from the SAME anchor is fine,
      // but 25% from the anchor is not even though it is only ~4% from the latest value
      await expectAnchorError(env.setRefPrice(a, (Q64 * 13n) / 10n, filler), "RefPriceMoveTooLarge");
      const sig = await env.setRefPrice(a, (Q64 * 12n) / 10n, filler);
      const ev = (await env.events(sig)).find((e) => e.name === "refPriceSet");
      expect(big(ev!.data.oldPrice)).to.eq(Q64);
      expect(big(ev!.data.newPrice)).to.eq((Q64 * 12n) / 10n);
      await env.setRefPrice(a, (Q64 * 11n) / 10n, filler);
      await expectAnchorError(env.setRefPrice(a, (Q64 * 125n) / 100n, filler), "RefPriceMoveTooLarge");
      expect(big((await env.fetchAsset(a.asset)).refPriceAnchor)).to.eq(Q64);
      // user is neither rebalancer nor authority
      await expectAnchorError(env.setRefPrice(a, Q64, user), "Unauthorized");
      // authority override (timelock 0): unbounded, re-anchors
      await env.setRefPrice(a, 2n * Q64);
      const acc = await env.fetchAsset(a.asset);
      expect(big(acc.refPrice)).to.eq(2n * Q64);
      expect(big(acc.refPriceAnchor)).to.eq(2n * Q64);
      // restore
      await env.setRefPrice(a, Q64);
      await env.program.methods.setRebalancer(auth).accountsStrict({ authority: auth, fund: env.fund }).rpc();
    });

    it("set_auction_params (direct while timelock is 0) changes the bound", async () => {
      const auth = env.authority.publicKey;
      await env.program.methods.setAuctionParams(1000, 2000, bn(216_000)).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      expect((await env.fetchFund()).maxAuctionDiscountBps).to.eq(1000);
      // fair 0.5, 10% discount -> 0.45 now accepted
      const r = await env.startAuction(env.assets[0], env.assets[1], 1_000n, Q64, (Q64 * 45n) / 100n, 50);
      await env.cancelAuction(env.authority, r.auction);
      await expectAnchorError(
        env.program.methods.setAuctionParams(6000, 2000, bn(216_000)).accountsStrict({ authority: auth, fund: env.fund }).rpc(),
        "InvalidArgument",
      );
      await env.program.methods.setAuctionParams(500, 2000, bn(216_000)).accountsStrict({ authority: auth, fund: env.fund }).rpc();
    });
  });

  // -------------------------------------------------------------------------

  describe("epoch invalidation", () => {
    it("an auction fill makes an open mint session stale; refund + close recovers deposits", async () => {
      const active = await env.activeAssets();
      const nonce = nextNonce();
      const units = 100n * UNIT;
      await env.beginMint(user, units, nonce);
      await env.deposit(user, nonce, active[0]);
      await env.deposit(user, nonce, active[1]);
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      const vault0Before = await env.tokenBalance(active[0].vault, active[0].tokenProgram);

      // rebalance happens underneath the session
      const sell = env.assets[2];
      const buy = env.assets[3];
      const r = await env.startAuction(sell, buy, 1_000n, Q64, Q64, 50);
      await env.fillAuction(filler, r.auction, sell, buy, 1_000n);
      expect((await env.fetchFund()).openAuctions).to.eq(0);

      await expectAnchorError(env.deposit(user, nonce, active[2]), "StaleEpoch");
      // finalize with everything deposited would still fail on epoch; it fails on deposits first here,
      // so deposit the rest is impossible: verify finalize reports StaleEpoch regardless.
      await expectAnchorError(env.finalizeMint(user, nonce), "StaleEpoch");

      // cancel_mint_close refuses while deposits remain
      await expectAnchorError(env.cancelMintClose(user, nonce), "IncompleteDeposits");

      await env.cancelMintRefund(user, nonce, active[0]);
      await env.cancelMintRefund(user, nonce, active[1]);
      expect(await env.tokenBalance(active[0].vault, active[0].tokenProgram)).to.eq(
        vault0Before - big(session.required[active[0].slot]),
      );
      expect(big((await env.fetchAsset(active[0].asset)).pendingDeposits)).to.eq(0n);
      expect(big((await env.fetchAsset(active[1].asset)).pendingDeposits)).to.eq(0n);
      await env.cancelMintClose(user, nonce);
      expect(await env.connection.getAccountInfo(env.mintSessionPda(user.publicKey, nonce))).to.eq(null);
    });

    it("a fresh session after the fill mints normally", async () => {
      const supplyBefore = await env.supply();
      await doMint(user, 50n * UNIT);
      expect(await env.supply()).to.eq(supplyBefore + 50n * UNIT);
    });
  });

  // -------------------------------------------------------------------------

  describe("authority transfer and admin setters", () => {
    it("propose_authority + accept_authority moves control; old authority loses it", async () => {
      await env.program.methods
        .proposeAuthority(user.publicKey)
        .accountsStrict({ authority: env.authority.publicKey, fund: env.fund })
        .rpc();
      expect((await env.fetchFund()).pendingAuthority.toBase58()).to.eq(user.publicKey.toBase58());

      await expectAnchorError(
        env.program.methods.acceptAuthority().accountsStrict({ pendingAuthority: filler.publicKey, fund: env.fund }).signers([filler]).rpc(),
        "Unauthorized",
      );
      await env.program.methods
        .acceptAuthority()
        .accountsStrict({ pendingAuthority: user.publicKey, fund: env.fund })
        .signers([user])
        .rpc();
      let fund = await env.fetchFund();
      expect(fund.authority.toBase58()).to.eq(user.publicKey.toBase58());
      expect(fund.pendingAuthority.toBase58()).to.eq(PublicKey.default.toBase58());

      await expectAnchorError(
        env.program.methods.setFees(10, 10, 10).accountsStrict({ authority: env.authority.publicKey, fund: env.fund }).rpc(),
        "Unauthorized",
      );

      // hand it back
      await env.program.methods
        .proposeAuthority(env.authority.publicKey)
        .accountsStrict({ authority: user.publicKey, fund: env.fund })
        .signers([user])
        .rpc();
      await env.program.methods
        .acceptAuthority()
        .accountsStrict({ pendingAuthority: env.authority.publicKey, fund: env.fund })
        .rpc();
      fund = await env.fetchFund();
      expect(fund.authority.toBase58()).to.eq(env.authority.publicKey.toBase58());
    });

    it("set_fees / set_rebalancer / set_fee_recipient / set_target_weight", async () => {
      const auth = env.authority.publicKey;
      await env.program.methods.setFees(10, 20, 30).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      await env.program.methods.setRebalancer(filler.publicKey).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      await env.program.methods.setFeeRecipient(filler.publicKey).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      await env.program.methods
        .setTargetWeight(1234)
        .accountsStrict({ authority: auth, fund: env.fund, asset: env.assets[0].asset })
        .rpc();
      const fund = await env.fetchFund();
      expect([fund.mintFeeBps, fund.redeemFeeBps, fund.mgmtFeeBps]).to.deep.eq([10, 20, 30]);
      expect(fund.rebalancer.toBase58()).to.eq(filler.publicKey.toBase58());
      expect(fund.feeRecipient.toBase58()).to.eq(filler.publicKey.toBase58());
      expect((await env.fetchAsset(env.assets[0].asset)).targetWeightBps).to.eq(1234);

      // new rebalancer can open auctions; old one cannot
      await expectAnchorError(env.startAuction(env.assets[0], env.assets[1], 1n, Q64, Q64, 10, env.authority), "Unauthorized");
      const r = await env.startAuction(env.assets[0], env.assets[1], 1n, Q64, Q64, 10, filler);
      await env.cancelAuction(filler, r.auction);

      // fee recipient change is honoured by accrue (needs the new recipient's ATA)
      await env.ensureAta(filler.publicKey, env.indexMint, TOKEN_PROGRAM_ID);
      await sleep(1100);
      const before = await env.tokenBalance(env.indexAta(filler.publicKey));
      await env.accrueManagementFee();
      expect((await env.tokenBalance(env.indexAta(filler.publicKey))) > before).to.eq(true);

      // restore
      await env.program.methods.setFees(MINT_FEE_BPS, REDEEM_FEE_BPS, MGMT_FEE_BPS).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      await env.program.methods.setRebalancer(auth).accountsStrict({ authority: auth, fund: env.fund }).rpc();
      await env.program.methods.setFeeRecipient(auth).accountsStrict({ authority: auth, fund: env.fund }).rpc();
    });
  });

  // -------------------------------------------------------------------------

  describe("asset removal while balances exist", () => {
    it("begin_remove_asset drops the slot from mint/redeem; finalize refuses until the vault is empty", async () => {
      const victim = env.assets[4]; // Token-2022 asset
      await env.program.methods
        .beginRemoveAsset()
        .accountsStrict({ authority: env.authority.publicKey, fund: env.fund, asset: victim.asset })
        .rpc();
      const fund = await env.fetchFund();
      expect(bitmapBig(fund.activeBitmap)).to.eq(0b01111n);
      expect(bitmapBig(fund.occupiedBitmap)).to.eq(0b11111n);

      // deposits into a Removing asset are rejected; mints only need the 4 active slots now
      const nonce = nextNonce();
      await env.beginMint(user, 10n * UNIT, nonce);
      await expectAnchorError(env.deposit(user, nonce, victim), "SlotNotActive");
      for (const a of await env.activeAssets()) await env.deposit(user, nonce, a);
      await env.finalizeMint(user, nonce);

      await expectAnchorError(
        env.program.methods
          .finalizeRemoveAsset()
          .accountsStrict({
            authority: env.authority.publicKey,
            fund: env.fund,
            asset: victim.asset,
            vault: victim.vault,
            tokenProgram: victim.tokenProgram,
          })
          .rpc(),
        "AssetNotEmpty",
      );

      // the removing asset can still be auctioned out of the vault
      const bal = await env.tokenBalance(victim.vault, victim.tokenProgram);
      const r = await env.startAuction(victim, env.assets[0], bal, Q64, Q64, 100);
      await env.fillAuction(filler, r.auction, victim, env.assets[0], bal);
      expect(await env.tokenBalance(victim.vault, victim.tokenProgram)).to.eq(0n);

      await env.program.methods
        .finalizeRemoveAsset()
        .accountsStrict({
          authority: env.authority.publicKey,
          fund: env.fund,
          asset: victim.asset,
          vault: victim.vault,
          tokenProgram: victim.tokenProgram,
        })
        .rpc();
      const f2 = await env.fetchFund();
      expect(f2.assetCount).to.eq(4);
      expect(bitmapBig(f2.occupiedBitmap)).to.eq(0b01111n);
      env.assets.splice(env.assets.indexOf(victim), 1);

      // slot 4 is free again and gets reused
      const mint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
      const re = await env.addAsset(mint, 6, TOKEN_PROGRAM_ID, 1000);
      expect(re.slot).to.eq(4);
    });
  });

  describe("admin timelock", () => {
    const TL = 20;
    const auth = () => env.authority.publicKey;

    it("set_timelock enables the lock; direct setters are then rejected with TimelockRequired", async () => {
      await env.setTimelock(TL);
      expect(big((await env.fetchFund()).timelockSlots)).to.eq(BigInt(TL));
      await expectAnchorError(env.program.methods.setFees(10, 10, 10).accountsStrict({ authority: auth(), fund: env.fund }).rpc(), "TimelockRequired");
      await expectAnchorError(env.program.methods.setRebalancer(user.publicKey).accountsStrict({ authority: auth(), fund: env.fund }).rpc(), "TimelockRequired");
      await expectAnchorError(env.program.methods.setFeeRecipient(user.publicKey).accountsStrict({ authority: auth(), fund: env.fund }).rpc(), "TimelockRequired");
      await expectAnchorError(
        env.program.methods.setTargetWeight(100).accountsStrict({ authority: auth(), fund: env.fund, asset: env.assets[0].asset }).rpc(),
        "TimelockRequired",
      );
      await expectAnchorError(
        env.program.methods.beginRemoveAsset().accountsStrict({ authority: auth(), fund: env.fund, asset: env.assets[0].asset }).rpc(),
        "TimelockRequired",
      );
      await expectAnchorError(env.setTimelock(0), "TimelockRequired");
      await expectAnchorError(
        env.program.methods.setAuctionParams(500, 2000, bn(1)).accountsStrict({ authority: auth(), fund: env.fund }).rpc(),
        "TimelockRequired",
      );
      const mint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
      await expectAnchorError(env.addAsset(mint, 6, TOKEN_PROGRAM_ID, 0), "TimelockRequired");
      // authority ref-price override beyond the cap also needs the timelock now
      await expectAnchorError(env.setRefPrice(env.assets[2], 3n * Q64), "TimelockRequired");
      // protective pause stays instant
      await env.program.methods.setPaused(1).accountsStrict({ authority: auth(), fund: env.fund }).rpc();
      await env.program.methods.setPaused(0).accountsStrict({ authority: auth(), fund: env.fund }).rpc();
    });

    it("queue_action: authority only, validates payload, emits ActionQueued with eta = now + timelock", async () => {
      await expectAnchorError(env.queueAction(ActionKind.SetFees, PublicKey.default, [11, 22, 33], user), "Unauthorized");
      await expectAnchorError(env.queueAction(ActionKind.SetFees, PublicKey.default, [5000, 22, 33]), "InvalidArgument");
      await expectAnchorError(env.queueAction(99 as ActionKind, PublicKey.default, []), "InvalidActionKind");
      const { sig, action, nonce } = await env.queueAction(ActionKind.SetFees, PublicKey.default, [11, 22, 33]);
      const acc = await env.fetchAction(action);
      expect(acc.kind).to.eq(ActionKind.SetFees);
      expect(big(acc.nonce)).to.eq(nonce);
      expect(big(acc.etaSlot) - big(acc.queuedSlot)).to.eq(BigInt(TL));
      expect(acc.proposer.toBase58()).to.eq(auth().toBase58());
      const ev = (await env.events(sig)).find((e) => e.name === "actionQueued");
      expect(ev).to.not.eq(undefined);
      expect(big((await env.fetchFund()).actionNonce)).to.eq(nonce + 1n);
    });

    it("execute_action fails before eta, then anyone can execute; cancel_action closes the account", async () => {
      const pending = (await env.program.account.pendingAction.all()).find((a) => a.account.fund.equals(env.fund) && a.account.kind === ActionKind.SetFees)!;
      await expectAnchorError(env.executeAction(pending.publicKey, user), "TimelockNotElapsed");
      await waitSlots(env.connection, TL + 1);
      const sig = await env.executeAction(pending.publicKey, user);
      const fund = await env.fetchFund();
      expect([fund.mintFeeBps, fund.redeemFeeBps, fund.mgmtFeeBps]).to.deep.eq([11, 22, 33]);
      expect(await env.connection.getAccountInfo(pending.publicKey)).to.eq(null);
      expect((await env.events(sig)).map((e) => e.name)).to.include("actionExecuted");

      const q = await env.queueAction(ActionKind.SetRebalancer, user.publicKey, []);
      await expectAnchorError(env.cancelAction(q.action, user), "Unauthorized");
      const csig = await env.cancelAction(q.action);
      expect(await env.connection.getAccountInfo(q.action)).to.eq(null);
      expect((await env.events(csig)).map((e) => e.name)).to.include("actionCancelled");
      expect((await env.fetchFund()).rebalancer.toBase58()).to.eq(auth().toBase58());
    });

    it("add_asset / begin_remove_asset / ref-price override / target weight go through the queue", async () => {
      const mint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
      const add = await env.queueAction(ActionKind.AddAsset, mint, [777]);
      const ref = await env.queueAction(ActionKind.RefPriceOverride, env.assets[2].mint, [0n, 3n]); // lo64 = 0, hi64 = 3 -> 3 * 2^64
      const w = await env.queueAction(ActionKind.SetTargetWeight, env.assets[0].mint, [4321]);
      await expectAnchorError(env.executeAction(add.action, user), "TimelockNotElapsed");
      await waitSlots(env.connection, TL + 1);
      // wrong ix for the kind
      await expectAnchorError(env.executeAction(add.action, user), "WrongActionKind");
      await env.executeActionAddAsset(add.action, mint, TOKEN_PROGRAM_ID, user);
      const asset = await env.fetchAsset(env.assetPda(mint));
      expect(asset.targetWeightBps).to.eq(777);
      expect(asset.status).to.eq(0);
      const added: AssetInfo = { mint, decimals: 6, tokenProgram: TOKEN_PROGRAM_ID, asset: env.assetPda(mint), vault: asset.vault, slot: asset.index };
      // missing / wrong asset account
      await expectAnchorError(env.executeAction(ref.action, user), "WrongActionTarget");
      await expectAnchorError(env.executeAction(ref.action, user, env.assets[0].asset), "WrongActionTarget");
      await env.executeAction(ref.action, user, env.assets[2].asset);
      const a2 = await env.fetchAsset(env.assets[2].asset);
      expect(big(a2.refPrice)).to.eq(3n * Q64);
      expect(big(a2.refPriceAnchor)).to.eq(3n * Q64);
      await env.executeAction(w.action, user, env.assets[0].asset);
      expect((await env.fetchAsset(env.assets[0].asset)).targetWeightBps).to.eq(4321);

      const rm = await env.queueAction(ActionKind.BeginRemoveAsset, mint, []);
      await waitSlots(env.connection, TL + 1);
      await env.executeAction(rm.action, user, added.asset);
      expect((await env.fetchAsset(added.asset)).status).to.eq(1);
      // finalize_remove_asset is the completion step and stays direct
      await env.program.methods
        .finalizeRemoveAsset()
        .accountsStrict({ authority: auth(), fund: env.fund, asset: added.asset, vault: added.vault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      expect(await env.connection.getAccountInfo(added.asset)).to.eq(null);
    });

    it("lowering the timelock itself is timelocked; once 0 the direct setters work again", async () => {
      const q = await env.queueAction(ActionKind.SetTimelock, PublicKey.default, [0]);
      await expectAnchorError(env.executeAction(q.action, user), "TimelockNotElapsed");
      await waitSlots(env.connection, TL + 1);
      await env.executeAction(q.action, user);
      expect(big((await env.fetchFund()).timelockSlots)).to.eq(0n);
      await env.program.methods.setFees(MINT_FEE_BPS, REDEEM_FEE_BPS, MGMT_FEE_BPS).accountsStrict({ authority: auth(), fund: env.fund }).rpc();
      await env.setRefPrice(env.assets[2], Q64);
      const fund = await env.fetchFund();
      expect([fund.mintFeeBps, fund.redeemFeeBps, fund.mgmtFeeBps]).to.deep.eq([MINT_FEE_BPS, REDEEM_FEE_BPS, MGMT_FEE_BPS]);
    });
  });

  after(() => {
    console.log(`\n    program: ${PROGRAM_ID.toBase58()}\n    fund:    ${env.fund.toBase58()}\n    mint:    ${env.indexMint.toBase58()}`);
  });
});

// ---------------------------------------------------------------------------
// Token-2022 fee-on-transfer constituent: the vault is credited with what it RECEIVES.
// ---------------------------------------------------------------------------

describe("fi6900 program: Token-2022 fee-on-transfer constituent", function () {
  this.timeout(600_000);

  const env = new TestEnv();
  const user = Keypair.generate();
  const filler = Keypair.generate();
  const FEE_BPS = 300; // 3 %
  const MAX_FEE = 10n ** 15n; // effectively uncapped
  const fee = (gross: bigint) => transferFeeFor(gross, FEE_BPS, MAX_FEE);
  const gross = (net: bigint) => grossForNet(net, FEE_BPS, MAX_FEE);
  let plain: AssetInfo; // ordinary SPL asset
  let taxed: AssetInfo; // Token-2022 with TransferFeeConfig
  let nonceCounter = 1_000n;
  const nextNonce = () => nonceCounter++;

  async function pendings(a: AssetInfo): Promise<{ deposits: bigint; withdrawals: bigint; vault: bigint; effective: bigint }> {
    const acc = await env.fetchAsset(a.asset);
    const vault = await env.tokenBalance(a.vault, a.tokenProgram);
    const deposits = big(acc.pendingDeposits);
    const withdrawals = big(acc.pendingWithdrawals);
    return { deposits, withdrawals, vault, effective: vault - deposits - withdrawals };
  }

  before(async () => {
    await env.airdrop(env.authority.publicKey, 200);
    await env.airdrop(user.publicKey, 50);
    await env.airdrop(filler.publicKey, 50);
    await env.createIndexMint();
    await env.initializeFund(MINT_FEE_BPS, REDEEM_FEE_BPS, MGMT_FEE_BPS);

    const plainMint = await env.createAssetMint(6, TOKEN_PROGRAM_ID);
    const taxedMint = await env.createTransferFeeMint(6, FEE_BPS, MAX_FEE);
    plain = await env.addAsset(plainMint, 6, TOKEN_PROGRAM_ID, 5000);
    taxed = await env.addAsset(taxedMint, 6, TOKEN_2022_PROGRAM_ID, 5000);
    for (const who of [env.authority.publicKey, user.publicKey, filler.publicKey]) {
      await env.mintTokens(plainMint, who, 10_000_000n * 10n ** 6n, TOKEN_PROGRAM_ID);
      await env.mintTokens(taxedMint, who, 10_000_000n * 10n ** 6n, TOKEN_2022_PROGRAM_ID);
    }
    await env.seedVault(plain, 1_000_000n * 10n ** 6n);
    await env.seedVault(taxed, 1_000_000n * 10n ** 6n); // the vault receives 3 % less: bootstrap works off the received balance
    await env.bootstrapMint(1_000_000n * UNIT);
    await env.setRefPrices([plain, taxed], Q64);
  });

  it("seeding a fee vault credits the net amount; grossForNet is minimal", async () => {
    const seeded = 1_000_000n * 10n ** 6n;
    expect(await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)).to.eq(seeded - fee(seeded));
    for (const net of [1n, 7n, 9_999n, 10_000n, 123_456_789n, 10n ** 12n + 1n]) {
      const g = gross(net);
      expect(g - fee(g) >= net).to.eq(true);
      expect(g - 1n - fee(g - 1n) < net).to.eq(true);
    }
    expect(grossForNet(10_000n, 300, MAX_FEE)).to.eq(10_310n);
    expect(grossForNet(10_000n, 300, 100n)).to.eq(10_100n); // capped fee
    expect(grossForNet(10_000n, 0, MAX_FEE)).to.eq(10_000n);
  });

  describe("in-kind creation", () => {
    const units = 10_000n * UNIT;
    let nonce: bigint;
    let required: bigint;
    let received: bigint;
    let supplyBefore: bigint;
    let taxedVaultBefore: bigint;

    it("deposit with gross == required (net short) fails with ShortDeposit", async () => {
      supplyBefore = await env.supply();
      taxedVaultBefore = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      nonce = nextNonce();
      await env.beginMint(user, units, nonce);
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      required = big(session.required[taxed.slot]);
      expect(required).to.eq(mulDivCeil(taxedVaultBefore, units, supplyBefore));
      await expectAnchorError(env.deposit(user, nonce, taxed), "ShortDeposit"); // default gross = required
      await expectAnchorError(env.deposit(user, nonce, taxed, required - 1n), "ShortDeposit"); // gross < required
      await expectAnchorError(env.deposit(user, nonce, taxed, gross(required) - 1n), "ShortDeposit"); // one unit short after the fee
      expect((await pendings(taxed)).deposits).to.eq(0n);
      expect(bitmapBig((await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce))).depositedBitmap)).to.eq(0n);
    });

    it("deposit with the computed gross credits exactly what the vault received", async () => {
      const g = gross(required);
      const userAta = getAssociatedTokenAddressSync(taxed.mint, user.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const userBefore = await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID);
      await env.deposit(user, nonce, taxed, g);
      const vaultAfter = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      received = vaultAfter - taxedVaultBefore;
      expect(received).to.eq(g - fee(g));
      expect(received >= required).to.eq(true);
      expect(await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID)).to.eq(userBefore - g); // owner pays gross
      const p = await pendings(taxed);
      expect(p.deposits).to.eq(received); // credited with the received amount, not the instructed one
      expect(p.effective).to.eq(taxedVaultBefore); // live NAV untouched until finalize
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, nonce));
      expect(big(session.required[taxed.slot])).to.eq(received); // overwritten with received
      // the plain asset still accepts the default (gross == required)
      await env.deposit(user, nonce, plain);
    });

    it("finalize_mint releases exactly the received amount and keeps ratios non-dilutive", async () => {
      await env.finalizeMint(user, nonce);
      const p = await pendings(taxed);
      expect(p.deposits).to.eq(0n);
      expect(p.vault).to.eq(taxedVaultBefore + received);
      const supplyAfter = await env.supply();
      expect(supplyAfter).to.eq(supplyBefore + units);
      expect(p.vault * supplyBefore >= taxedVaultBefore * supplyAfter).to.eq(true);
      expect((await pendings(plain)).deposits).to.eq(0n);
    });

    it("cancel_mint_refund returns the received amount (gross from the vault) and clears pending_deposits", async () => {
      const n = nextNonce();
      await env.beginMint(user, 500n * UNIT, n);
      const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, n));
      const req = big(session.required[taxed.slot]);
      const g = gross(req);
      const vaultBefore = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      await env.deposit(user, n, taxed, g);
      const rec = (await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)) - vaultBefore;
      expect((await pendings(taxed)).deposits).to.eq(rec);
      const userAta = getAssociatedTokenAddressSync(taxed.mint, user.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const userBefore = await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID);
      await env.cancelMintRefund(user, n, taxed);
      expect(await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)).to.eq(vaultBefore); // vault debited exactly `rec`
      expect((await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID)) - userBefore).to.eq(rec - fee(rec)); // user gets net
      expect((await pendings(taxed)).deposits).to.eq(0n);
      await env.cancelMintClose(user, n);
    });
  });

  describe("in-kind redemption", () => {
    const units = 4_000n * UNIT;
    let nonce: bigint;

    it("withdraw debits the vault by entitled (gross); the user receives net", async () => {
      const supplyBefore = await env.supply();
      const vaultBefore = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      nonce = nextNonce();
      await env.beginRedeem(user, units, nonce);
      const session = await env.program.account.redeemSession.fetch(env.redeemSessionPda(user.publicKey, nonce));
      const net = units - (units * BigInt(REDEEM_FEE_BPS)) / 10_000n;
      const entitled = big(session.entitled[taxed.slot]);
      expect(entitled).to.eq(mulDivFloor(vaultBefore, net, supplyBefore));
      expect((await pendings(taxed)).withdrawals).to.eq(entitled);
      const userAta = getAssociatedTokenAddressSync(taxed.mint, user.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const userBefore = await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID);
      await env.withdraw(user, nonce, taxed);
      expect(await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)).to.eq(vaultBefore - entitled);
      expect((await env.tokenBalance(userAta, TOKEN_2022_PROGRAM_ID)) - userBefore).to.eq(entitled - fee(entitled));
      const p = await pendings(taxed);
      expect(p.withdrawals).to.eq(0n);
      expect(p.deposits).to.eq(0n);
      await env.withdraw(user, nonce, plain);
      await env.closeRedeem(user, nonce);
      const supplyAfter = await env.supply();
      expect(p.vault * supplyBefore >= vaultBefore * supplyAfter).to.eq(true);
    });
  });

  describe("dutch auctions", () => {
    const sellAmount = 1_000n * 10n ** 6n;

    it("buying the fee token: under-paid fill fails with ShortFill; a gross fill credits what arrived", async () => {
      // flat price 1.0 so buy_amount == sell_amount at every slot
      const r = await env.startAuction(plain, taxed, sellAmount, Q64, Q64, 100);
      const buyAmount = buyAmountFor(sellAmount, Q64);
      expect(buyAmount).to.eq(sellAmount);
      await expectAnchorError(env.fillAuction(filler, r.auction, plain, taxed, sellAmount), "ShortFill"); // default gross = buy_amount
      await expectAnchorError(env.fillAuction(filler, r.auction, plain, taxed, sellAmount, buyAmount - 1n), "ShortFill");
      await expectAnchorError(env.fillAuction(filler, r.auction, plain, taxed, sellAmount, gross(buyAmount) - 1n), "ShortFill");
      expect((await env.program.account.auction.fetch(r.auction)).status).to.eq(0);
      expect(big((await env.program.account.auction.fetch(r.auction)).sellRemaining)).to.eq(sellAmount);

      const g = gross(buyAmount);
      const buyVaultBefore = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      const sellVaultBefore = await env.tokenBalance(plain.vault, TOKEN_PROGRAM_ID);
      const fillerBuyAta = getAssociatedTokenAddressSync(taxed.mint, filler.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const fillerBuyBefore = await env.tokenBalance(fillerBuyAta, TOKEN_2022_PROGRAM_ID);
      const sig = await env.fillAuction(filler, r.auction, plain, taxed, sellAmount, g);
      const received = (await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)) - buyVaultBefore;
      expect(received).to.eq(g - fee(g));
      expect(received >= buyAmount).to.eq(true);
      expect(fillerBuyBefore - (await env.tokenBalance(fillerBuyAta, TOKEN_2022_PROGRAM_ID))).to.eq(g); // filler bears the fee
      expect(await env.tokenBalance(plain.vault, TOKEN_PROGRAM_ID)).to.eq(sellVaultBefore - sellAmount);
      const a = await env.program.account.auction.fetch(r.auction);
      expect(big(a.boughtTotal)).to.eq(received);
      expect(a.status).to.eq(1);
      const ev = (await env.events(sig)).find((e) => e.name === "auctionFilled")!;
      expect(big(ev.data.buyAmount)).to.eq(received);
      expect(big(ev.data.sellAmount)).to.eq(sellAmount);
      expect((await pendings(taxed)).effective).to.eq(buyVaultBefore + received);
    });

    it("selling the fee token: the vault is debited exactly sell_amount and the filler receives net", async () => {
      const r = await env.startAuction(taxed, plain, sellAmount, Q64, Q64, 100);
      const sellVaultBefore = await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID);
      const buyVaultBefore = await env.tokenBalance(plain.vault, TOKEN_PROGRAM_ID);
      await env.ensureAta(filler.publicKey, taxed.mint, TOKEN_2022_PROGRAM_ID);
      const fillerSellAta = getAssociatedTokenAddressSync(taxed.mint, filler.publicKey, true, TOKEN_2022_PROGRAM_ID);
      const fillerSellBefore = await env.tokenBalance(fillerSellAta, TOKEN_2022_PROGRAM_ID);
      await env.fillAuction(filler, r.auction, taxed, plain, sellAmount); // plain buy token: default gross is exact
      expect(await env.tokenBalance(taxed.vault, TOKEN_2022_PROGRAM_ID)).to.eq(sellVaultBefore - sellAmount);
      expect((await env.tokenBalance(fillerSellAta, TOKEN_2022_PROGRAM_ID)) - fillerSellBefore).to.eq(sellAmount - fee(sellAmount));
      expect(await env.tokenBalance(plain.vault, TOKEN_PROGRAM_ID)).to.eq(buyVaultBefore + sellAmount);
      expect((await env.program.account.auction.fetch(r.auction)).status).to.eq(1);
    });
  });

  describe("invariants", () => {
  it("effective balances never underflow and every reservation is released", async () => {
    for (const a of [plain, taxed]) {
      const p = await pendings(a);
      expect(p.deposits).to.eq(0n);
      expect(p.withdrawals).to.eq(0n);
      expect(p.effective).to.eq(p.vault);
      expect(p.vault > 0n).to.eq(true);
    }
    // a full round trip through the fee asset still works after the auctions (fresh epoch)
    const n = nextNonce();
    const units = 100n * UNIT;
    const supplyBefore = await env.supply();
    await env.beginMint(user, units, n);
    const session = await env.program.account.mintSession.fetch(env.mintSessionPda(user.publicKey, n));
    await env.deposit(user, n, taxed, gross(big(session.required[taxed.slot])));
    await env.deposit(user, n, plain);
    await env.finalizeMint(user, n);
    expect(await env.supply()).to.eq(supplyBefore + units);
    expect((await pendings(taxed)).deposits).to.eq(0n);
  });
  });
});
