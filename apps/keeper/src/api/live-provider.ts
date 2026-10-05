/** KeeperDataProvider backed by the chain, SQLite and the price sources. */
import type { Connection, PublicKey } from '@solana/web3.js';
import type { CreatorFeeClaimer } from '../flywheel/creator-fees.js';
import { TtlCache } from '../util/cache.js';
import type { ChainClient } from '../chain/types.js';
import type { MintInfoSource } from '../chain/accounts.js';
import type { Env } from '../config/env.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import type { Repo } from '../db/repo.js';
import { nextReconstitution, nextScheduledRebalance } from '../methodology/schedule.js';
import type { GovernanceService } from '../governance/actions.js';
import type { ReconstitutionService } from '../governance/reconstitution.js';
import type { ProposalRow } from '../db/repo.js';
import { LAST_REBALANCE_KEY } from '../rebalancer/rebalancer.js';
import { creationBasket, redemptionBasket } from '../nav/compute.js';
import type { NavService } from '../nav/service.js';
import { priceAtSlot } from '../rebalancer/auction-pricing.js';
import type { CompositeMarketData } from '../sources/market-data.js';
import { parseJson } from '../util/json.js';
import { fromQ64 } from '../util/math.js';
import { DAY } from '../util/time.js';
import type { Scheduler } from '../jobs/scheduler.js';
import type {
  AdminActions,
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
} from './types.js';
import { solscan } from './types.js';

export interface LiveProviderDeps {
  connection: Connection;
  chain: ChainClient;
  nav: NavService;
  market: CompositeMarketData;
  mints: MintInfoSource;
  repo: Repo;
  cfg: MethodologyConfig;
  env: Env;
  scheduler?: Scheduler;
  governance: GovernanceService;
  reconstitution: ReconstitutionService;
  /** Optional: live "unclaimed creator fees" for /v1/flywheel. */
  claimer?: CreatorFeeClaimer;
  devWallet?: PublicKey;
}

export function toProposalDto(p: ProposalRow): ProposalDto {
  return {
    id: p.id,
    mint: p.mint,
    symbol: p.symbol,
    action: p.action,
    reason: parseJson<Record<string, unknown>>(p.reason, {}),
    status: p.status,
    weightBps: p.weight_bps,
    proposedTs: p.proposed_ts,
    decidedTs: p.decided_ts,
    queuedTs: p.queued_ts,
    executedTs: p.executed_ts,
    actionPda: p.action_pda,
    queuedSig: p.queued_sig,
    note: p.note,
  };
}

export class LiveProvider implements KeeperDataProvider {
  private readonly unclaimedCache = new TtlCache<{ bondingCurveSol: number; pumpSwapSol: number }>(30_000);
  readonly mode = 'live' as const;
  readonly admin: AdminActions;

  constructor(private readonly d: LiveProviderDeps) {
    const recon = d.reconstitution;
    this.admin = {
      approveProposal: async (mint, o) => {
        const r = await recon.approve(mint, o);
        return { proposal: toProposalDto(r.proposal), queued: r.queued };
      },
      rejectProposal: async (mint, note) => toProposalDto(recon.reject(mint, note)),
      addAsset: async (mint, o) => {
        const r = await recon.addAsset(mint, o);
        return { proposal: toProposalDto(r.proposal), queued: r.queued };
      },
      removeAsset: async (mint, o) => {
        const r = await recon.removeAsset(mint, o);
        return { proposal: toProposalDto(r.proposal), queued: r.queued };
      },
    };
  }

  async fund(): Promise<FundDto> {
    const n = await this.d.nav.get(60_000);
    return {
      indexMint: n.fund.indexMint,
      fundPda: n.fund.pda,
      supply: n.nav.supply.toString(),
      navUsd: n.nav.navUsd,
      navPerUnitUsd: n.nav.navPerUnitUsd,
      indexLevel: n.indexLevel,
      marketPriceUsd: n.marketPriceUsd,
      premiumBps: n.premiumBps,
      fees: { mintBps: n.fund.mintFeeBps, redeemBps: n.fund.redeemFeeBps, mgmtBps: n.fund.mgmtFeeBps },
      assetCount: n.fund.assetCount,
      epoch: n.fund.epoch.toString(),
      openAuctions: n.fund.openAuctions,
      paused: n.fund.paused,
    };
  }

  async holdings(): Promise<HoldingDto[]> {
    const n = await this.d.nav.get(60_000);
    const md = await this.d.market.getEnriched(n.assets.map((a) => a.mint));
    return n.nav.holdings.map((h) => {
      const m = md.get(h.mint);
      return {
        slot: h.slot,
        mint: h.mint,
        symbol: m?.symbol ?? h.mint.slice(0, 4),
        name: m?.name ?? h.mint,
        logo: m?.info?.logo ?? null,
        decimals: h.decimals,
        balance: h.balance.toString(),
        balanceUi: h.balanceUi,
        priceUsd: h.priceUsd,
        valueUsd: h.valueUsd,
        weightBps: h.weightBps,
        targetWeightBps: h.targetWeightBps,
        driftBps: h.driftBps,
        change24hPct: m?.change24hPct ?? 0,
        marketCapUsd: m?.marketCapUsd ?? 0,
        status: h.status,
        vault: h.vault,
        verifyUrl: solscan.account(h.vault),
      };
    });
  }

  async history(range: HistoryRange): Promise<HistoryPointDto[]> {
    const since = range === 'all' ? null : new Date(Date.now() - { '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY }[range]).toISOString();
    return this.d.repo.navHistory(since).map((r) => ({ t: r.ts, navPerUnitUsd: r.nav_per_unit_usd, indexLevel: r.index_level, marketPriceUsd: r.market_price_usd, supply: r.supply }));
  }

  async auctions(status: 'open' | 'all'): Promise<AuctionDto[]> {
    const rows = this.d.repo.listAuctions(status);
    const slot = BigInt(await this.d.connection.getSlot().catch(() => 0));
    const n = this.d.nav.latest;
    const mints = [...new Set(rows.flatMap((r) => [r.sell_mint, r.buy_mint]))];
    const md = mints.length ? await this.d.market.getEnriched(mints) : new Map();
    return rows.map((r) => {
      const sell = n?.assets.find((a) => a.mint === r.sell_mint);
      const buy = n?.assets.find((a) => a.mint === r.buy_mint);
      const sd = sell?.decimals ?? 6;
      const bd = buy?.decimals ?? 6;
      const start = BigInt(r.start_price);
      const end = BigInt(r.end_price);
      const cur = r.status === 'open' ? priceAtSlot(start, end, BigInt(r.start_slot), BigInt(r.end_slot), slot) : end;
      const ui = (q: bigint): number => fromQ64(q) * 10 ** (sd - bd);
      return {
        pda: r.pda,
        sellMint: r.sell_mint,
        buyMint: r.buy_mint,
        sellSymbol: md.get(r.sell_mint)?.symbol ?? r.sell_mint.slice(0, 4),
        buySymbol: md.get(r.buy_mint)?.symbol ?? r.buy_mint.slice(0, 4),
        sellDecimals: sd,
        buyDecimals: bd,
        sellRemaining: r.sell_remaining,
        sellTotal: r.sell_total,
        startPrice: r.start_price,
        endPrice: r.end_price,
        currentPrice: cur.toString(),
        startPriceUi: ui(start),
        endPriceUi: ui(end),
        currentPriceUi: ui(cur),
        startSlot: r.start_slot,
        endSlot: r.end_slot,
        currentSlot: slot.toString(),
        status: r.status,
        fills: this.d.repo.fillsFor(r.pda).map((f) => ({ sig: f.sig, filler: f.filler, sellAmount: f.sell_amount, buyAmount: f.buy_amount, price: f.price, slot: f.slot })),
      };
    });
  }

  async flywheel(): Promise<FlywheelDto> {
    const repo = this.d.repo;
    const solPriceUsd = (await this.d.nav.get().catch(() => null))?.solPriceUsd ?? 0;
    const totals = repo.airdropTotals();
    let unclaimed: FlywheelDto['creatorFeesUnclaimed'] = null;
    if (this.d.claimer && this.d.devWallet) {
      unclaimed = await this.unclaimedCache.getOrLoad('unclaimed', async () => {
        const b = await this.d.claimer!.pendingBreakdown(this.d.devWallet!);
        return { bondingCurveSol: Number(b.bondingCurve) / 1e9, pumpSwapSol: Number(b.pumpSwap) / 1e9 };
      }).catch(() => null);
    }
    return {
      coinMint: this.d.env.COIN_MINT ?? '',
      creatorFeesClaimedSol: repo.sumFlywheel('claim', 'sol'),
      creatorFeesUnclaimedSol: unclaimed ? unclaimed.bondingCurveSol + unclaimed.pumpSwapSol : null,
      creatorFeesUnclaimed: unclaimed,
      lpAddedSol: repo.sumFlywheel('add_lp', 'sol'),
      airdroppedUnits: Number(totals.units) / 1e6,
      airdropRounds: totals.rounds,
      buybackSol: repo.sumFlywheel('buyback', 'sol'),
      burnedCoin: repo.sumFlywheel('burn', 'coin'),
      treasurySol: repo.sumFlywheel('treasury', 'sol'),
      arbProfitSol: repo.sumFlywheel('create', 'profitSol') + repo.sumFlywheel('redeem', 'profitSol') + (repo.sumFlywheel('redeem', 'profitUsd') + repo.sumFlywheel('create', 'profitUsd')) / Math.max(1, solPriceUsd),
      arbTrades: repo.countFlywheel('create') + repo.countFlywheel('redeem'),
      next: {
        airdropAt: this.d.scheduler?.nextRun('flywheel')?.toISOString() ?? null,
        rebalanceCheckAt: this.d.scheduler?.nextRun('rebalance-check')?.toISOString() ?? null,
        scheduledRebalanceAt: this.scheduledRebalanceAt(),
      },
    };
  }

  async flywheelEvents(limit: number, cursor?: number): Promise<{ items: FlywheelEventDto[]; nextCursor: string | null }> {
    const rows = this.d.repo.flywheelEvents(limit + 1, cursor);
    const items = rows.slice(0, limit).map((r) => ({ id: r.id, kind: r.kind, ts: r.ts, sig: r.sig, amounts: r.amounts, note: r.note }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? String(last.id) : null };
  }

  async airdrops(wallet: string): Promise<AirdropDto[]> {
    return this.d.repo.payoutsFor(wallet).map((p) => ({ roundId: p.round_id, ts: p.ts, units: p.units, sig: p.sig }));
  }

  async methodology(): Promise<MethodologyDto> {
    const run = this.d.repo.latestMethodologyRun();
    return {
      // driftBandBps is a legacy alias (absolute band) the web still reads; the engine uses driftRelativeBps
      config: { ...this.d.cfg, rebalance: { ...this.d.cfg.rebalance, driftBandBps: Math.round((this.d.cfg.rebalance.driftRelativeBps / 10_000) * (10_000 / Math.max(1, this.d.cfg.selection.targetCount))) } },
      lastRun: run
        ? { ts: run.ts, eligible: parseJson<unknown[]>(run.eligible, []), selected: parseJson<unknown[]>(run.selected, []), weights: parseJson<unknown[]>(run.weights, []) }
        : null,
      nextReconstitution: nextReconstitution(new Date(), this.d.cfg).toISOString(),
    };
  }

  /** Next weekly scheduled rebalance from the last recorded one (now if none yet). */
  scheduledRebalanceAt(): string {
    const last = this.d.repo.getKv(LAST_REBALANCE_KEY);
    return nextScheduledRebalance(last ? Date.parse(last) : null, this.d.cfg).toISOString();
  }

  async governance(): Promise<GovernanceDto> {
    const [fund, pending, upgrade, slot] = await Promise.all([this.d.chain.readFund(), this.d.governance.pending(), this.d.chain.getProgramUpgradeInfo(), this.d.chain.getCurrentSlot()]);
    return {
      timelockSlots: fund.timelockSlots.toString(),
      pending,
      upgradeAuthority: upgrade.upgradeAuthority,
      programDataAddress: upgrade.programDataAddress,
      fundAuthority: fund.authority,
      pendingAuthority: fund.pendingAuthority === '11111111111111111111111111111111' ? null : fund.pendingAuthority,
      rebalancer: fund.rebalancer,
      feeRecipient: fund.feeRecipient,
      maxAuctionDiscountBps: fund.maxAuctionDiscountBps,
      maxRefMoveBps: fund.maxRefMoveBps,
      refMovePeriodSlots: fund.refMovePeriodSlots.toString(),
      reconstitutionMode: this.d.reconstitution.mode,
      currentSlot: slot.toString(),
    };
  }

  async proposals(status?: string): Promise<ProposalDto[]> {
    const s = status as ProposalRow['status'] | undefined;
    return this.d.reconstitution.list(s).map(toProposalDto);
  }

  async announcements(): Promise<AnnouncementDto[]> {
    return this.d.repo.announcements().map((a) => ({ ts: a.ts, title: a.title, body: a.body }));
  }

  async verify(): Promise<VerifyDto> {
    const n = await this.d.nav.get(60_000);
    const mintInfo = (await this.d.mints.getMintInfo([n.fund.indexMint])).get(n.fund.indexMint);
    const upgrade = await this.d.chain.getProgramUpgradeInfo().catch(() => ({ programDataAddress: null, upgradeAuthority: null }));
    return {
      fundPda: n.fund.pda,
      indexMint: n.fund.indexMint,
      mintAuthority: mintInfo?.mintAuthority ?? null,
      vaults: n.assets.map((a) => ({ mint: a.mint, vault: a.vault, owner: n.fund.pda, amount: a.vaultAmount.toString() })),
      lookupTable: this.d.env.LOOKUP_TABLE ?? (await this.d.chain.getLookupTable().catch(() => null)),
      programId: this.d.chain.programId,
      idlHash: this.d.repo.getKv('idl_hash') ?? null,
      programDataAddress: upgrade.programDataAddress,
      upgradeAuthority: upgrade.upgradeAuthority,
    };
  }

  async quoteCreate(units: bigint): Promise<QuoteCreateDto> {
    const n = await this.d.nav.get(60_000);
    const basket = creationBasket(n.assets, units, n.nav.supply);
    const estNavUsd = (Number(units) / 1e6) * n.nav.navPerUnitUsd;
    const feeMult = 1 + n.fund.mintFeeBps / 10_000;
    return { basket: basket.map((b) => ({ mint: b.mint, amount: b.amount.toString() })), estCostSol: (estNavUsd * feeMult) / n.solPriceUsd, estNavUsd };
  }

  async quoteRedeem(units: bigint): Promise<QuoteRedeemDto> {
    const n = await this.d.nav.get(60_000);
    const basket = redemptionBasket(n.assets, units, n.nav.supply, n.fund.redeemFeeBps);
    let value = 0;
    for (const b of basket) {
      const a = n.assets.find((x) => x.mint === b.mint);
      const p = n.prices.get(b.mint) ?? 0;
      if (a) value += (Number(b.amount) / 10 ** a.decimals) * p;
    }
    return { basket: basket.map((b) => ({ mint: b.mint, amount: b.amount.toString() })), estValueUsd: value };
  }

  async health(): Promise<Record<string, unknown>> {
    const latest = this.d.repo.latestNav();
    return {
      dryRun: this.d.env.DRY_RUN,
      lastSnapshot: latest?.ts ?? null,
      rpc: this.d.env.RPC_URL.replace(/api-key=[^&]+/, 'api-key=***'),
      programId: this.d.chain.programId,
      fundPda: this.d.chain.fundPda.toBase58(),
      jobs: this.d.scheduler?.status() ?? {},
    };
  }
}
