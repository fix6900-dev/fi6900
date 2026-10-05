import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { decodeMint, decodeMintExtensions } from '../src/chain/accounts.js';
import { evaluateEligibility } from '../src/methodology/eligibility.js';
import { DEFAULT_METHODOLOGY_CONFIG } from '../src/config/methodology.config.js';
import type { CandidateToken } from '../src/methodology/types.js';

// Real mainnet mint accounts captured 2026-10-05 (base64).
const ZCAT = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9rNlUWLUaw0JAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEAbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAtXK96l8U0l2WOVhsmI9Djj1NA8git1QpO9FQLCssuAAAAAAAAAAABBAAAAAAAAAAAZKeztuANLAEBBAAAAAAAAAAAZKeztuANLAESAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2zdaXB3TWd0BklMZG9+cKOseYaKAmAPNDp23JXokhVhMApgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbN1pcHdNZ3QGSUxkb35wo6x5hooCYA80OnbcleiSFWDQAAAEFub255bW91cyBDYXQEAAAAWkNBVEUAAABodHRwczovL2dhdGV3YXkuaXJ5cy54eXovR055NmQ5ZGhoRXV4RkJxS2I4RWdtNWJlaVJNTDRmRFVTNnp1S1F1VHM3WXMAAAAA'; // Token-2022, TransferFeeConfig 300 bps
const CATE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJzu8nuNsAwAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARIAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJA/wMON7OVKMYfL8ynktw4j759KPmLd4QpahiiHGEc/EwCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAkD/Aw43s5Uoxh8vzKeS3DiPvn0o+Yt3hClqGKIcYRz8IAAAAQ2F0ZWNvaW4EAAAAQ0FURSQAAABodHRwczovL20ucmFwaWRsYXVuY2guaW8vbS9Uc2c0STlXSEMAAAAA'; // Token-2022, metadata only
const WIF = 'AAAAAA4EesA+DPAMJ/KLCHOzM3gAvuvhNFFzXHWwlBt0+H3quzbU9W+MAwAGAQAAAAAOBHrAPgzwDCfyiwhzszN4AL7r4TRRc1x1sJQbdPh96g=='; // plain SPL
const T22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const SPL = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const base = (over: Partial<CandidateToken>): CandidateToken => ({
  mint: 'm', symbol: 'X', name: 'X', decimals: 6, priceUsd: 1, fdvUsd: 1e8, marketCapUsd: 1e8, volume24hUsd: 1e7, avgVolume7dUsd: 1e7,
  firstTradeAt: Date.now() - 400 * 86_400_000, mintAuthority: null, freezeAuthority: null, sellImpactBps: 50, tags: ['meme'], ...over,
});

describe('Token-2022 extension decoding', () => {
  it('reads a 3% transfer fee from ZCAT', () => {
    const info = decodeMint('zcat', Buffer.from(ZCAT, 'base64'), T22);
    expect(info.transferFeeBps).toBe(300);
    expect(info.transferFeeMaxFee).toBeTypeOf('bigint');
    expect(info.transferFeeMaxFee > 0n).toBe(true);
    expect(info.transferHookProgram).toBeNull();
    expect(info.decimals).toBe(9);
  });
  it('finds no fee or hook on a metadata-only Token-2022 mint (CATE)', () => {
    const info = decodeMint('cate', Buffer.from(CATE, 'base64'), T22);
    expect(info.transferFeeBps).toBe(0);
    expect(info.transferHookProgram).toBeNull();
  });
  it('plain SPL mints have no extensions', () => {
    expect(decodeMintExtensions(Buffer.from(WIF, 'base64'))).toEqual({ transferFeeBps: 0, transferFeeMaxFee: 0n, transferHookProgram: null });
    expect(decodeMint('wif', Buffer.from(WIF, 'base64'), SPL).transferFeeBps).toBe(0);
  });
});

describe('eligibility rule 2.7', () => {
  const cfg = DEFAULT_METHODOLOGY_CONFIG;
  it('rejects transfer-fee tokens', () => {
    const r = evaluateEligibility(base({ transferFeeBps: 300 }), cfg, Date.now());
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain('transfer_fee');
  });
  it('rejects transfer-hook tokens', () => {
    const r = evaluateEligibility(base({ transferHookProgram: 'Hook111' }), cfg, Date.now());
    expect(r.reasons).toContain('transfer_hook');
  });
  it('accepts metadata-only Token-2022', () => {
    const r = evaluateEligibility(base({ transferFeeBps: 0, transferHookProgram: null }), cfg, Date.now());
    expect(r.eligible).toBe(true);
  });
});
