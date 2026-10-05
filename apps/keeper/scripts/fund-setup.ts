#!/usr/bin/env tsx
/**
 * Cluster-aware fund bootstrap for the FI6900 e2e loop (docs/localnet-e2e.md, docs/devnet.md).
 *
 *   pnpm e2e:setup                                   localnet (solana-test-validator at 127.0.0.1:8899)
 *   pnpm e2e:setup:devnet                            devnet (https://api.devnet.solana.com)
 *   tsx scripts/fund-setup.ts --cluster devnet --rpc <url> [--assets 12] [--no-metadata] [--timelock 0]
 *
 * Against a cluster where the fi6900 program is deployed this script:
 *   1. loads/creates the keeper (authority, rebalancer, fee_recipient), an AP and a browser "burner" test wallet
 *      (`keypairs/keeper.json` ... on localnet, `keypairs/<cluster>-keeper.json` ... elsewhere); airdrops on localnet,
 *      requires pre-funded wallets elsewhere (`solana airdrop` on devnet is rate limited);
 *   2. creates N SPL mints with memecoin-like symbols (+ Metaplex token metadata unless --no-metadata), mints
 *      inventory to keeper (4x vault seed), AP and burner (0.2x each) and revokes mint/freeze authority;
 *   3. creates the 6-decimal index mint, `initialize_fund(50,50,100, timelock)`, `add_asset` x N equal weight,
 *      `set_ref_price` x N from the static price file (auction price bounds);
 *   4. creates the fund address lookup table(s);
 *   5. transfers an equal-USD basket into the vaults (NAV = $1.00/unit) and `bootstrap_mint`s 1,000,000 units;
 *   6. writes `keypairs/<cluster>-prices.json` (STATIC_PRICES_JSON), `apps/keeper/.env.<cluster>`,
 *      `apps/web/.env.<cluster>` (+ `apps/web/.env.local`), `keypairs/<cluster>.json` (addresses + signatures).
 *
 * The mainnet launch path is `keeper init-fund` (docs/launch-runbook.md), which buys the basket through Jupiter.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { Fi6900Client, PROGRAM_ID, usdToRefPriceQ64 } from '@fi6900/sdk';

type Cluster = 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta';

/* ------------------------------------------------------------------ args ---- */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const CLUSTER = (flag('cluster') ?? process.env.CLUSTER ?? 'localnet') as Cluster;
const DEFAULT_RPC: Record<Cluster, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};
const RPC_URL = flag('rpc') ?? process.env.RPC_URL ?? DEFAULT_RPC[CLUSTER];
const IS_LOCAL = CLUSTER === 'localnet';
const ASSET_COUNT = Number(flag('assets') ?? (IS_LOCAL ? 8 : 12));
const WITH_METADATA = has('metadata') || (!has('no-metadata') && !IS_LOCAL);
/** Admin timelock: 0 = direct admin ixs (tests / e2e / pre-launch). Mainnet uses 432_000 (~48h). */
const TIMELOCK_SLOTS = BigInt(flag('timelock') ?? process.env.LOCALNET_TIMELOCK_SLOTS ?? '0');
/** Bearer token for the keeper's POST /v1/admin/*. */
const ADMIN_TOKEN = process.env.LOCALNET_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? (IS_LOCAL ? 'localnet-admin' : randomBytes(24).toString('hex'));
/** Between transactions on public clusters (rate limits). */
const PACE_MS = IS_LOCAL ? 0 : Number(flag('pace') ?? 400);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const KEYPAIRS = resolve(ROOT, 'keypairs');
const PREFIX = IS_LOCAL ? '' : `${CLUSTER}-`;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const TARGET_NAV_USD = 1_000_000; // 1,000,000 units @ $1.00
const UNITS = 1_000_000n * 1_000_000n; // raw, 6 decimals

interface AssetDef {
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  change24hPct: number;
}

/** Fake constituents. Keep seed*4 < u64::MAX (why BONK uses 6 decimals here).
 * Symbols mirror real memecoins only so the UI looks realistic; the mints are test mints on this cluster. */
const ALL_ASSETS: AssetDef[] = [
  { symbol: 'WIF', name: 'dogwifhat', decimals: 6, priceUsd: 1.25, volume24hUsd: 60_000_000, marketCapUsd: 1_250_000_000, liquidityUsd: 25_000_000, change24hPct: 3.4 },
  { symbol: 'BONK', name: 'Bonk', decimals: 6, priceUsd: 0.00002, volume24hUsd: 45_000_000, marketCapUsd: 1_500_000_000, liquidityUsd: 30_000_000, change24hPct: -1.2 },
  { symbol: 'POPCAT', name: 'Popcat', decimals: 9, priceUsd: 0.45, volume24hUsd: 30_000_000, marketCapUsd: 440_000_000, liquidityUsd: 12_000_000, change24hPct: 5.8 },
  { symbol: 'MEW', name: 'cat in a dogs world', decimals: 6, priceUsd: 0.0045, volume24hUsd: 20_000_000, marketCapUsd: 400_000_000, liquidityUsd: 9_000_000, change24hPct: -2.7 },
  { symbol: 'GIGA', name: 'Gigachad', decimals: 6, priceUsd: 0.03, volume24hUsd: 12_000_000, marketCapUsd: 280_000_000, liquidityUsd: 6_000_000, change24hPct: 0.9 },
  { symbol: 'PNUT', name: 'Peanut the Squirrel', decimals: 6, priceUsd: 0.35, volume24hUsd: 25_000_000, marketCapUsd: 350_000_000, liquidityUsd: 8_000_000, change24hPct: 7.1 },
  { symbol: 'FARTCOIN', name: 'Fartcoin', decimals: 9, priceUsd: 0.9, volume24hUsd: 70_000_000, marketCapUsd: 900_000_000, liquidityUsd: 20_000_000, change24hPct: -4.3 },
  { symbol: 'MOODENG', name: 'Moo Deng', decimals: 6, priceUsd: 0.12, volume24hUsd: 15_000_000, marketCapUsd: 120_000_000, liquidityUsd: 4_000_000, change24hPct: 2.2 },
  { symbol: 'GOAT', name: 'Goatseus Maximus', decimals: 6, priceUsd: 0.28, volume24hUsd: 18_000_000, marketCapUsd: 280_000_000, liquidityUsd: 7_000_000, change24hPct: -6.1 },
  { symbol: 'PENGU', name: 'Pudgy Penguins', decimals: 6, priceUsd: 0.016, volume24hUsd: 40_000_000, marketCapUsd: 1_000_000_000, liquidityUsd: 15_000_000, change24hPct: 1.7 },
  { symbol: 'AI16Z', name: 'ai16z', decimals: 9, priceUsd: 0.21, volume24hUsd: 22_000_000, marketCapUsd: 230_000_000, liquidityUsd: 5_000_000, change24hPct: 9.4 },
  { symbol: 'SPX', name: 'SPX6900', decimals: 8, priceUsd: 0.65, volume24hUsd: 28_000_000, marketCapUsd: 600_000_000, liquidityUsd: 9_500_000, change24hPct: 4.9 },
];

const log = (msg: string, extra: Record<string, unknown> = {}): void => {
  process.stdout.write(`${new Date().toISOString()} ${msg}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}\n`);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify([...kp.secretKey]));
  return kp;
}

function uiToRaw(ui: number, decimals: number): bigint {
  return BigInt(Math.round(ui * 10 ** decimals));
}

/* ------------------------------------------------- Metaplex token metadata ---- */
function metadataPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];
}

function borshString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
}

/** `CreateMetadataAccountV3` (discriminator 33) hand-serialised so the script needs no extra dependency. */
function createMetadataV3Ix(args: { mint: PublicKey; authority: PublicKey; payer: PublicKey; name: string; symbol: string; uri: string }): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([33]),
    borshString(args.name.slice(0, 32)),
    borshString(args.symbol.slice(0, 10)),
    borshString(args.uri.slice(0, 200)),
    Buffer.from([0, 0]), // seller_fee_basis_points u16
    Buffer.from([0]), // creators: None
    Buffer.from([0]), // collection: None
    Buffer.from([0]), // uses: None
    Buffer.from([1]), // is_mutable
    Buffer.from([0]), // collection_details: None
  ]);
  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(args.mint), isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* ------------------------------------------------------------------ main ---- */
async function main(): Promise<void> {
  mkdirSync(KEYPAIRS, { recursive: true });
  const ASSETS = ALL_ASSETS.slice(0, ASSET_COUNT);
  const WEIGHT_BPS = Math.floor(10_000 / ASSETS.length);
  const connection = new Connection(RPC_URL, 'confirmed');
  const version = await connection.getVersion();
  log('connected', { cluster: CLUSTER, rpc: RPC_URL, version: version['solana-core'], assets: ASSETS.length, metadata: WITH_METADATA });
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo?.executable) throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed on ${RPC_URL}`);

  const keeper = loadOrCreateKeypair(resolve(KEYPAIRS, `${PREFIX}keeper.json`));
  const ap = loadOrCreateKeypair(resolve(KEYPAIRS, `${PREFIX}ap.json`));
  const burner = loadOrCreateKeypair(resolve(KEYPAIRS, `${PREFIX}burner.json`));
  log('keypairs', { keeper: keeper.publicKey.toBase58(), ap: ap.publicKey.toBase58(), burner: burner.publicKey.toBase58() });

  /** send with retries (public devnet RPCs rate-limit and drop blockhashes). */
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = [keeper], label = ''): Promise<string> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, { commitment: 'confirmed', maxRetries: 5 });
        log(`tx ${label}`, { sig });
        if (PACE_MS) await sleep(PACE_MS);
        return sig;
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message ?? String(err);
        // "already processed" after a retry = success we missed; a custom program error will not go away.
        if (/already been processed/i.test(msg)) break;
        if (/custom program error|InstructionError/i.test(msg) && !/429|Too Many/i.test(msg)) throw err;
        log(`retry ${label}`, { attempt, err: msg.slice(0, 160) });
        await sleep(1500 * attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  // 1) wallets
  const wants: [string, Keypair, number][] = [
    ['keeper', keeper, IS_LOCAL ? 500 : 1.5],
    ['ap', ap, IS_LOCAL ? 100 : 0.3],
    ['burner', burner, IS_LOCAL ? 100 : 0.3],
  ];
  for (const [who, kp, sol] of wants) {
    const bal = await connection.getBalance(kp.publicKey);
    if (bal >= sol * LAMPORTS_PER_SOL) continue;
    if (IS_LOCAL) {
      const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, 'confirmed');
      log(`airdrop ${who}`, { sol, sig });
    } else if (who === 'keeper') {
      throw new Error(`${who} ${kp.publicKey.toBase58()} has ${bal / LAMPORTS_PER_SOL} SOL; needs >= ${sol} on ${CLUSTER} (solana airdrop / faucet.solana.com)`);
    } else {
      // top the test wallets up from the keeper so the script is self-contained once the keeper is funded
      const top = Math.round(sol * LAMPORTS_PER_SOL) - bal;
      await send([SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: kp.publicKey, lamports: top })], [keeper], `fund ${who} ${top / LAMPORTS_PER_SOL} SOL`);
    }
  }

  // 2) constituent mints
  const sigs: Record<string, string> = {};
  const mints: { def: AssetDef; mint: PublicKey; seedRaw: bigint }[] = [];
  const perAssetUsd = TARGET_NAV_USD / ASSETS.length;
  const mintLamports = await getMinimumBalanceForRentExemptMint(connection);
  for (const def of ASSETS) {
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    const seedRaw = uiToRaw(perAssetUsd / def.priceUsd, def.decimals);
    const createIxs: TransactionInstruction[] = [
      SystemProgram.createAccount({ fromPubkey: keeper.publicKey, newAccountPubkey: mint, lamports: mintLamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(mint, def.decimals, keeper.publicKey, null, TOKEN_PROGRAM_ID),
    ];
    if (WITH_METADATA) {
      createIxs.push(createMetadataV3Ix({ mint, authority: keeper.publicKey, payer: keeper.publicKey, name: `${def.name} (${CLUSTER})`, symbol: def.symbol, uri: '' }));
    }
    sigs[`create_mint ${def.symbol}`] = await send(createIxs, [keeper, mintKp], `create mint ${def.symbol}${WITH_METADATA ? ' + metadata' : ''}`);

    // keeper: vault seed + 3x inventory (auction fills); AP and burner: 20% of the vault for in-kind creations / fills
    const holders: [PublicKey, bigint][] = [
      [keeper.publicKey, seedRaw * 4n],
      [ap.publicKey, seedRaw / 5n],
      [burner.publicKey, seedRaw / 5n],
    ];
    const distIxs: TransactionInstruction[] = [];
    for (const [owner, amount] of holders) {
      const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
      distIxs.push(createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID));
      distIxs.push(createMintToInstruction(mint, ata, keeper.publicKey, amount, [], TOKEN_PROGRAM_ID));
    }
    distIxs.push(createSetAuthorityInstruction(mint, keeper.publicKey, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID));
    sigs[`distribute+revoke ${def.symbol}`] = await send(distIxs, [keeper], `mint inventory + revoke mint authority ${def.symbol}`);
    mints.push({ def, mint, seedRaw });
    log('mint created', { symbol: def.symbol, mint: mint.toBase58(), decimals: def.decimals, seedUi: Number(seedRaw) / 10 ** def.decimals });
  }

  // 3) index mint + fund
  const indexMintKp = Keypair.generate();
  const indexMint = indexMintKp.publicKey;
  const client = new Fi6900Client(connection, indexMint);
  const indexCreateIxs: TransactionInstruction[] = [
    SystemProgram.createAccount({ fromPubkey: keeper.publicKey, newAccountPubkey: indexMint, lamports: mintLamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(indexMint, 6, keeper.publicKey, null, TOKEN_PROGRAM_ID),
  ];
  if (WITH_METADATA) indexCreateIxs.push(createMetadataV3Ix({ mint: indexMint, authority: keeper.publicKey, payer: keeper.publicKey, name: `FI6900 Index (${CLUSTER})`, symbol: 'FI6900', uri: '' }));
  sigs.create_index_mint = await send(indexCreateIxs, [keeper, indexMintKp], 'create index mint');
  sigs.initialize_fund = await send([await client.initializeFundIx(keeper.publicKey, 50, 50, 100, TIMELOCK_SLOTS)], [keeper], `initialize_fund (timelock ${TIMELOCK_SLOTS})`);
  for (const m of mints) {
    sigs[`add_asset ${m.def.symbol}`] = await send([await client.addAssetIx(keeper.publicKey, m.mint, WEIGHT_BPS, TOKEN_PROGRAM_ID)], [keeper], `add_asset ${m.def.symbol} (${WEIGHT_BPS} bps)`);
  }

  // 3b) reference prices from the static price file (Q64.64 nano-USD per raw unit); first value is authority-only
  for (let i = 0; i < mints.length; i += 8) {
    const chunk = mints.slice(i, i + 8);
    const ixs = await Promise.all(chunk.map((m) => client.setRefPriceIx(keeper.publicKey, m.mint, usdToRefPriceQ64(m.def.priceUsd, m.def.decimals))));
    sigs[`set_ref_prices ${i / 8 + 1}`] = await send(ixs, [keeper], `set_ref_price x${ixs.length}`);
  }

  // 4) lookup table(s)
  const lut = await client.createFundLookupTable(keeper.publicKey);
  let i = 0;
  for (const group of lut.instructionGroups) sigs[`lookup_table ${++i}`] = await send(group, [keeper], `lookup table ${i}/${lut.instructionGroups.length}`);
  client.lookupTables = lut.lookupTables;
  // address lookup tables are usable one slot after the last extension
  await sleep(IS_LOCAL ? 1000 : 3000);

  // 5) seed vaults + bootstrap
  const assets = await client.readAssets();
  for (const m of mints) {
    const a = assets.find((x) => x.mint.equals(m.mint));
    if (!a) throw new Error(`asset ${m.def.symbol} missing after add_asset`);
    const from = getAssociatedTokenAddressSync(m.mint, keeper.publicKey, true, TOKEN_PROGRAM_ID);
    sigs[`seed ${m.def.symbol}`] = await send(
      [createTransferCheckedInstruction(from, m.mint, a.vault, keeper.publicKey, m.seedRaw, m.def.decimals, [], TOKEN_PROGRAM_ID)],
      [keeper],
      `seed vault ${m.def.symbol}`,
    );
  }
  const keeperIndexAta = getAssociatedTokenAddressSync(indexMint, keeper.publicKey, true, TOKEN_PROGRAM_ID);
  sigs.bootstrap_mint = await send(
    [
      createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, keeperIndexAta, keeper.publicKey, indexMint, TOKEN_PROGRAM_ID),
      await client.bootstrapMintIx(keeper.publicKey, UNITS, keeperIndexAta),
    ],
    [keeper],
    'bootstrap_mint 1,000,000 units',
  );
  const supply = await client.readSupply();
  const fund = await client.readFund();

  // 6) write config
  const prices: Record<string, unknown> = {
    [WSOL_MINT]: { symbol: 'SOL', name: 'Solana', priceUsd: 150, decimals: 9 },
    // the methodology's liquidity screen quotes a sell into USDC; the static quote source needs its price
    [USDC_MINT]: { symbol: 'USDC', name: 'USD Coin', priceUsd: 1, decimals: 6 },
  };
  for (const m of mints) {
    prices[m.mint.toBase58()] = {
      symbol: m.def.symbol,
      name: `${m.def.name} (${CLUSTER})`,
      decimals: m.def.decimals,
      priceUsd: m.def.priceUsd,
      volume24hUsd: m.def.volume24hUsd,
      marketCapUsd: m.def.marketCapUsd,
      fdvUsd: m.def.marketCapUsd,
      liquidityUsd: m.def.liquidityUsd,
      change24hPct: m.def.change24hPct,
      pairCreatedAt: Date.now() - 120 * 86_400_000,
    };
  }
  const pricesPath = resolve(KEYPAIRS, `${CLUSTER}-prices.json`);
  writeFileSync(pricesPath, JSON.stringify(prices, null, 2));

  const keeperEnvPath = resolve(ROOT, `apps/keeper/.env.${CLUSTER}`);
  const envKeeper = [
    `# generated by scripts/fund-setup.ts -- ${CLUSTER} (${new Date().toISOString()})`,
    `ENV_FILE=.env.${CLUSTER}`, // lets scripts/localnet-ap.ts pick keypairs/${PREFIX}ap.json when loaded via --env-file
    'MOCK_MODE=false',
    'DRY_RUN=false',
    'LOG_LEVEL=info',
    `RPC_URL=${RPC_URL}`,
    'COMMITMENT=confirmed',
    `KEEPER_KEYPAIR=../../keypairs/${PREFIX}keeper.json`,
    `INDEX_MINT=${indexMint.toBase58()}`,
    `LOOKUP_TABLE=${lut.lookupTables.map((t) => t.toBase58()).join(',')}`,
    'PRICE_SOURCE=static',
    `STATIC_PRICES_JSON=../../keypairs/${CLUSTER}-prices.json`,
    `DB_PATH=./data/${CLUSTER}.db`,
    'PORT=8787',
    'CORS_ORIGIN=*',
    'PRIORITY_FEE_MICROLAMPORTS=0',
    `NAV_SNAPSHOT_SEC=${IS_LOCAL ? 10 : 30}`,
    `REBALANCE_CHECK_SEC=${IS_LOCAL ? 30 : 60}`,
    `AUCTION_MONITOR_SEC=${IS_LOCAL ? 5 : 15}`,
    'AP_CHECK_SEC=30',
    'AP_ENABLED=false',
    'FLYWHEEL_ENABLED=false',
    'RECONSTITUTION_MODE=manual',
    'RECON_REJECT_COOLDOWN_DAYS=90',
    'REF_PRICE_UPDATES=true',
    `ACTION_EXECUTE_SEC=${IS_LOCAL ? 10 : 60}`,
    `ADMIN_TOKEN=${ADMIN_TOKEN}`,
    `FEE_RESERVED_UNITS=${UNITS.toString()}`, // bootstrap units in the keeper ATA are not fees
    '',
  ].join('\n');
  writeFileSync(keeperEnvPath, envKeeper);

  const webEnv = [
    `# generated by scripts/fund-setup.ts -- ${CLUSTER}`,
    `NEXT_PUBLIC_API_URL=${process.env.WEB_API_URL ?? 'http://localhost:8787'}`,
    `NEXT_PUBLIC_RPC_URL=${RPC_URL}`,
    `NEXT_PUBLIC_CLUSTER=${CLUSTER}`,
    `NEXT_PUBLIC_INDEX_MINT=${indexMint.toBase58()}`,
    'NEXT_PUBLIC_COIN_MINT=',
    `NEXT_PUBLIC_PROGRAM_ID=${PROGRAM_ID.toBase58()}`,
    `NEXT_PUBLIC_LOOKUP_TABLE=${lut.lookupTables[0]!.toBase58()}`,
    '',
  ].join('\n');
  const webEnvPath = resolve(ROOT, `apps/web/.env.${CLUSTER}`);
  writeFileSync(webEnvPath, webEnv);
  if (!has('no-web-env-local')) writeFileSync(resolve(ROOT, 'apps/web/.env.local'), webEnv);

  const summary = {
    cluster: CLUSTER,
    rpc: RPC_URL,
    createdAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    keeper: keeper.publicKey.toBase58(),
    ap: ap.publicKey.toBase58(),
    burner: burner.publicKey.toBase58(),
    indexMint: indexMint.toBase58(),
    fund: client.fund.toBase58(),
    lookupTable: lut.lookupTables[0]!.toBase58(),
    lookupTables: lut.lookupTables.map((t) => t.toBase58()),
    supply: supply.toString(),
    assetCount: fund.assetCount,
    weightBps: WEIGHT_BPS,
    timelockSlots: fund.timelockSlots.toString(),
    maxAuctionDiscountBps: fund.maxAuctionDiscountBps,
    adminToken: ADMIN_TOKEN,
    assets: mints.map((m) => ({ symbol: m.def.symbol, mint: m.mint.toBase58(), metadata: WITH_METADATA ? metadataPda(m.mint).toBase58() : null, decimals: m.def.decimals, vaultSeed: m.seedRaw.toString(), priceUsd: m.def.priceUsd })),
    signatures: sigs,
    files: { prices: pricesPath, keeperEnv: keeperEnvPath, webEnv: webEnvPath },
  };
  const summaryPath = resolve(KEYPAIRS, `${CLUSTER}.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  process.stdout.write(
    `\nCLUSTER=${CLUSTER}\nINDEX_MINT=${indexMint.toBase58()}\nFUND=${client.fund.toBase58()}\nLOOKUP_TABLE=${summary.lookupTable}\nSUPPLY=${supply.toString()}\nBURNER=${burner.publicKey.toBase58()}\nADMIN_TOKEN=${ADMIN_TOKEN}\n`,
  );
  process.stdout.write(`summary written to ${summaryPath}\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`fund-setup failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
