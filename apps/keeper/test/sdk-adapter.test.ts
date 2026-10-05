import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import type { AssetAccount, AuctionAccount, FundAccount } from '@fi6900/sdk';
import { adaptAsset, adaptAuction, adaptFund } from '../src/chain/sdk.js';
import { effectiveBalance } from '../src/chain/types.js';

const k = (): PublicKey => PublicKey.unique();

describe('SDK adapter decoding (typed @fi6900/sdk accounts -> keeper state)', () => {
  it('adapts FundAccount', () => {
    const f: FundAccount = {
      address: k(),
      authority: k(),
      pendingAuthority: PublicKey.default,
      rebalancer: k(),
      feeRecipient: k(),
      indexMint: k(),
      bump: 254,
      assetCount: 40,
      activeBitmap: (1n << 40n) - 1n,
      mintFeeBps: 50,
      redeemFeeBps: 50,
      mgmtFeeBps: 100,
      lastFeeAccrualTs: 1_700_000_000n,
      epoch: 7n,
      openAuctions: 2,
      paused: 0,
      auctionNonce: 12n,
      occupiedBitmap: (1n << 40n) - 1n,
    };
    const s = adaptFund(f);
    expect(s.pda).toBe(f.address.toBase58());
    expect(s.activeBitmap).toBe((1n << 40n) - 1n);
    expect(s.epoch).toBe(7n);
    expect(s.auctionNonce).toBe(12n);
    expect(s.lastFeeAccrualTs).toBe(1_700_000_000);
  });

  it('adapts AssetAccount with vault amount and status', () => {
    const a: AssetAccount = { address: k(), fund: k(), mint: k(), vault: k(), tokenProgram: k(), index: 3, status: 1, decimals: 9, targetWeightBps: 250, pendingDeposits: 100n, pendingWithdrawals: 50n, bump: 1 };
    const s = adaptAsset(a, 10_000n);
    expect(s.status).toBe('removing');
    expect(s.index).toBe(3);
    expect(effectiveBalance(s)).toBe(9_850n);
    expect(adaptAsset({ ...a, status: 0 }, 1n).status).toBe('active');
  });

  it('adapts AuctionAccount and resolves mints via asset PDAs', () => {
    const sellAsset = k();
    const buyAsset = k();
    const sellMint = k();
    const buyMint = k();
    const mk = (address: PublicKey, mint: PublicKey, index: number): AssetAccount => ({ address, fund: k(), mint, vault: k(), tokenProgram: k(), index, status: 0, decimals: 6, targetWeightBps: 1, pendingDeposits: 0n, pendingWithdrawals: 0n, bump: 0 });
    const assets = new Map([
      [sellAsset.toBase58(), adaptAsset(mk(sellAsset, sellMint, 0), 1n)],
      [buyAsset.toBase58(), adaptAsset(mk(buyAsset, buyMint, 1), 1n)],
    ]);
    const au: AuctionAccount = { address: k(), fund: k(), sellAsset, buyAsset, sellRemaining: 5n, sellTotal: 10n, startPrice: 2n << 64n, endPrice: 1n << 64n, startSlot: 1n, endSlot: 151n, boughtTotal: 0n, status: 0, nonce: 3n };
    const s = adaptAuction(au, assets);
    expect(s.sellMint).toBe(sellMint.toBase58());
    expect(s.buyMint).toBe(buyMint.toBase58());
    expect(s.startPrice).toBe(2n << 64n);
    expect(s.status).toBe('open');
    expect(adaptAuction({ ...au, status: 2 }, assets).status).toBe('cancelled');
    expect(adaptAuction({ ...au, status: 3 }, assets).status).toBe('expired');
  });
});
