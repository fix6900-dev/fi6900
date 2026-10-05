/** Composition root: builds every service from env, for both `keeper run` and the CLI commands. */
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { ApArbitrageur } from './ap/ap.js';
import { LiveProvider } from './api/live-provider.js';
import { RpcBalanceSource, RpcMintInfoSource } from './chain/accounts.js';
import { createConnection } from './chain/connection.js';
import { SdkChainClient } from './chain/sdk.js';
import { RpcTxSender } from './chain/tx.js';
import type { ChainClient } from './chain/types.js';
import { assertLiveEnv, loadEnv, type Env } from './config/env.js';
import { methodologyConfigFromEnv, type MethodologyConfig } from './config/methodology.config.js';
import { openDb } from './db/db.js';
import { Repo } from './db/repo.js';
import { AirdropRunner } from './flywheel/airdrop-runner.js';
import { PumpCreatorFeeClaimer } from './flywheel/creator-fees.js';
import { FeeProcessor } from './flywheel/fees.js';
import { Flywheel } from './flywheel/flywheel.js';
import { GovernanceService } from './governance/actions.js';
import { RefPriceUpdater } from './governance/ref-prices.js';
import { ReconstitutionService } from './governance/reconstitution.js';
import { HoldLpProvider, MeteoraLpProvider, type LpProvider } from './flywheel/lp.js';
import { MethodologyJob } from './jobs/methodology-job.js';
import { Scheduler } from './jobs/scheduler.js';
import { NavService } from './nav/service.js';
import { AuctionMonitor } from './rebalancer/monitor.js';
import { Rebalancer } from './rebalancer/rebalancer.js';
import { createSources, type Sources } from './sources/index.js';
import { EventBus } from './util/events.js';
import { loadKeypair } from './util/keypair.js';
import { childLogger } from './util/logger.js';

const log = childLogger('app');

export interface LiveContext {
  env: Env;
  cfg: MethodologyConfig;
  connection: Connection;
  keeper: Keypair;
  devWallet: Keypair | null;
  chain: ChainClient;
  sources: Sources;
  repo: Repo;
  events: EventBus;
  tx: RpcTxSender;
  devTx: RpcTxSender | null;
  nav: NavService;
  rebalancer: Rebalancer;
  monitor: AuctionMonitor;
  ap: ApArbitrageur;
  flywheel: Flywheel | null;
  airdrop: AirdropRunner | null;
  fees: FeeProcessor;
  methodology: MethodologyJob;
  governance: GovernanceService;
  refPrices: RefPriceUpdater;
  reconstitution: ReconstitutionService;
  scheduler: Scheduler;
  provider: LiveProvider;
  mints: RpcMintInfoSource;
  balances: RpcBalanceSource;
  close(): void;
}

export async function createLiveContext(overrides: Partial<Record<keyof Env, string>> = {}): Promise<LiveContext> {
  const env = loadEnv(overrides);
  assertLiveEnv(env);
  const cfg = methodologyConfigFromEnv();
  const connection = createConnection(env);
  const keeper = loadKeypair(env.KEEPER_KEYPAIR);
  const devWallet = env.DEV_WALLET ? loadKeypair(env.DEV_WALLET) : null;
  const indexMint = new PublicKey(env.INDEX_MINT);
  const chain = await SdkChainClient.create(connection, indexMint, { lookupTable: env.LOOKUP_TABLE ? new PublicKey(env.LOOKUP_TABLE) : undefined });
  const sources = createSources(env, connection, { universeSource: cfg.universe.source, coingeckoCategory: cfg.universe.coingeckoCategory });
  const db = openDb(env.DB_PATH);
  const repo = new Repo(db);
  const events = new EventBus();
  const tx = new RpcTxSender(connection, keeper, env.DRY_RUN, env.PRIORITY_FEE_MICROLAMPORTS);
  const devTx = devWallet ? new RpcTxSender(connection, devWallet, env.DRY_RUN, env.PRIORITY_FEE_MICROLAMPORTS) : null;
  const mints = new RpcMintInfoSource(connection);
  const balances = new RpcBalanceSource(connection);

  const nav = new NavService({ chain, market: sources.market, quotes: sources.quotes, repo, cfg, env, events });
  const rebalancer = new Rebalancer({ chain, tx, nav, market: sources.market, repo, cfg, env, events });
  const monitor = new AuctionMonitor({ chain, connection, tx, nav, quotes: sources.quotes, repo, cfg, env, events });
  const ap = new ApArbitrageur({ chain, tx, nav, quotes: sources.quotes, market: sources.market, repo, env, events, balances });
  const governance = new GovernanceService({ chain, tx, repo, env });
  const refPrices = new RefPriceUpdater({ chain, tx, repo, env });
  const reconstitution = new ReconstitutionService({ chain, tx, repo, env, cfg, mints, governance });
  const methodology = new MethodologyJob({ chain, tx, market: sources.market, tokens: sources.tokens, quotes: sources.quotes, mints, repo, cfg, env, reconstitution });
  const coinMint = env.COIN_MINT ? new PublicKey(env.COIN_MINT) : null;
  const treasury = env.TREASURY_WALLET ? new PublicKey(env.TREASURY_WALLET) : null;
  const fees = new FeeProcessor({ connection, chain, tx, nav, quotes: sources.quotes, balances, mints, repo, env, events, coinMint: coinMint ?? indexMint, treasury });

  let flywheel: Flywheel | null = null;
  let airdrop: AirdropRunner | null = null;
  const claimer = new PumpCreatorFeeClaimer(connection);
  if (devWallet && devTx && coinMint) {
    airdrop = new AirdropRunner({ connection, tx: devTx, holders: sources.holders, repo, env, events, indexMint, coinMint });
    const lp: LpProvider = env.METEORA_POOL ? new MeteoraLpProvider(connection, devTx, new PublicKey(env.METEORA_POOL), indexMint) : new HoldLpProvider();
    flywheel = new Flywheel({ chain, devTx, devWallet: devWallet.publicKey, nav, quotes: sources.quotes, claimer, lp, airdrop, repo, env, events, balances });
  } else {
    log.warn('DEV_WALLET and/or COIN_MINT not set; flywheel disabled');
  }

  const scheduler = new Scheduler();
  const provider = new LiveProvider({ connection, chain, nav, market: sources.market, mints, repo, cfg, env, scheduler, governance, reconstitution, claimer, devWallet: devWallet?.publicKey });
  log.info({ keeper: keeper.publicKey.toBase58(), dev: devWallet?.publicKey.toBase58() ?? null, indexMint: indexMint.toBase58(), dryRun: env.DRY_RUN }, 'live context ready');

  return {
    env, cfg, connection, keeper, devWallet, chain, sources, repo, events, tx, devTx, nav, rebalancer, monitor, ap, flywheel, airdrop, fees, methodology, governance, refPrices, reconstitution, scheduler, provider, mints, balances,
    close: () => db.close(),
  };
}

/** Registers every background job on the context's scheduler (ARCHITECTURE cadence). */
export function registerJobs(ctx: LiveContext): void {
  const { env, scheduler } = ctx;
  // NAV snapshot, then push on-chain reference prices from the same prices (rebalancer role, move cap respected).
  scheduler.addInterval(
    'nav-snapshot',
    env.NAV_SNAPSHOT_SEC * 1000,
    async () => {
      const nav = await ctx.nav.snapshot();
      if (env.REF_PRICE_UPDATES) {
        const r = await ctx.refPrices.update(nav).catch((e: Error) => {
          log.warn({ err: e.message }, 'ref price update failed');
          return null;
        });
        return { nav: nav.nav.navUsd, refPrices: r ? { sent: r.sent, clamped: r.clamped.length } : null };
      }
      return { nav: nav.nav.navUsd };
    },
    { runImmediately: true },
  );
  // Timelocked actions: execute whatever is due (anyone may; the keeper does it on a schedule).
  scheduler.addInterval('execute-actions', env.ACTION_EXECUTE_SEC * 1000, async () => {
    const r = await ctx.governance.executeDue();
    await ctx.reconstitution.reconcileExecuted().catch(() => 0);
    return r;
  });
  scheduler.addCron('methodology', env.METHODOLOGY_CRON, () => ctx.methodology.run());
  scheduler.addInterval('rebalance-check', env.REBALANCE_CHECK_SEC * 1000, () => ctx.rebalancer.check());
  scheduler.addInterval('auction-monitor', env.AUCTION_MONITOR_SEC * 1000, () => ctx.monitor.tick());
  scheduler.addInterval('ap-check', env.AP_CHECK_SEC * 1000, () => ctx.ap.check());
  if (ctx.flywheel) {
    const fw = ctx.flywheel;
    scheduler.addInterval('flywheel', env.DIST_INTERVAL_MIN * 60_000, () => fw.runCycle());
  }
  scheduler.addCron('fee-processing', env.FEE_PROCESS_CRON, async () => {
    ctx.ap.resetCycleBudget();
    return ctx.fees.run();
  });
}
