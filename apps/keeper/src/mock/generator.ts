/** Deterministic, realistic fake fund state for frontend development (MOCK_MODE=true). */
import { Keypair, PublicKey } from '@solana/web3.js';
import { DEFAULT_METHODOLOGY_CONFIG, type MethodologyConfig } from '../config/methodology.config.js';
import { seededRandom, toQ64 } from '../util/math.js';
import { DAY, HOUR } from '../util/time.js';
import type { AuctionDto, FlywheelEventDto, FlywheelEventKind, HistoryPointDto, HoldingDto } from '../api/types.js';
import { MOCK_TOKENS } from './tokens.js';

export interface MockState {
  seed: number;
  cfg: MethodologyConfig;
  programId: string;
  indexMint: string;
  fundPda: string;
  coinMint: string;
  lookupTable: string;
  supply: bigint;
  epoch: bigint;
  divisor: number;
  solPriceUsd: number;
  tokens: MockHolding[];
  history: HistoryPointDto[];
  auctions: AuctionDto[];
  events: FlywheelEventDto[];
  airdropRounds: { roundId: number; ts: string; units: string; sig: string; wallets: string[] }[];
  announcements: { ts: string; title: string; body: string }[];
  currentSlot: bigint;
  startedAt: number;
}

export interface MockHolding {
  slot: number;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  openPriceUsd: number;
  balance: bigint;
  targetWeightBps: number;
  marketCapUsd: number;
  vault: string;
  status: 'active' | 'removing';
}

const fakeSig = (rnd: () => number): string => {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 88; i++) s += chars[Math.floor(rnd() * chars.length)];
  return s;
};

const fakeKey = (rnd: () => number): string => {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(rnd() * 256);
  return new PublicKey(bytes).toBase58();
};

export function createMockState(seed = 6900, now = Date.now()): MockState {
  const rnd = seededRandom(seed);
  const cfg = DEFAULT_METHODOLOGY_CONFIG;
  const programId = 'Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV';
  const indexMint = Keypair.generate().publicKey.toBase58();
  const fundPda = fakeKey(rnd);
  const coinMint = fakeKey(rnd).slice(0, 40) + 'pump';
  const lookupTable = fakeKey(rnd);

  // Fund of ~$1.2M NAV, equal weight target, with realistic drift.
  const navUsd = 1_200_000;
  const n = MOCK_TOKENS.length;
  const target = Math.floor(10_000 / n);
  const tokens: MockHolding[] = MOCK_TOKENS.map((t, i) => {
    const drift = 1 + (rnd() - 0.5) * 0.09; // +-4.5%
    const valueUsd = (navUsd / n) * drift;
    const balanceUi = valueUsd / t.priceUsd;
    return {
      slot: i,
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      priceUsd: t.priceUsd,
      openPriceUsd: t.priceUsd * (1 + (rnd() - 0.5) * 0.2),
      balance: BigInt(Math.round(balanceUi * 10 ** t.decimals)),
      targetWeightBps: i < 10_000 - target * n ? target + 1 : target,
      marketCapUsd: t.marketCapUsd,
      vault: fakeKey(rnd),
      status: 'active',
    };
  });

  const supply = BigInt(Math.round((navUsd / 1.0) * 1e6)); // NAV/unit ~ $1.00 at inception
  // 90 days of hourly history: random walk for NAV/unit; level follows the same path (base 1000).
  const points = 90 * 24;
  const history: HistoryPointDto[] = [];
  let navPerUnit = 0.74;
  let sup = Number(supply) * 0.6;
  for (let k = points; k >= 0; k--) {
    const t = new Date(now - k * HOUR).toISOString();
    navPerUnit *= Math.exp((rnd() - 0.5) * 0.03 + 0.00015);
    sup *= 1 + (rnd() - 0.47) * 0.004;
    const level = (navPerUnit / 0.74) * 1000;
    const premium = (rnd() - 0.5) * 0.02;
    history.push({ t, navPerUnitUsd: navPerUnit, indexLevel: level, marketPriceUsd: navPerUnit * (1 + premium), supply: String(Math.round(sup)) });
  }
  const last = history[history.length - 1];
  const mv = tokens.reduce((s, t) => s + (Number(t.balance) / 10 ** t.decimals) * t.priceUsd, 0);
  if (last) {
    // Pin the end of the walk to the live state (actual drifted market value / supply).
    const scale = mv / (Number(supply) / 1e6) / last.navPerUnitUsd;
    for (const h of history) {
      h.navPerUnitUsd *= scale;
      h.marketPriceUsd = h.marketPriceUsd === null ? null : h.marketPriceUsd * scale;
    }
  }
  const divisor = mv / (last?.indexLevel ?? 1000);

  // Two open auctions: largest overweight -> largest underweight.
  const currentSlot = 310_000_000n + BigInt(Math.floor(rnd() * 1_000_000));
  const byDrift = [...tokens]
    .map((t) => ({ t, w: ((Number(t.balance) / 10 ** t.decimals) * t.priceUsd) / mv - t.targetWeightBps / 10_000 }))
    .sort((a, b) => b.w - a.w);
  const auctions: AuctionDto[] = [];
  const mkAuction = (sell: MockHolding, buy: MockHolding, idx: number, status: AuctionDto['status'], ageSlots: bigint): AuctionDto => {
    const mid = (sell.priceUsd / buy.priceUsd) * 10 ** (buy.decimals - sell.decimals);
    const start = toQ64(mid * 1.03);
    const end = toQ64(mid * 0.96);
    const startSlot = currentSlot - ageSlots;
    const endSlot = startSlot + 150n;
    const total = sell.balance / 25n;
    const filled = status === 'open' ? total / 3n : total;
    const cur = status === 'open' ? start - ((start - end) * ageSlots) / 150n : end;
    const ui = (q: bigint): number => (Number(q) / 2 ** 64) * 10 ** (sell.decimals - buy.decimals);
    const fills = [] as AuctionDto['fills'];
    if (filled > 0n) {
      fills.push({ sig: fakeSig(rnd), filler: fakeKey(rnd), sellAmount: filled.toString(), buyAmount: ((filled * cur) >> 64n).toString(), price: cur.toString(), slot: Number(startSlot + 40n) });
    }
    return {
      pda: fakeKey(rnd),
      sellMint: sell.mint,
      buyMint: buy.mint,
      sellSymbol: sell.symbol,
      buySymbol: buy.symbol,
      sellDecimals: sell.decimals,
      buyDecimals: buy.decimals,
      sellRemaining: (total - filled).toString(),
      sellTotal: total.toString(),
      startPrice: start.toString(),
      endPrice: end.toString(),
      currentPrice: cur.toString(),
      startPriceUi: ui(start),
      endPriceUi: ui(end),
      currentPriceUi: ui(cur),
      startSlot: startSlot.toString(),
      endSlot: endSlot.toString(),
      currentSlot: currentSlot.toString(),
      status,
      fills,
    };
  };
  const o0 = byDrift[0]?.t;
  const o1 = byDrift[1]?.t;
  const u0 = byDrift[byDrift.length - 1]?.t;
  const u1 = byDrift[byDrift.length - 2]?.t;
  if (o0 && u0) auctions.push(mkAuction(o0, u0, 0, 'open', 48n));
  if (o1 && u1) auctions.push(mkAuction(o1, u1, 1, 'open', 20n));
  if (o0 && u1) auctions.push(mkAuction(o0, u1, 2, 'filled', 9000n));
  if (o1 && u0) auctions.push(mkAuction(o1, u0, 3, 'expired', 20000n));

  // Flywheel events: ~7 days of 15-minute cycles, thinned.
  const events: FlywheelEventDto[] = [];
  const airdropRounds: MockState['airdropRounds'] = [];
  let id = 1;
  let roundId = 1;
  const kinds: FlywheelEventKind[] = ['claim', 'buy_index', 'add_lp', 'create', 'airdrop'];
  for (let k = 7 * 24 * 4; k >= 0; k -= 1 + Math.floor(rnd() * 3)) {
    const ts = new Date(now - k * 15 * 60_000).toISOString();
    const claimedSol = 0.4 + rnd() * 2.5;
    for (const kind of kinds) {
      let amounts: Record<string, unknown>;
      switch (kind) {
        case 'claim':
          amounts = { sol: claimedSol };
          break;
        case 'buy_index':
          amounts = { sol: claimedSol / 4, units: Math.round((claimedSol / 4) * 150 * 1e6) };
          break;
        case 'add_lp':
          amounts = { sol: claimedSol / 4, units: Math.round((claimedSol / 4) * 150 * 1e6), pool: lookupTable };
          break;
        case 'create':
          amounts = { units: Math.round((claimedSol / 2) * 150 * 1e6), sol: claimedSol / 2, source: 'flywheel' };
          break;
        default: {
          const wallets = Array.from({ length: 3 }, () => fakeKey(rnd));
          const units = Math.round((claimedSol / 2) * 150 * 1e6 * 0.995);
          amounts = { roundId, units, wallets: 180 + Math.floor(rnd() * 400), skipped: Math.floor(rnd() * 60) };
          airdropRounds.push({ roundId, ts, units: String(units), sig: fakeSig(rnd), wallets });
          roundId++;
        }
      }
      events.push({ id: id++, kind, ts, sig: fakeSig(rnd), amounts, note: null });
    }
    if (rnd() < 0.2) events.push({ id: id++, kind: 'buyback', ts, sig: fakeSig(rnd), amounts: { sol: 0.3 + rnd(), coin: 1_000_000 + rnd() * 5_000_000 }, note: 'fee buyback' });
    if (rnd() < 0.2) events.push({ id: id++, kind: 'burn', ts, sig: fakeSig(rnd), amounts: { coin: 1_000_000 + rnd() * 5_000_000 }, note: 'provable SPL burn' });
    if (rnd() < 0.1) events.push({ id: id++, kind: 'treasury', ts, sig: fakeSig(rnd), amounts: { sol: 0.1 + rnd() * 0.3 }, note: 'fee share to treasury' });
    if (rnd() < 0.08) events.push({ id: id++, kind: rnd() < 0.5 ? 'create' : 'redeem', ts, sig: fakeSig(rnd), amounts: { units: 50_000e6, profitSol: rnd() * 0.4 }, note: 'AP arbitrage' });
  }
  for (const a of auctions) {
    events.push({ id: id++, kind: 'auction_start', ts: new Date(now - Number(currentSlot - BigInt(a.startSlot)) * 400).toISOString(), sig: fakeSig(rnd), amounts: { sellMint: a.sellMint, buyMint: a.buyMint, sellAmount: a.sellTotal }, note: 'drift rebalance' });
    for (const f of a.fills) events.push({ id: id++, kind: 'auction_fill', ts: new Date(now - Number(currentSlot - BigInt(f.slot)) * 400).toISOString(), sig: f.sig, amounts: { auction: a.pda, sellAmount: f.sellAmount, buyAmount: f.buyAmount }, note: null });
  }
  events.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  const nextRecon = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1));
  const announcements = [
    {
      ts: new Date(nextRecon.getTime() - 2 * DAY).toISOString(),
      title: `Reconstitution effective ${nextRecon.toISOString().slice(0, 10)} 00:00 UTC`,
      body: 'Additions: PIPPIN, ALCH. Deletions: TREMP, HARAMBE. Target weights reset to equal weight (250 bps each).',
    },
    { ts: new Date(now - 6 * DAY).toISOString(), title: 'Scheduled weekly rebalance completed', body: '7 Dutch auctions filled; max discount to Jupiter mid 1.1%; turnover 3.4% of NAV.' },
    { ts: new Date(now - 20 * DAY).toISOString(), title: 'Methodology v1.0.0 published', body: 'Equal-weight scheme, top-40 by market cap with 50-rank buffer, 14-day seasoning, $2M FDV floor.' },
  ];

  return { seed, cfg, programId, indexMint, fundPda, coinMint, lookupTable, supply, epoch: 1337n, divisor, solPriceUsd: 162.4, tokens, history, auctions, events, airdropRounds, announcements, currentSlot, startedAt: now };
}

/** Advances the mock world one tick: prices random-walk, auctions decay, occasionally fill. */
export function tickMockState(s: MockState, rnd: () => number = Math.random): { changed: AuctionDto[] } {
  for (const t of s.tokens) t.priceUsd *= Math.exp((rnd() - 0.5) * 0.004);
  s.solPriceUsd *= Math.exp((rnd() - 0.5) * 0.002);
  s.currentSlot += 12n;
  const changed: AuctionDto[] = [];
  for (const a of s.auctions) {
    if (a.status !== 'open') continue;
    const start = BigInt(a.startPrice);
    const end = BigInt(a.endPrice);
    const startSlot = BigInt(a.startSlot);
    const endSlot = BigInt(a.endSlot);
    a.currentSlot = s.currentSlot.toString();
    if (s.currentSlot >= endSlot) {
      // keeper fallback fill at the end
      const rem = BigInt(a.sellRemaining);
      a.fills.push({ sig: 'mock-' + Math.random().toString(36).slice(2), filler: 'keeper', sellAmount: rem.toString(), buyAmount: ((rem * end) >> 64n).toString(), price: end.toString(), slot: Number(s.currentSlot) });
      a.sellRemaining = '0';
      a.status = 'filled';
      a.currentPrice = end.toString();
      a.currentPriceUi = a.endPriceUi;
      s.epoch += 1n;
      changed.push(a);
      // reopen a fresh one after a while
      const sell = s.tokens.find((t) => t.mint === a.sellMint);
      const buy = s.tokens.find((t) => t.mint === a.buyMint);
      if (sell && buy) {
        const mid = (sell.priceUsd / buy.priceUsd) * 10 ** (buy.decimals - sell.decimals);
        const ns = toQ64(mid * 1.03);
        const ne = toQ64(mid * 0.96);
        const total = sell.balance / 40n;
        s.auctions.unshift({
          ...a,
          pda: Keypair.generate().publicKey.toBase58(),
          sellRemaining: total.toString(),
          sellTotal: total.toString(),
          startPrice: ns.toString(),
          endPrice: ne.toString(),
          currentPrice: ns.toString(),
          startPriceUi: (Number(ns) / 2 ** 64) * 10 ** (sell.decimals - buy.decimals),
          endPriceUi: (Number(ne) / 2 ** 64) * 10 ** (sell.decimals - buy.decimals),
          currentPriceUi: (Number(ns) / 2 ** 64) * 10 ** (sell.decimals - buy.decimals),
          startSlot: (s.currentSlot + 30n).toString(),
          endSlot: (s.currentSlot + 180n).toString(),
          status: 'open',
          fills: [],
        });
      }
      continue;
    }
    const cur = s.currentSlot <= startSlot ? start : start - ((start - end) * (s.currentSlot - startSlot)) / (endSlot - startSlot);
    a.currentPrice = cur.toString();
    a.currentPriceUi = (Number(cur) / 2 ** 64) * 10 ** (a.sellDecimals - a.buyDecimals);
    if (rnd() < 0.04 && BigInt(a.sellRemaining) > 0n) {
      const rem = BigInt(a.sellRemaining);
      const part = rem / 2n > 0n ? rem / 2n : rem;
      a.fills.push({ sig: 'mock-' + Math.random().toString(36).slice(2), filler: Keypair.generate().publicKey.toBase58(), sellAmount: part.toString(), buyAmount: ((part * cur) >> 64n).toString(), price: cur.toString(), slot: Number(s.currentSlot) });
      a.sellRemaining = (rem - part).toString();
      if (rem - part === 0n) a.status = 'filled';
      s.epoch += 1n;
      changed.push(a);
    }
  }
  return { changed };
}

export function mockHoldings(s: MockState): HoldingDto[] {
  const mv = s.tokens.reduce((acc, t) => acc + (Number(t.balance) / 10 ** t.decimals) * t.priceUsd, 0);
  return s.tokens.map((t) => {
    const balanceUi = Number(t.balance) / 10 ** t.decimals;
    const valueUsd = balanceUi * t.priceUsd;
    const weightBps = Math.round((valueUsd / mv) * 10_000);
    return {
      slot: t.slot,
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      logo: `https://dd.dexscreener.com/ds-data/tokens/solana/${t.mint}.png`,
      decimals: t.decimals,
      balance: t.balance.toString(),
      balanceUi,
      priceUsd: t.priceUsd,
      valueUsd,
      weightBps,
      targetWeightBps: t.targetWeightBps,
      driftBps: weightBps - t.targetWeightBps,
      change24hPct: ((t.priceUsd - t.openPriceUsd) / t.openPriceUsd) * 100,
      marketCapUsd: t.marketCapUsd * (t.priceUsd / (MOCK_TOKENS[t.slot]?.priceUsd ?? t.priceUsd)),
      status: t.status,
      vault: t.vault,
      verifyUrl: `https://solscan.io/account/${t.vault}`,
    };
  });
}
