/** KeeperDataProvider serving generated data; ticks every few seconds and emits SSE events. */
import { nextReconstitution } from '../methodology/schedule.js';
import { runMethodology } from '../methodology/run.js';
import type { CandidateToken } from '../methodology/types.js';
import type { EventBus } from '../util/events.js';
import { DAY } from '../util/time.js';
import type {
  AirdropDto,
  AnnouncementDto,
  AuctionDto,
  FlywheelDto,
  FlywheelEventDto,
  FundDto,
  GovernanceDto,
  HistoryPointDto,
  HistoryRange,
  HoldingDto,
  KeeperDataProvider,
  MethodologyDto,
  ProposalDto,
  QuoteCreateDto,
  QuoteRedeemDto,
  VerifyDto,
} from '../api/types.js';
import { nextScheduledRebalance } from '../methodology/schedule.js';
import { createMockState, mockHoldings, tickMockState, type MockState } from './generator.js';
import { MOCK_TOKENS } from './tokens.js';

export class MockProvider implements KeeperDataProvider {
  readonly mode = 'mock' as const;
  readonly state: MockState;
  private timer: NodeJS.Timeout | undefined;
  private lastHistoryPush = Date.now();

  constructor(
    private readonly events: EventBus,
    seed = 6900,
  ) {
    this.state = createMockState(seed);
  }

  start(tickMs = 4_000): void {
    this.timer = setInterval(() => this.tick(), tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(): void {
    const { changed } = tickMockState(this.state);
    void this.fund().then((f) => this.events.emit('fund', f));
    this.events.emit('holdings', mockHoldings(this.state));
    for (const a of changed) this.events.emit('auction', a);
    if (Date.now() - this.lastHistoryPush > 60_000) {
      this.lastHistoryPush = Date.now();
      void this.fund().then((f) => this.state.history.push({ t: new Date().toISOString(), navPerUnitUsd: f.navPerUnitUsd, indexLevel: f.indexLevel, marketPriceUsd: f.marketPriceUsd, supply: f.supply }));
    }
    if (Math.random() < 0.08) {
      const ev: FlywheelEventDto = { id: this.state.events.reduce((m, e) => Math.max(m, e.id), 0) + 1, kind: 'claim', ts: new Date().toISOString(), sig: 'mock-' + Math.random().toString(36).slice(2), amounts: { sol: 0.3 + Math.random() }, note: null };
      this.state.events.unshift(ev);
      this.events.emit('flywheel_event', ev);
    }
  }

  private mv(): number {
    return this.state.tokens.reduce((s, t) => s + (Number(t.balance) / 10 ** t.decimals) * t.priceUsd, 0);
  }

  async fund(): Promise<FundDto> {
    const s = this.state;
    const navUsd = this.mv();
    const navPerUnit = navUsd / (Number(s.supply) / 1e6);
    const level = navUsd / s.divisor;
    const market = navPerUnit * (1 + Math.sin(Date.now() / 600_000) * 0.006);
    return {
      indexMint: s.indexMint,
      fundPda: s.fundPda,
      supply: s.supply.toString(),
      navUsd,
      navPerUnitUsd: navPerUnit,
      indexLevel: level,
      marketPriceUsd: market,
      premiumBps: Math.round(((market - navPerUnit) / navPerUnit) * 10_000),
      fees: { mintBps: 50, redeemBps: 50, mgmtBps: 100 },
      assetCount: s.tokens.length,
      epoch: s.epoch.toString(),
      openAuctions: s.auctions.filter((a) => a.status === 'open').length,
      paused: 0,
    };
  }

  async holdings(): Promise<HoldingDto[]> {
    return mockHoldings(this.state);
  }

  async history(range: HistoryRange): Promise<HistoryPointDto[]> {
    if (range === 'all') return this.state.history;
    const since = Date.now() - { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY }[range];
    return this.state.history.filter((h) => Date.parse(h.t) >= since);
  }

  async auctions(status: 'open' | 'all'): Promise<AuctionDto[]> {
    return status === 'open' ? this.state.auctions.filter((a) => a.status === 'open') : this.state.auctions;
  }

  async flywheel(): Promise<FlywheelDto> {
    const sum = (kind: string, field: string): number =>
      this.state.events.filter((e) => e.kind === kind).reduce((s, e) => s + (Number(e.amounts[field]) || 0), 0);
    const next = new Date(Math.ceil(Date.now() / (15 * 60_000)) * 15 * 60_000);
    return {
      coinMint: this.state.coinMint,
      creatorFeesClaimedSol: sum('claim', 'sol'),
      lpAddedSol: sum('add_lp', 'sol'),
      airdroppedUnits: sum('airdrop', 'units') / 1e6,
      airdropRounds: this.state.airdropRounds.length,
      buybackSol: sum('buyback', 'sol'),
      burnedCoin: sum('burn', 'coin'),
      treasurySol: sum('treasury', 'sol'),
      next: {
        airdropAt: next.toISOString(),
        rebalanceCheckAt: new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString(),
        scheduledRebalanceAt: nextScheduledRebalance(Date.now() - 3 * DAY, this.state.cfg).toISOString(),
      },
    };
  }

  async flywheelEvents(limit: number, cursor?: number): Promise<{ items: FlywheelEventDto[]; nextCursor: string | null }> {
    const all = cursor === undefined ? this.state.events : this.state.events.filter((e) => e.id < cursor);
    const items = all.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: all.length > limit && last ? String(last.id) : null };
  }

  async airdrops(wallet: string): Promise<AirdropDto[]> {
    const own = this.state.airdropRounds.filter((r) => r.wallets.includes(wallet));
    // Any wallet gets a plausible trail so the UI lookup is demoable.
    const rounds = own.length ? own : this.state.airdropRounds.slice(0, 12);
    return rounds.map((r) => ({ roundId: r.roundId, ts: r.ts, units: String(Math.round(Number(r.units) / 400)), sig: r.sig }));
  }

  async methodology(): Promise<MethodologyDto> {
    const now = Date.now();
    const candidates: CandidateToken[] = MOCK_TOKENS.map((t) => ({
      mint: t.mint,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      priceUsd: t.priceUsd,
      fdvUsd: t.marketCapUsd * 1.05,
      marketCapUsd: t.marketCapUsd,
      volume24hUsd: Math.max(300_000, t.marketCapUsd * 0.08),
      avgVolume7dUsd: Math.max(150_000, t.marketCapUsd * 0.06),
      firstTradeAt: now - 120 * DAY,
      mintAuthority: null,
      freezeAuthority: null,
      sellImpactBps: 40,
      tags: [],
    }));
    const run = runMethodology(candidates, new Set(candidates.map((c) => c.mint)), this.state.cfg, new Date(now - 6 * 3_600_000));
    return {
      config: this.state.cfg,
      lastRun: { ts: run.ts, eligible: run.eligible, selected: run.selection.selected, weights: run.weights },
      nextReconstitution: nextReconstitution(new Date(), this.state.cfg).toISOString(),
    };
  }

  async announcements(): Promise<AnnouncementDto[]> {
    return this.state.announcements;
  }

  async verify(): Promise<VerifyDto> {
    const s = this.state;
    return {
      fundPda: s.fundPda,
      indexMint: s.indexMint,
      mintAuthority: s.fundPda,
      vaults: s.tokens.map((t) => ({ mint: t.mint, vault: t.vault, owner: s.fundPda, amount: t.balance.toString() })),
      lookupTable: s.lookupTable,
      programId: s.programId,
      idlHash: 'sha256:mock0000000000000000000000000000000000000000000000000000000000',
      programDataAddress: 'ProgDataMock11111111111111111111111111111111',
      upgradeAuthority: null,
    };
  }

  async governance(): Promise<GovernanceDto> {
    const s = this.state;
    return {
      timelockSlots: '432000',
      pending: [
        {
          pda: 'PendingMock1111111111111111111111111111111111',
          nonce: '0',
          kind: 1,
          kindName: 'set_target_weight',
          payload: { mint: s.tokens[0]?.mint ?? '', targetWeightBps: 250 },
          etaSlot: '999999999',
          queuedSlot: '999567999',
          proposer: s.fundPda,
          queuedSig: 'mock-queue-sig',
          due: false,
        },
      ],
      upgradeAuthority: null,
      programDataAddress: 'ProgDataMock11111111111111111111111111111111',
      fundAuthority: 'SquadsMultisigMock1111111111111111111111111',
      pendingAuthority: null,
      rebalancer: 'KeeperMock111111111111111111111111111111111',
      feeRecipient: 'KeeperMock111111111111111111111111111111111',
      maxAuctionDiscountBps: 500,
      maxRefMoveBps: 2000,
      refMovePeriodSlots: '216000',
      reconstitutionMode: 'manual',
      currentSlot: '999000000',
    };
  }

  async proposals(status?: string): Promise<ProposalDto[]> {
    const t = this.state.tokens[this.state.tokens.length - 1];
    const rows: ProposalDto[] = t
      ? [
          {
            id: 1,
            mint: t.mint,
            symbol: t.symbol,
            action: 'remove',
            reason: { source: 'methodology', rank: 55, marketCapUsd: t.marketCapUsd, reasons: ['volume_24h_too_low'] },
            status: 'proposed',
            weightBps: null,
            proposedTs: new Date(Date.now() - DAY).toISOString(),
            decidedTs: null,
            queuedTs: null,
            executedTs: null,
            actionPda: null,
            queuedSig: null,
            note: null,
          },
        ]
      : [];
    return status ? rows.filter((r) => r.status === status) : rows;
  }

  async quoteCreate(units: bigint): Promise<QuoteCreateDto> {
    const s = this.state;
    const f = await this.fund();
    return {
      basket: s.tokens.map((t) => ({ mint: t.mint, amount: ((t.balance * units + s.supply - 1n) / s.supply).toString() })),
      estCostSol: ((Number(units) / 1e6) * f.navPerUnitUsd * 1.005) / s.solPriceUsd,
      estNavUsd: (Number(units) / 1e6) * f.navPerUnitUsd,
    };
  }

  async quoteRedeem(units: bigint): Promise<QuoteRedeemDto> {
    const s = this.state;
    const f = await this.fund();
    const net = units - units / 200n;
    return {
      basket: s.tokens.map((t) => ({ mint: t.mint, amount: ((t.balance * net) / s.supply).toString() })),
      estValueUsd: (Number(net) / 1e6) * f.navPerUnitUsd,
    };
  }

  async health(): Promise<Record<string, unknown>> {
    return { mock: true, seed: this.state.seed, uptimeSec: Math.round((Date.now() - this.state.startedAt) / 1000) };
  }
}
