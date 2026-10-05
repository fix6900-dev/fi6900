/**
 * Demo fixtures used when the keeper API is unreachable.
 * Everything here is clearly labelled "demo data" in the UI.
 */
import type {
  Airdrop, Announcement, Auction, Flywheel, FlywheelEvent, Fund, HistoryPoint, HistoryRange, Holding, Methodology, QuoteCreate, QuoteRedeem, Verify,
} from "./schemas";
import { hash32, rng } from "./utils";

export const MOCK_PROGRAM_ID = "Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV";
export const MOCK_FUND_PDA = "Fundv3hR1kGdzRpj7xyXh6D2wUBtG6k2V8yqeQYz1T1E";
export const MOCK_INDEX_MINT = "FI69ooXeEu7Zk8GZxkLpz5mdcTnBW3AyQ6pSAx4Ju5bk";
export const MOCK_COIN_MINT = "FIcoinAq2rHjzPJpk5kB7eyQZ9U7pD1NwT4uGhR8pump";
export const MOCK_LOOKUP_TABLE = "ALTfi69KxF5mRkLZ8o1X2pQyUeFJ3cW7G9hTbn4VsD2M";

type Seed = { symbol: string; name: string; mint: string; price: number; mcap: number; chg: number };

// Real Solana memecoin symbols. Mints starting with "~" are placeholders generated for the demo.
const SEEDS: Seed[] = [
  { symbol: "WIF", name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", price: 0.842, mcap: 841_000_000, chg: 3.4 },
  { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", price: 0.00001842, mcap: 1_420_000_000, chg: -1.2 },
  { symbol: "POPCAT", name: "Popcat", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", price: 0.312, mcap: 305_000_000, chg: 6.1 },
  { symbol: "PENGU", name: "Pudgy Penguins", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", price: 0.0291, mcap: 1_830_000_000, chg: 2.2 },
  { symbol: "FARTCOIN", name: "Fartcoin", mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", price: 0.912, mcap: 912_000_000, chg: -4.8 },
  { symbol: "TRUMP", name: "OFFICIAL TRUMP", mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", price: 7.84, mcap: 1_570_000_000, chg: 0.6 },
  { symbol: "PNUT", name: "Peanut the Squirrel", mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump", price: 0.218, mcap: 218_000_000, chg: -2.7 },
  { symbol: "GOAT", name: "Goatseus Maximus", mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump", price: 0.114, mcap: 114_000_000, chg: 8.9 },
  { symbol: "MOODENG", name: "Moo Deng", mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY", price: 0.172, mcap: 171_000_000, chg: 12.4 },
  { symbol: "AI16Z", name: "ai16z", mint: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC", price: 0.182, mcap: 200_000_000, chg: -6.3 },
  { symbol: "GIGA", name: "Gigachad", mint: "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9", price: 0.0244, mcap: 231_000_000, chg: 1.8 },
  { symbol: "MEW", name: "cat in a dogs world", mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", price: 0.00312, mcap: 277_000_000, chg: -0.9 },
  { symbol: "BOME", name: "BOOK OF MEME", mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", price: 0.00184, mcap: 127_000_000, chg: -3.1 },
  { symbol: "SPX", name: "SPX6900", mint: "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr", price: 1.21, mcap: 1_130_000_000, chg: 4.4 },
  { symbol: "ACT", name: "Act I: The AI Prophecy", mint: "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump", price: 0.0612, mcap: 58_000_000, chg: -5.5 },
  { symbol: "CHILLGUY", name: "Just a chill guy", mint: "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump", price: 0.0518, mcap: 52_000_000, chg: 2.9 },
  { symbol: "MICHI", name: "michi", mint: "5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp", price: 0.0921, mcap: 51_000_000, chg: 1.1 },
  { symbol: "RETARDIO", name: "retardio", mint: "6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx", price: 0.0384, mcap: 38_000_000, chg: -7.9 },
  { symbol: "USELESS", name: "USELESS COIN", mint: "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", price: 0.241, mcap: 241_000_000, chg: 15.2 },
  { symbol: "TITCOIN", name: "titcoin", mint: "~titcoin", price: 0.0712, mcap: 71_000_000, chg: -2.2 },
  { symbol: "PUMP", name: "Pump", mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", price: 0.00388, mcap: 1_370_000_000, chg: -1.6 },
  { symbol: "HOUSE", name: "Housecoin", mint: "~house", price: 0.0291, mcap: 29_000_000, chg: 5.8 },
  { symbol: "GORK", name: "gork", mint: "~gork", price: 0.0134, mcap: 13_400_000, chg: -9.4 },
  { symbol: "ALCH", name: "Alchemist AI", mint: "~alch", price: 0.312, mcap: 44_000_000, chg: 3.3 },
  { symbol: "WEN", name: "Wen", mint: "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk", price: 0.0000412, mcap: 29_500_000, chg: -0.4 },
  { symbol: "SLERF", name: "SLERF", mint: "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3", price: 0.0812, mcap: 40_600_000, chg: 2.4 },
  { symbol: "MYRO", name: "Myro", mint: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4", price: 0.0204, mcap: 20_200_000, chg: -3.6 },
  { symbol: "SILLY", name: "Silly Dragon", mint: "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs", price: 0.0092, mcap: 9_200_000, chg: 1.3 },
  { symbol: "PONKE", name: "PONKE", mint: "5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC", price: 0.112, mcap: 61_000_000, chg: -1.1 },
  { symbol: "MANEKI", name: "MANEKI", mint: "25hAyBQfoDhfWx9ay6rarbgvWGwDdNqcHsXS3jQ3mTDJ", price: 0.00312, mcap: 27_000_000, chg: 0.7 },
  { symbol: "ZEREBRO", name: "zerebro", mint: "~zerebro", price: 0.0218, mcap: 21_800_000, chg: -8.1 },
  { symbol: "FWOG", name: "FWOG", mint: "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump", price: 0.0184, mcap: 18_400_000, chg: 4.9 },
  { symbol: "PIPPIN", name: "pippin", mint: "~pippin", price: 0.0342, mcap: 34_000_000, chg: 7.2 },
  { symbol: "GRIFFAIN", name: "griffain", mint: "~griffain", price: 0.0291, mcap: 29_000_000, chg: -4.2 },
  { symbol: "ARC", name: "AI Rig Complex", mint: "~arc", price: 0.0384, mcap: 38_000_000, chg: 2.1 },
  { symbol: "SIGMA", name: "sigma", mint: "~sigma", price: 0.0142, mcap: 14_200_000, chg: -2.8 },
  { symbol: "NEIRO", name: "Neiro", mint: "~neiro", price: 0.0011, mcap: 11_000_000, chg: 0.3 },
  { symbol: "MOTHER", name: "Mother Iggy", mint: "3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN", price: 0.0122, mcap: 12_200_000, chg: -6.0 },
  { symbol: "LOCKIN", name: "lock in", mint: "~lockin", price: 0.0244, mcap: 24_400_000, chg: 9.6 },
  { symbol: "BILLY", name: "Billy", mint: "~billy", price: 0.0072, mcap: 7_200_000, chg: -1.9 },
];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function fakeKey(seed: string, len = 44): string {
  const r = rng(hash32(seed));
  let out = "";
  for (let i = 0; i < len; i++) out += B58[Math.floor(r() * B58.length)];
  return out;
}
function mintFor(s: Seed): string {
  return s.mint.startsWith("~") ? fakeKey("mint:" + s.mint) : s.mint;
}

export const MOCK_SUPPLY_UI = 1_912_400; // index units
const TARGET_BPS = Math.floor(10_000 / SEEDS.length); // equal weight 250 bps

export function mockHoldings(): Holding[] {
  const r = rng(hash32("holdings"));
  const totalUsd = 2_455_000;
  const per = totalUsd / SEEDS.length;
  const raw = SEEDS.map((s, i) => {
    const drift = (r() - 0.5) * 0.09; // ±4.5% relative
    const value = per * (1 + drift) * (1 + (s.chg / 100) * 0.35);
    return { s, i, value };
  });
  const sum = raw.reduce((a, b) => a + b.value, 0);
  return raw.map(({ s, i, value }) => {
    const decimals = s.price < 0.001 ? 5 : s.price < 1 ? 6 : 9;
    const balanceUi = value / s.price;
    const weightBps = Math.round((value / sum) * 10_000);
    const mint = mintFor(s);
    const logo = s.mint.startsWith("~") ? "" : `https://dd.dexscreener.com/ds-data/tokens/solana/${s.mint}.png`;
    const vault = fakeKey("vault:" + mint);
    const h: Holding = {
      slot: i,
      mint,
      symbol: s.symbol,
      name: s.name,
      logo,
      decimals,
      balance: BigInt(Math.round(balanceUi * 10 ** decimals)).toString(),
      balanceUi,
      priceUsd: s.price,
      valueUsd: value,
      weightBps,
      targetWeightBps: TARGET_BPS,
      driftBps: weightBps - TARGET_BPS,
      change24hPct: s.chg,
      marketCapUsd: s.mcap,
      status: i === 37 ? "removing" : "active",
      vault,
      verifyUrl: `https://solscan.io/account/${vault}`,
    };
    return h;
  });
}

export function mockFund(holdings = mockHoldings()): Fund {
  const navUsd = holdings.reduce((a, h) => a + h.valueUsd, 0);
  const navPerUnit = navUsd / MOCK_SUPPLY_UI;
  const premiumBps = 38;
  return {
    indexMint: MOCK_INDEX_MINT,
    fundPda: MOCK_FUND_PDA,
    supply: BigInt(Math.round(MOCK_SUPPLY_UI * 1e6)).toString(),
    navUsd,
    navPerUnitUsd: navPerUnit,
    indexLevel: 1284.52,
    marketPriceUsd: navPerUnit * (1 + premiumBps / 10_000),
    premiumBps,
    fees: { mintBps: 50, redeemBps: 50, mgmtBps: 100 },
    assetCount: holdings.length,
    epoch: 1427,
    openAuctions: 2,
    paused: 0,
  };
}

export function mockHistory(range: HistoryRange, now = Date.now()): HistoryPoint[] {
  const spans: Record<HistoryRange, [number, number]> = {
    "1d": [24 * 3600e3, 5 * 60e3],
    "7d": [7 * 86400e3, 30 * 60e3],
    "30d": [30 * 86400e3, 2 * 3600e3],
    all: [142 * 86400e3, 8 * 3600e3],
  };
  const [span, step] = spans[range];
  const r = rng(hash32("history:" + range));
  const n = Math.floor(span / step);
  const target = 1284.52;
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (r() - 0.49) * 0.018 * Math.sqrt(step / 3600e3);
    cum.push(acc);
  }
  const final = acc;
  const out: HistoryPoint[] = [];
  const navAtTarget = mockFund().navPerUnitUsd;
  const resetEvery = Math.max(2, Math.floor(n / 6));
  for (let i = 0; i < n; i++) {
    const t = now - span + i * step;
    const level = target * Math.exp(cum[i] - final);
    const nav = navAtTarget * (level / target);
    const prem = 0.0038 + Math.sin(i / 7) * 0.006 + (r() - 0.5) * 0.004;
    const isReset = range !== "1d" && i % resetEvery === Math.floor(resetEvery / 2);
    out.push({ t, navPerUnitUsd: nav, indexLevel: level, marketPriceUsd: nav * (1 + prem), supply: String(MOCK_SUPPLY_UI * 1e6), divisorReset: isReset || undefined });
  }
  return out;
}

export function mockSlot(now = Date.now()): number {
  return 312_457_900 + Math.floor((now / 400) % 10_000_000);
}

export function mockAuctions(now = Date.now()): Auction[] {
  const h = mockHoldings();
  const bySym = (s: string) => h.find((x) => x.symbol === s)!;
  const slot = mockSlot(now);
  const mk = (sell: string, buy: string, startSlotOff: number, dur: number, total: number, remainingFrac: number, status: Auction["status"], fills: number): Auction => {
    const s = bySym(sell);
    const b = bySym(buy);
    const mid = s.priceUsd / b.priceUsd; // buy tokens per sell token
    const startPrice = mid * 1.04;
    const endPrice = mid * 0.97;
    const startSlot = slot - startSlotOff;
    const endSlot = startSlot + dur;
    const elapsed = Math.min(Math.max(slot - startSlot, 0), dur);
    const currentPrice = startPrice - (startPrice - endPrice) * (elapsed / dur);
    const totalRaw = BigInt(Math.round(total * 10 ** s.decimals));
    const remRaw = BigInt(Math.round(total * remainingFrac * 10 ** s.decimals));
    const fillsArr = Array.from({ length: fills }, (_, i) => {
      const fslot = startSlot + Math.floor((dur * (i + 1)) / (fills + 2));
      const p = startPrice - (startPrice - endPrice) * ((fslot - startSlot) / dur);
      const sellAmt = Math.round(((total * (1 - remainingFrac)) / fills) * 10 ** s.decimals);
      return {
        sig: fakeKey(`fill:${sell}:${buy}:${i}`, 88),
        filler: fakeKey(`filler:${i}`),
        sellAmount: String(sellAmt),
        buyAmount: String(Math.ceil(sellAmt * p * 10 ** (b.decimals - s.decimals))),
        price: p,
        slot: fslot,
      };
    });
    return {
      pda: fakeKey(`auction:${sell}:${buy}:${startSlotOff}`),
      sellMint: s.mint,
      buyMint: b.mint,
      sellSymbol: sell,
      buySymbol: buy,
      sellDecimals: s.decimals,
      buyDecimals: b.decimals,
      sellRemaining: remRaw.toString(),
      sellTotal: totalRaw.toString(),
      startPrice,
      endPrice,
      currentPrice,
      startSlot,
      endSlot,
      status,
      fills: fillsArr,
      jupiterMidPrice: mid,
      currentSlot: slot,
    };
  };
  return [
    mk("MOODENG", "RETARDIO", 1800, 4500, 28_400, 0.62, "open", 2),
    mk("USELESS", "AI16Z", 600, 4500, 19_800, 0.91, "open", 1),
    mk("GOAT", "ACT", 9000, 4500, 41_200, 0, "filled", 4),
    mk("SPX", "BOME", 21_000, 4500, 2_650, 0, "filled", 3),
    mk("WIF", "GORK", 40_000, 4500, 6_100, 0.3, "expired", 1),
  ];
}

export function mockFlywheel(now = Date.now()): Flywheel {
  const next = new Date(Math.ceil(now / (15 * 60e3)) * 15 * 60e3);
  const reb = new Date(now + 2 * 86400e3 + 5 * 3600e3 + 12 * 60e3);
  return {
    coinMint: MOCK_COIN_MINT,
    creatorFeesClaimedSol: 4_812.44,
    lpAddedSol: 2_381.17,
    airdroppedUnits: 118_420.5,
    airdropRounds: 1_312,
    buybackSol: 611.08,
    burnedCoin: 48_212_911,
    treasurySol: 203.69,
    next: { airdropAt: next.toISOString(), rebalanceCheckAt: reb.toISOString() },
  };
}

const EVENT_KINDS: FlywheelEvent["kind"][] = ["claim", "buy_index", "add_lp", "airdrop", "buyback", "burn", "create", "redeem", "auction_start", "auction_fill", "fee_accrual"];

export function mockEvent(i: number, ts: number, seed = "events"): FlywheelEvent {
  const r = rng(hash32(`${seed}:${i}`));
  const kind = EVENT_KINDS[Math.floor(r() * EVENT_KINDS.length)];
  const amounts: Record<string, number | string> = {};
  let note = "";
  switch (kind) {
    case "claim": amounts.sol = +(r() * 6 + 0.4).toFixed(3); note = "Creator fee claim (pump + PumpSwap)"; break;
    case "buy_index": amounts.sol = +(r() * 3).toFixed(3); amounts.units = +(r() * 2400).toFixed(2); note = "Bought $FI6900 on Jupiter"; break;
    case "add_lp": amounts.sol = +(r() * 3).toFixed(3); amounts.units = +(r() * 2400).toFixed(2); note = "Added FI6900/SOL liquidity (Meteora)"; break;
    case "airdrop": amounts.units = +(r() * 900 + 20).toFixed(2); amounts.wallets = Math.floor(r() * 400 + 18); note = "Pro-rata airdrop to $FI holders"; break;
    case "buyback": amounts.sol = +(r() * 2).toFixed(3); amounts.coin = Math.floor(r() * 900_000); note = "Bought $FI with fee proceeds"; break;
    case "burn": amounts.coin = Math.floor(r() * 900_000); note = "SPL burn of $FI"; break;
    case "create": amounts.units = +(r() * 5000).toFixed(2); note = "AP in-kind creation finalized"; break;
    case "redeem": amounts.units = +(r() * 3000).toFixed(2); note = "AP in-kind redemption"; break;
    case "auction_start": amounts.sellAmount = Math.floor(r() * 30_000); note = "Rebalance auction opened"; break;
    case "auction_fill": amounts.sellAmount = Math.floor(r() * 9_000); amounts.buyAmount = Math.floor(r() * 90_000); note = "Dutch auction fill"; break;
    case "fee_accrual": amounts.units = +(r() * 12).toFixed(4); note = "Management fee accrued"; break;
  }
  return { id: String(90_000 + i), kind, ts: new Date(ts).toISOString(), sig: fakeKey(`evsig:${seed}:${i}`, 88), amounts, note };
}

export function mockEvents(limit = 50, now = Date.now()): FlywheelEvent[] {
  const r = rng(hash32("events:gaps"));
  const out: FlywheelEvent[] = [];
  let t = now - 40e3;
  for (let i = 0; i < limit; i++) {
    out.push(mockEvent(-i, t));
    t -= Math.floor(r() * 9 + 1) * 60e3;
  }
  return out;
}

export function mockAirdrops(wallet: string, now = Date.now()): Airdrop[] {
  const r = rng(hash32("air:" + wallet));
  if (r() < 0.15) return [];
  const n = 4 + Math.floor(r() * 10);
  return Array.from({ length: n }, (_, i) => ({
    roundId: String(1_312 - i * 3),
    ts: new Date(now - (i * 3 + 1) * 15 * 60e3).toISOString(),
    units: +(r() * 4 + 0.02).toFixed(4),
    sig: fakeKey(`airsig:${wallet}:${i}`, 88),
  }));
}

export function mockMethodology(now = Date.now()): Methodology {
  const h = mockHoldings();
  const d = new Date(now);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return {
    config: {
      eligibility: {
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        minAgeDays: 14,
        minFdvUsd: 2_000_000,
        minVolume24hUsd: 250_000,
        minVolume7dAvgUsd: 100_000,
        maxPriceImpactPctFor10k: 2,
        excludeStableLstWrapped: true,
      },
      selection: { count: 40, bufferRank: 50 },
      weighting: { scheme: "equal", capBps: 1200, floorBps: 50 },
      rebalance: { intervalDays: 7, driftBandBps: 250, maxTradePctOfDailyVolume: 5 },
      reconstitution: { dayOfMonth: 1, hourUtc: 0, announceHoursAhead: 48 },
    },
    lastRun: {
      ts: new Date(now - 3 * 86400e3 - 4 * 3600e3).toISOString(),
      eligible: [
        ...h.map((x) => ({ mint: x.mint, symbol: x.symbol, marketCapUsd: x.marketCapUsd ?? 0 })),
        { mint: fakeKey("elig:1"), symbol: "JELLYJELLY", marketCapUsd: 6_400_000 },
        { mint: fakeKey("elig:2"), symbol: "DOGEBABA", marketCapUsd: 4_100_000 },
        { mint: fakeKey("elig:3"), symbol: "BUTTCOIN", marketCapUsd: 3_900_000 },
      ],
      selected: h.map((x) => ({ mint: x.mint, symbol: x.symbol, marketCapUsd: x.marketCapUsd ?? 0 })),
      weights: h.map((x) => ({ mint: x.mint, symbol: x.symbol, weightBps: x.targetWeightBps })),
    },
    nextReconstitution: next.toISOString(),
  };
}

export function mockAnnouncements(now = Date.now()): Announcement[] {
  return [
    {
      ts: new Date(now - 1 * 86400e3).toISOString(),
      title: "Monthly reconstitution: preliminary changes",
      body: "Based on the month-end snapshot, BILLY and NEIRO fall below the rank-50 buffer and are flagged for removal. JELLYJELLY and DOGEBABA are the leading candidates for addition. The final list is published 48h before the effective time (1st of the month, 00:00 UTC).",
    },
    {
      ts: new Date(now - 6 * 86400e3).toISOString(),
      title: "Weekly rebalance completed",
      body: "All constituents returned to the 2.50% target within the 2.5% drift band. 11 auctions filled, 0 expired. Total turnover 3.8% of AUM. The divisor was adjusted on each fill to keep the index level continuous.",
    },
    {
      ts: new Date(now - 13 * 86400e3).toISOString(),
      title: "Liquidity safety valve engaged on 2 names",
      body: "RETARDIO and SIGMA rebalance quantities exceeded 5% of 24h volume and were split across two cycles per the methodology.",
    },
  ];
}

export function mockVerify(): Verify {
  const h = mockHoldings();
  return {
    fundPda: MOCK_FUND_PDA,
    indexMint: MOCK_INDEX_MINT,
    mintAuthority: MOCK_FUND_PDA,
    vaults: h.map((x) => ({ mint: x.mint, vault: x.vault, owner: MOCK_FUND_PDA, amount: x.balance, symbol: x.symbol, decimals: x.decimals })),
    lookupTable: MOCK_LOOKUP_TABLE,
    programId: MOCK_PROGRAM_ID,
    idlHash: "sha256:7f3a9c1e0b4d58e2a6c1f0d9b2e4a7c8d5f6e3b1a0c9d8e7f6a5b4c3d2e1f0a9",
  };
}

export function mockQuoteCreate(units: number): QuoteCreate {
  const h = mockHoldings();
  const f = mockFund(h);
  const frac = units / MOCK_SUPPLY_UI;
  const basket = h
    .filter((x) => x.status === "active")
    .map((x) => ({ mint: x.mint, symbol: x.symbol, decimals: x.decimals, amount: BigInt(Math.ceil(x.balanceUi * frac * 10 ** x.decimals)).toString() }));
  const estNavUsd = f.navPerUnitUsd * units;
  return { basket, estCostSol: estNavUsd / 148.2, estNavUsd };
}

export function mockQuoteRedeem(units: number): QuoteRedeem {
  const h = mockHoldings();
  const f = mockFund(h);
  const net = units * (1 - f.fees.redeemBps / 10_000);
  const frac = net / MOCK_SUPPLY_UI;
  const basket = h.map((x) => ({ mint: x.mint, symbol: x.symbol, decimals: x.decimals, amount: BigInt(Math.floor(x.balanceUi * frac * 10 ** x.decimals)).toString() }));
  return { basket, estValueUsd: f.navPerUnitUsd * net };
}
