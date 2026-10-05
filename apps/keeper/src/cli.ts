#!/usr/bin/env node
/**
 * keeper CLI (run with `pnpm keeper <cmd>` / `tsx src/cli.ts <cmd>`):
 *
 *   keeper init-fund [--sol <amount>] [--basket <json>] [--dry]   create mint, initialize_fund, add assets (basket file or methodology), LUT, bootstrap
 *   keeper run                                  API + scheduler (MOCK_MODE honoured)
 *   keeper methodology [--dry]                  one methodology pass
 *   keeper rebalance [--dry] [--force]          one rebalance check (plan + open auctions)
 *   keeper airdrop [--dry]                      one flywheel cycle (claim -> LP -> create -> airdrop)
 *   keeper snapshot-holders [--mint <mint>]     holder snapshot of the $FIX6900 coin into SQLite
 *   keeper fees [--dry]                         one fee-processing pass
 *   keeper proposals [--status s]               reconstitution proposals (index committee queue)
 *   keeper approve <mint> [--weight bps] [--immediate]   approve a proposal (queued at the next window, or now)
 *   keeper reject <mint> [--note text]          reject (suppresses re-proposal for RECON_REJECT_COOLDOWN_DAYS)
 *   keeper add-asset <mint> [--weight bps] [--immediate] [--force]   manual add of an arbitrary mint
 *   keeper remove-asset <mint> [--immediate]    manual removal
 *   keeper governance                           timelock, pending actions, authorities, upgrade authority
 *   keeper execute-actions [--dry]              execute due timelocked actions now
 *   keeper queue-approved [--dry]               queue every approved proposal now (normally done at the window)
 *   keeper set-ref-prices [--dry]               push reference prices from the price source now
 *   keeper launch-report [--out path] [--seed 5,10,25,50] [--alternates 20] [--universe 150] [--cg-top 40] [--fresh-notes]
 *                                               methodology dry run on live data -> docs/launch-constituents.md (+ seed sizing,
 *                                               raw CoinGecko top-N comparison; section 0 committee notes are preserved unless --fresh-notes)
 *   keeper create-pool [--units 2000] [--config 1] [--price-sol x] [--dry]
 *                                               build (and send unless --dry) the Meteora DAMM v2 INDEX/SOL pool at NAV per unit
 */
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createLiveContext, registerJobs, type LiveContext } from './app.js';
import { buildCreateIndexSolPool } from './flywheel/lp.js';
import { extractCommitteeNotes, renderLaunchReport, type CgTopRow, type SeedImpact } from './methodology/launch-report.js';
import { runMethodology } from './methodology/run.js';
import { INDEX_DECIMALS } from './nav/compute.js';
import { rpcUrl } from './chain/connection.js';
import { main as runMain } from './index.js';
import { loadEnv } from './config/env.js';
import { WSOL_MINT } from './sources/types.js';
import { logger } from './util/logger.js';
import { stringifyBig } from './util/json.js';
import { uiToBigint } from './util/math.js';
import { DRY_RUN_SIG } from './chain/tx.js';

interface Args {
  cmd: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [cmd = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a?.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return { cmd, flags };
}

const print = (v: unknown): void => {
  process.stdout.write(stringifyBig(v).length > 20_000 ? stringifyBig(v).slice(0, 20_000) + '\n...truncated\n' : JSON.stringify(JSON.parse(stringifyBig(v)), null, 2) + '\n');
};

async function withCtx<T>(flags: Record<string, string | boolean>, fn: (ctx: LiveContext) => Promise<T>): Promise<T> {
  const overrides: Partial<Record<'DRY_RUN', string>> = {};
  if (flags.dry) overrides.DRY_RUN = 'true';
  const ctx = await createLiveContext(overrides);
  try {
    return await fn(ctx);
  } finally {
    ctx.close();
  }
}

/**
 * Launch sequence (see docs/launch-runbook.md):
 *  1. create a fresh 6-decimal mint (keeper is temporary mint authority)
 *  2. initialize_fund  (program takes over mint authority)
 *  3. methodology run -> add_asset for each selected constituent with its target weight
 *  4. create the address lookup table
 *  5. with --sol: buy the basket via Jupiter pro-rata to weights, transfer into vaults, bootstrap_mint
 */
async function initFund(flags: Record<string, string | boolean>): Promise<void> {
  const env = loadEnv(flags.dry ? { DRY_RUN: 'true' } : {});
  // --resume <index mint>: the fund already exists on-chain (mint, initialize_fund, add_asset, ref prices, lookup table
  // done); only the basket purchase / vault deposits / bootstrap_mint remain. Legs already bought or deposited are skipped.
  const resumeMint = typeof flags.resume === 'string' ? flags.resume : null;
  const mintKp = Keypair.generate();
  const indexMint = resumeMint ?? mintKp.publicKey.toBase58();
  if (resumeMint) logger.info({ mint: resumeMint }, 'RESUMING an existing fund; skipping mint/initialize/add_asset/ref-price/lookup-table steps');
  else {
    logger.info({ mint: mintKp.publicKey.toBase58() }, 'generated index mint keypair (SAVE THIS)');
    process.stdout.write(`INDEX_MINT=${mintKp.publicKey.toBase58()}\nINDEX_MINT_SECRET=${JSON.stringify([...mintKp.secretKey])}\n`);
  }

  const ctx = await createLiveContext({ ...(flags.dry ? { DRY_RUN: 'true' } : {}), INDEX_MINT: indexMint });
  try {
    const { connection, keeper, chain, tx } = ctx;
    let selected: { mint: string; symbol: string; weightBps: number }[];
    if (resumeMint) {
      const existing = await chain.readAssets();
      if (existing.length === 0) throw new Error(`fund for ${resumeMint} has no assets; nothing to resume`);
      selected = existing.map((a) => ({ mint: a.mint, symbol: a.mint.slice(0, 4), weightBps: a.targetWeightBps }));
      logger.info({ fund: chain.fundPda.toBase58(), assets: existing.length }, 'fund state read for resume');
    } else {
    // 1) create mint
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const createMintIxs = [
      SystemProgram.createAccount({ fromPubkey: keeper.publicKey, newAccountPubkey: mintKp.publicKey, lamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mintKp.publicKey, 6, keeper.publicKey, null),
    ];
    const s1 = await tx.sendIxs(createMintIxs, { signers: [mintKp], label: 'create index mint' });
    // 2) initialize fund
    // timelock starts at 0 so init-fund can add assets directly; enable it with set_timelock (docs/launch-runbook.md)
    const timelock = typeof flags.timelock === 'string' ? BigInt(flags.timelock) : 0n;
    const s2 = await tx.sendIxs(await chain.initializeFundIx(keeper.publicKey, { mintFeeBps: 50, redeemFeeBps: 50, mgmtFeeBps: 100 }, timelock), { label: 'initialize_fund' });
    logger.info({ s1, s2, fund: chain.fundPda.toBase58() }, 'fund initialised');

    // 3) constituents: --basket <json> (committee-approved list, e.g. config/launch-basket.json) or a live methodology run
    if (typeof flags.basket === 'string') {
      const basket = JSON.parse(readFileSync(flags.basket, 'utf8')) as { assets: { mint: string; symbol: string; targetWeightBps: number; allowTransferFee?: boolean }[] };
      selected = basket.assets.map((a) => ({ mint: a.mint, symbol: a.symbol, weightBps: a.targetWeightBps }));
      const allowFee = new Set(basket.assets.filter((a) => a.allowTransferFee === true).map((a) => a.mint));
      const total = selected.reduce((n, a) => n + a.weightBps, 0);
      if (total !== 10_000) throw new Error(`basket weights sum to ${total} bps, expected 10000`);
      // Verify every mint on-chain before touching the fund: authorities revoked, no transfer hook, and no transfer
      // fee unless the committee set `"allowTransferFee": true` on that basket entry (methodology rule 2.7 override).
      const infos = await ctx.mints.getMintInfo(selected.map((a) => a.mint));
      for (const a of selected) {
        const info = infos.get(a.mint);
        if (!info) throw new Error(`basket mint ${a.symbol} ${a.mint} not found on this cluster`);
        if (info.mintAuthority || info.freezeAuthority) throw new Error(`basket mint ${a.symbol} has a live ${info.mintAuthority ? 'mint' : 'freeze'} authority`);
        if (info.transferHookProgram) throw new Error(`basket mint ${a.symbol} has a Token-2022 transfer hook (never admissible)`);
        if (info.transferFeeBps > 0) {
          if (!allowFee.has(a.mint)) throw new Error(`basket mint ${a.symbol} has a Token-2022 transfer fee of ${info.transferFeeBps} bps; set "allowTransferFee": true on its basket entry to admit it by committee override`);
          logger.warn(
            { symbol: a.symbol, mint: a.mint, transferFeeBps: info.transferFeeBps, transferFeeMaxFee: info.transferFeeMaxFee.toString() },
            'ADMITTING A TRANSFER-FEE MINT BY COMMITTEE OVERRIDE (rule 2.7): every vault deposit, withdrawal and auction fill of this constituent is taxed',
          );
        }
      }
      logger.info({ count: selected.length, file: flags.basket }, 'using committee-approved basket');
    } else {
      const { run } = await ctx.methodology.run({ dry: true });
      selected = run.weights;
      if (selected.length === 0) throw new Error('methodology selected no constituents; check data sources');
    }
    for (const w of selected) {
      const sig = await tx.sendIxs(await chain.addAssetIx(new PublicKey(w.mint), w.weightBps, keeper.publicKey), { label: `add_asset ${w.symbol}` });
      logger.info({ sig, symbol: w.symbol, weightBps: w.weightBps }, 'asset added');
    }

    // 3b) reference prices (auction price bounds): the authority sets the first value
    {
      const nav = await ctx.nav.snapshot(false);
      const r = await ctx.refPrices.update(nav);
      logger.info({ sent: r.sent, unpriced: r.unpriced }, 'reference prices set');
    }

    // 4) lookup table(s)
    const lut = await chain.createFundLookupTable(keeper.publicKey);
    const lutSigs: string[] = [];
    for (const group of lut.instructionGroups) lutSigs.push(await tx.sendIxs(group, { label: `lookup table (${lutSigs.length + 1}/${lut.instructionGroups.length})` }));
    logger.info({ lookupTables: lut.lookupTables.map((t) => t.toBase58()), addresses: lut.addresses, sigs: lutSigs }, 'lookup table(s) created');
    process.stdout.write(`LOOKUP_TABLE=${lut.lookupTables.map((t) => t.toBase58()).join(',')}\n`);
    } // end !resumeMint

    // 5) bootstrap
    const solAmount = typeof flags.sol === 'string' ? Number(flags.sol) : 0;
    if (solAmount > 0) {
      const solPrice = await ctx.sources.market.getSolPrice();
      const totalUsd = solAmount * solPrice;
      const assets = await chain.readAssets();
      const prices = await ctx.sources.market.getPrices(assets.map((a) => a.mint));
      let deposited = 0;
      for (const a of assets) {
        const w = selected.find((x) => x.mint === a.mint)?.weightBps ?? 0;
        if (w === 0) continue;
        const mintPk = new PublicKey(a.mint);
        const tokenProgram = new PublicKey(a.tokenProgram);
        const from = getAssociatedTokenAddressSync(mintPk, keeper.publicKey, false, tokenProgram);
        const vault = new PublicKey(a.vault);
        const balanceOf = async (acct: PublicKey): Promise<bigint> => {
          const r = await connection.getTokenAccountBalance(acct).catch(() => null);
          return r ? BigInt(r.value.amount) : 0n;
        };
        // Resume-safe: a vault that already holds tokens was deposited in an earlier run; a keeper ATA that already
        // holds tokens was bought in an earlier run (the deposit failed) and must not be bought again.
        const vaultBefore = await balanceOf(vault);
        if (vaultBefore > 0n) {
          deposited += (Number(vaultBefore) / 10 ** a.decimals) * (prices.get(a.mint) ?? 0);
          logger.info({ mint: a.mint, vaultBalance: vaultBefore.toString() }, 'bootstrap leg already deposited; skipping');
          continue;
        }
        let swapSig: string | null = null;
        let held = await balanceOf(from);
        if (held === 0n) {
          const lamportsIn = uiToBigint((solAmount * w) / 10_000, 9);
          const q = await ctx.sources.quotes.quote({ inputMint: WSOL_MINT, outputMint: a.mint, amount: lamportsIn, slippageBps: env.AP_SLIPPAGE_BPS });
          swapSig = await tx.sendVersioned(await ctx.sources.quotes.swapTx(q, keeper.publicKey.toBase58()), { label: `bootstrap buy ${a.mint}` });
          held = tx.dryRun ? q.outAmount : await balanceOf(from);
          if (held === 0n) throw new Error(`swap for ${a.mint} confirmed but no tokens arrived in ${from.toBase58()}`);
        } else {
          logger.info({ mint: a.mint, held: held.toString() }, 'keeper already holds this leg; depositing without re-buying');
        }
        // Deposit exactly what we hold (Jupiter delivers <= the quoted amount after slippage).
        const xferSig = await tx.sendIxs(
          [
            createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, vault, chain.fundPda, mintPk, tokenProgram),
            createTransferCheckedInstruction(from, mintPk, vault, keeper.publicKey, held, a.decimals, [], tokenProgram),
          ],
          { label: `bootstrap deposit ${a.mint}` },
        );
        deposited += (Number(held) / 10 ** a.decimals) * (prices.get(a.mint) ?? 0);
        logger.info({ mint: a.mint, swapSig, xferSig, amount: held.toString() }, 'bootstrap leg done');
      }
      // NAV/unit = $1.00 at inception
      const units = uiToBigint(deposited > 0 ? deposited : totalUsd, 6);
      // bootstrap_mint passes [Asset, vault] for every constituent; above ~12 assets it only fits with the lookup table.
      const lutAddrs = String(env.LOOKUP_TABLE ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const lookupTables = (await Promise.all(lutAddrs.map(async (a) => (await connection.getAddressLookupTable(new PublicKey(a))).value))).filter((t): t is NonNullable<typeof t> => t !== null);
      const sig = await tx.sendIxs(await chain.bootstrapMintIx(units, keeper.publicKey), { label: 'bootstrap_mint', lookupTables, computeUnits: 400_000 });
      logger.info({ units: units.toString(), sig, depositedUsd: deposited.toFixed(2) }, sig === DRY_RUN_SIG ? 'bootstrap simulated' : 'bootstrap minted');
      // The bootstrap units sit in the keeper (= fee_recipient) ATA; fee processing must not treat them as fees.
      process.stdout.write(`FEE_RESERVED_UNITS=${units.toString()}
`);
    } else {
      logger.info('no --sol given; skipping bootstrap (run bootstrap_mint manually after seeding vaults)');
    }
    await ctx.nav.snapshot();
  } finally {
    ctx.close();
  }
}

/**
 * Methodology dry run against live data + seed sizing -> markdown report for the index committee
 * (docs/launch-constituents.md). Read-only: no transaction is built or sent.
 */
async function launchReport(flags: Record<string, string | boolean>): Promise<void> {
  const seeds = String(flags.seed ?? '5,10,25,50').split(',').map(Number).filter((x) => x > 0);
  const alternates = typeof flags.alternates === 'string' ? Number(flags.alternates) : 20;
  const cgTopN = typeof flags['cg-top'] === 'string' ? Number(flags['cg-top']) : 40;
  const out = resolve(typeof flags.out === 'string' ? flags.out : '../../docs/launch-constituents.md');
  await withCtx({ ...flags, dry: true }, async (ctx) => {
    const t0 = Date.now();
    const universeSize = typeof flags.universe === 'string' ? Number(flags.universe) : ctx.cfg.universe.maxCandidates;
    const cgMode = ctx.cfg.universe.source !== 'jupiter';

    // Raw CoinGecko category order (what the website shows) before any screen, for the comparison section.
    let cgTop: CgTopRow[] | undefined;
    if (ctx.sources.coingecko) {
      const res = await ctx.sources.coingecko.resolve(Math.max(cgTopN, universeSize));
      const dropped = new Map(res.dropped.map((d) => [d.cgId, d]));
      const rows: CgTopRow[] = res.candidates.map((c) => ({ cgRank: c.cgRank, cgId: c.cgId, symbol: c.symbol, name: c.name, mint: c.mint, marketCapUsd: c.marketCapUsd, volume24hUsd: c.volume24hUsd }));
      for (const d of dropped.values()) rows.push({ cgRank: Number.MAX_SAFE_INTEGER, cgId: d.cgId, symbol: d.symbol.toUpperCase(), name: d.cgId, mint: null, marketCapUsd: null, volume24hUsd: null });
      cgTop = rows.sort((a, b) => a.cgRank - b.cgRank).slice(0, cgTopN);
      print({ coingeckoTop: cgTop.map((c) => `${c.cgRank === Number.MAX_SAFE_INTEGER ? '-' : c.cgRank}. ${c.symbol} (${c.cgId}) mcap=${c.marketCapUsd === null ? '?' : Math.round(c.marketCapUsd / 1e6) + 'M'} vol=${c.volume24hUsd === null ? '?' : Math.round(c.volume24hUsd / 1e6) + 'M'} ${c.mint ?? 'NO SOLANA MINT'}`), droppedNoMint: res.dropped });
    }

    const r = await ctx.methodology.run({ dry: true, universeSize });
    // Variant. CoinGecko universe: same candidates with the 24h volume floor lowered to $150k (the committee's
    // alternative threshold). Jupiter universe: the token must carry Jupiter's `meme` tag (membership in the CoinGecko
    // category already is that classification, so the tag variant is pointless there).
    const variantCfg = cgMode
      ? { ...ctx.cfg, eligibility: { ...ctx.cfg.eligibility, minVolume24hUsd: 150_000 } }
      : { ...ctx.cfg, eligibility: { ...ctx.cfg.eligibility, requireAnyTag: ['meme'] } };
    const variantRun = runMethodology(r.candidates, new Set(), variantCfg);
    const solPriceUsd = await ctx.sources.market.getSolPrice();
    const selected = r.run.selection.selected;
    const seedTargets = [...selected, ...variantRun.selection.selected.filter((s) => !selected.some((x) => x.mint === s.mint))];
    const n = Math.max(1, selected.length);
    const seedImpacts: SeedImpact[] = [];
    for (const seedSol of seeds) {
      const perAssetSol = seedSol / n;
      const lamports = uiToBigint(perAssetSol, 9);
      const impactBps = new Map<string, number | null>();
      await Promise.all(
        seedTargets.map(async (s) => {
          try {
            const q = await ctx.sources.quotes.quote({ inputMint: WSOL_MINT, outputMint: s.mint, amount: lamports, slippageBps: ctx.env.AP_SLIPPAGE_BPS });
            impactBps.set(s.mint, Math.round(q.priceImpactPct * 10_000));
          } catch (err) {
            logger.warn({ mint: s.mint, seedSol, err: (err as Error).message }, 'seed quote failed');
            impactBps.set(s.mint, null);
          }
        }),
      );
      seedImpacts.push({ seedSol, perAssetSol, impactBps });
      logger.info({ seedSol, perAssetSol }, 'seed sizing quoted');
    }
    const notes = [
      `Universe source: ${ctx.cfg.universe.source}${cgMode ? ` (CoinGecko category \`${ctx.cfg.universe.coingeckoCategory}\`, ${ctx.sources.coingecko?.base ?? ''}, ${ctx.env.COINGECKO_API_KEY ? 'keyed' : 'free tier, no key'}, ${ctx.sources.coingecko?.limiter.intervalMs ?? 0} ms spacing)` : ''}; ${r.universe} candidates evaluated.`,
      `Incumbents on-chain: ${r.run.selection.selected.filter((s) => !r.run.selection.added.includes(s.mint)).length} (a fresh fund has none; every selected token is an "add").`,
      `7-day average volume uses the 24h volume as proxy until the keeper has 3 daily observations (methodology 2.4).`,
      `Runtime ${((Date.now() - t0) / 1000).toFixed(0)} s; Jupiter calls are rate-limited to one per ${ctx.sources.jupiter?.limiter.intervalMs ?? 0} ms (${ctx.env.JUPITER_API_KEY ? 'api key' : 'free tier'}).`,
    ];
    const committeeNotes = !flags['fresh-notes'] && existsSync(out) ? extractCommitteeNotes(readFileSync(out, 'utf8')) : null;
    const md = renderLaunchReport({
      generatedAt: new Date().toISOString(),
      rpc: rpcUrl(ctx.env),
      jupiterBase: ctx.sources.jupiter?.apiBase ?? 'static',
      solPriceUsd,
      run: r.run,
      candidates: r.candidates,
      alternates,
      seeds: seedImpacts,
      variant: cgMode
        ? {
            label: 'minVolume24hUsd = $150k',
            description: 'Same candidates and screens, with the 24h DEX-volume floor lowered from $250k to $150k (the alternative the committee is considering so the index reaches closer to 40 names). Everything else (FDV, age, authorities, 2% impact, 7d volume) is unchanged.',
            run: variantRun,
          }
        : {
            label: 'Jupiter `meme` tag required',
            description: 'Methodology 2.5 excludes "governance / utility tokens of major protocols that are not memecoins" through the manual denylist. This variant makes that mechanical by additionally requiring the Jupiter token-list `meme` tag, so the committee can see which section-1 names are not memecoins and would need a denylist entry.',
            run: variantRun,
          },
      notes,
      committeeNotes: committeeNotes ?? undefined,
      cgTop,
    });
    print({ variantSelected: variantRun.selection.selected.map((s) => `${s.rank}. ${s.symbol}`) });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, md);
    print({
      out,
      universeSource: ctx.cfg.universe.source,
      universe: r.universe,
      eligible: r.run.eligible.filter((e) => e.eligible).length,
      selected: selected.map((s) => `${s.rank}. ${s.symbol}${s.cgRank ? ` (CG #${s.cgRank})` : ''}`),
      cgTopPassing: cgTop ? `${cgTop.filter((c) => c.mint && selected.some((s) => s.mint === c.mint)).length}/${cgTop.length}` : null,
      ineligibleReasons: r.run.eligible.filter((e) => !e.eligible).map((e) => `${e.symbol}: ${e.reasons.join(',')}`),
      seeds: seedImpacts.map((s) => ({ seedSol: s.seedSol, perAssetSol: s.perAssetSol, worstBps: Math.max(0, ...[...s.impactBps.values()].filter((v): v is number => v !== null)), unquoted: [...s.impactBps.values()].filter((v) => v === null).length })),
    });
  });
}

/**
 * Launch step 4: create the Meteora DAMM v2 INDEX/SOL pool seeded at NAV per unit (keeper wallet supplies
 * both sides; the SDK wraps the SOL). --dry simulates only. Prints METEORA_POOL for .env.
 */
async function createPool(flags: Record<string, string | boolean>): Promise<void> {
  const units = typeof flags.units === 'string' ? Number(flags.units) : 2_000;
  const configIndex = typeof flags.config === 'string' ? Number(flags.config) : 1;
  await withCtx(flags, async (ctx) => {
    const nav = await ctx.nav.snapshot(false);
    const priceSolPerUnit = typeof flags['price-sol'] === 'string' ? Number(flags['price-sol']) : nav.nav.navPerUnitUsd / nav.solPriceUsd;
    if (!(priceSolPerUnit > 0)) throw new Error(`cannot price the pool: navPerUnitUsd=${nav.nav.navPerUnitUsd} sol=${nav.solPriceUsd}; pass --price-sol`);
    const plan = await buildCreateIndexSolPool({
      connection: ctx.connection,
      creator: ctx.keeper.publicKey,
      indexMint: ctx.chain.indexMint,
      indexDecimals: INDEX_DECIMALS,
      indexAmount: uiToBigint(units, INDEX_DECIMALS),
      priceSolPerUnit,
      configIndex,
    });
    logger.info({ pool: plan.pool.toBase58(), config: plan.config.toBase58(), units, solNeeded: Number(plan.solLamports) / 1e9, navPerUnitUsd: nav.nav.navPerUnitUsd, priceSolPerUnit, impliedPriceSolPerUnit: plan.impliedPriceSolPerUnit }, 'pool plan');
    const sig = await ctx.tx.sendLegacy(plan.tx, { signers: [plan.positionNft], label: 'meteora create pool' });
    print({ sig, pool: plan.pool.toBase58(), position: plan.position.toBase58(), config: plan.config.toBase58(), units, solNeeded: Number(plan.solLamports) / 1e9, priceSolPerUnit: plan.impliedPriceSolPerUnit, dry: ctx.tx.dryRun });
    process.stdout.write(`METEORA_POOL=${plan.pool.toBase58()}
`);
  });
}

/** First non-flag argument after the command. */
function positional(argv: string[]): string | undefined {
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a) continue;
    if (a.startsWith('--')) {
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

async function cli(argv: string[]): Promise<void> {
  const { cmd, flags } = parseArgs(argv);
  switch (cmd) {
    case 'run': {
      const stop = await runMain();
      process.on('SIGINT', () => void stop().finally(() => process.exit(0)));
      process.on('SIGTERM', () => void stop().finally(() => process.exit(0)));
      return;
    }
    case 'init-fund':
      return initFund(flags);
    case 'methodology':
      return withCtx(flags, async (ctx) => {
        const r = await ctx.methodology.run({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN });
        print({
          universe: r.universe,
          eligible: r.run.eligible.filter((e) => e.eligible).length,
          ineligibleReasons: r.run.eligible.filter((e) => !e.eligible).map((e) => `${e.symbol}: ${e.reasons.join(',')}`).slice(0, 60),
          selected: r.run.selection.selected.map((s) => `${s.rank}. ${s.symbol}`),
          added: r.run.selection.added,
          removed: r.run.selection.removed,
          weights: r.run.weights,
          announced: r.announced,
          applied: r.applied,
        });
      });
    case 'rebalance':
      return withCtx(flags, async (ctx) => {
        await ctx.nav.snapshot();
        const r = await ctx.rebalancer.check({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN, force: Boolean(flags.force) });
        print(r);
      });
    case 'airdrop':
      return withCtx(flags, async (ctx) => {
        if (!ctx.flywheel) throw new Error('flywheel requires DEV_WALLET and COIN_MINT');
        await ctx.nav.snapshot();
        print(await ctx.flywheel.runCycle({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN }));
      });
    case 'fees':
      return withCtx(flags, async (ctx) => {
        await ctx.nav.snapshot();
        print(await ctx.fees.run({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN }));
      });
    case 'snapshot-holders':
      return withCtx(flags, async (ctx) => {
        const mint = typeof flags.mint === 'string' ? flags.mint : ctx.env.COIN_MINT;
        if (!mint) throw new Error('--mint or COIN_MINT required');
        const holders = await ctx.sources.holders.getHolders(mint);
        const supply = holders.reduce((s, h) => s + h.amount, 0n);
        const id = ctx.repo.insertHolderSnapshot(mint, supply, holders);
        print({ snapshotId: id, mint, holders: holders.length, supply: supply.toString(), top10: holders.slice(0, 10) });
      });
    case 'proposals':
      return withCtx(flags, async (ctx) => {
        await ctx.reconstitution.reconcileExecuted().catch(() => 0);
        const status = typeof flags.status === 'string' ? (flags.status as 'proposed') : undefined;
        print({ mode: ctx.reconstitution.mode, proposals: ctx.reconstitution.list(status) });
      });
    case 'approve': {
      const mint = positional(argv);
      if (!mint) throw new Error('usage: approve <mint> [--weight bps] [--immediate]');
      return withCtx(flags, async (ctx) =>
        print(await ctx.reconstitution.approve(mint, { weightBps: typeof flags.weight === 'string' ? Number(flags.weight) : undefined, immediate: Boolean(flags.immediate), dry: Boolean(flags.dry) || ctx.env.DRY_RUN })),
      );
    }
    case 'reject': {
      const mint = positional(argv);
      if (!mint) throw new Error('usage: reject <mint> [--note text]');
      return withCtx(flags, async (ctx) => print(ctx.reconstitution.reject(mint, typeof flags.note === 'string' ? flags.note : undefined)));
    }
    case 'add-asset': {
      const mint = positional(argv);
      if (!mint) throw new Error('usage: add-asset <mint> [--weight bps] [--immediate] [--force]');
      return withCtx(flags, async (ctx) =>
        print(
          await ctx.reconstitution.addAsset(mint, {
            weightBps: typeof flags.weight === 'string' ? Number(flags.weight) : undefined,
            immediate: Boolean(flags.immediate),
            force: Boolean(flags.force),
            dry: Boolean(flags.dry) || ctx.env.DRY_RUN,
          }),
        ),
      );
    }
    case 'remove-asset': {
      const mint = positional(argv);
      if (!mint) throw new Error('usage: remove-asset <mint> [--immediate]');
      return withCtx(flags, async (ctx) => print(await ctx.reconstitution.removeAsset(mint, { immediate: Boolean(flags.immediate), dry: Boolean(flags.dry) || ctx.env.DRY_RUN })));
    }
    case 'governance':
      return withCtx(flags, async (ctx) => print(await ctx.provider.governance()));
    case 'execute-actions':
      return withCtx(flags, async (ctx) => print(await ctx.governance.executeDue({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN })));
    case 'queue-approved':
      return withCtx(flags, async (ctx) => print(await ctx.reconstitution.queueApproved({ dry: Boolean(flags.dry) || ctx.env.DRY_RUN })));
    case 'set-ref-prices':
      return withCtx(flags, async (ctx) => {
        const nav = await ctx.nav.snapshot(false);
        print(await ctx.refPrices.update(nav, { dry: Boolean(flags.dry) || ctx.env.DRY_RUN }));
      });
    case 'launch-report':
      return launchReport(flags);
    case 'create-pool':
      return createPool(flags);
    case 'jobs':
      return withCtx(flags, async (ctx) => {
        registerJobs(ctx);
        print(ctx.scheduler.status());
      });
    default:
      process.stdout.write(
        [
          'keeper <command> [flags]',
          '  init-fund [--sol <amount>] [--basket <json>] [--resume <index mint>] [--dry]',
          '  run',
          '  methodology [--dry]',
          '  rebalance [--dry] [--force]',
          '  airdrop [--dry]',
          '  fees [--dry]',
          '  snapshot-holders [--mint <mint>]',
          '  proposals [--status proposed|approved|rejected|queued|executed]',
          '  approve <mint> [--weight bps] [--immediate]',
          '  reject <mint> [--note text]',
          '  add-asset <mint> [--weight bps] [--immediate] [--force]',
          '  remove-asset <mint> [--immediate]',
          '  governance',
          '  execute-actions [--dry]',
          '  queue-approved [--dry]',
          '  set-ref-prices [--dry]',
          '  launch-report [--out path] [--seed 5,10,25,50] [--alternates 20] [--universe 150] [--cg-top 40] [--fresh-notes]',
          '  create-pool [--units 2000] [--config 1] [--price-sol x] [--dry]',
          '  jobs',
        ].join('\n') + '\n',
      );
  }
}

cli(process.argv.slice(2)).catch((err: Error) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'command failed');
  process.exit(1);
});
