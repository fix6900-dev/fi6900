#!/usr/bin/env tsx
/**
 * Localnet "authorized participant" + e2e helpers, driven by the SDK with `keypairs/ap.json`.
 *
 *   pnpm e2e:ap status                      supply, vault balances, weights (from static prices)
 *   pnpm e2e:ap create <units>              in-kind creation via buildMintTxs (begin -> deposits -> finalize)
 *   pnpm e2e:ap redeem <units>              in-kind redemption via buildRedeemTxs (begin -> withdraws -> close)
 *   pnpm e2e:ap set-price <SYMBOL> <usd>    perturb the static price file (the running keeper hot-reloads it)
 *   pnpm e2e:ap fill                        act as a third-party filler for every open auction (AP wallet)
 *
 * Reads apps/keeper/.env.localnet (written by fund-setup.ts); `ENV_FILE=.env.devnet` targets the devnet fund
 * (the AP keypair then defaults to keypairs/devnet-ap.json; override with AP_KEYPAIR=<path>). Prints every signature.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type VersionedTransaction } from '@solana/web3.js';
import { AuctionStatus, Fi6900Client, auctionPriceAt, buyAmountFor, fromQ64 } from '@fi6900/sdk';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const KEEPER_DIR = resolve(ROOT, 'apps/keeper');
const ENV_FILE = process.env.ENV_FILE ?? '.env.localnet';
loadDotenv({ path: resolve(KEEPER_DIR, ENV_FILE) });
/** `.env.devnet` -> `devnet-`, `.env.localnet` -> `` (keypair file prefix, mirrors fund-setup.ts). */
const CLUSTER = ENV_FILE.replace(/^.*\.env\./, '');
const PREFIX = CLUSTER === 'localnet' || !CLUSTER ? '' : `${CLUSTER}-`;

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
const INDEX_MINT = process.env.INDEX_MINT;
const LOOKUP_TABLE = process.env.LOOKUP_TABLE;
const PRICES_PATH = resolve(KEEPER_DIR, process.env.STATIC_PRICES_JSON ?? '../../keypairs/localnet-prices.json');
/** `--as keeper` signs with keypairs/keeper.json instead of the AP (used to re-seed after experiments). */
const AS_KEEPER = process.argv.includes('--as') && process.argv[process.argv.indexOf('--as') + 1] === 'keeper';
const AP_KEYPAIR = AS_KEEPER
  ? resolve(KEEPER_DIR, process.env.KEEPER_KEYPAIR ?? `../../keypairs/${PREFIX}keeper.json`)
  : process.env.AP_KEYPAIR
    ? resolve(ROOT, process.env.AP_KEYPAIR)
    : resolve(ROOT, `keypairs/${PREFIX}ap.json`);

const out = (v: unknown): void => void process.stdout.write(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2) + '\n');

interface PriceRec {
  symbol?: string;
  priceUsd: number;
  decimals?: number;
}

function loadPrices(): Record<string, PriceRec> {
  return JSON.parse(readFileSync(PRICES_PATH, 'utf8')) as Record<string, PriceRec>;
}

async function sendV0(connection: Connection, txs: VersionedTransaction[], signer: Keypair, label: string): Promise<string[]> {
  const sigs: string[] = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i]!;
    tx.sign([signer]);
    const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
    const bh = await connection.getLatestBlockhash('confirmed');
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
    if (conf.value.err) throw new Error(`${label} tx ${i + 1}/${txs.length} failed: ${JSON.stringify(conf.value.err)} (${sig})`);
    process.stdout.write(`${label} tx ${i + 1}/${txs.length} ${sig}\n`);
    sigs.push(sig);
  }
  return sigs;
}

async function snapshot(client: Fi6900Client): Promise<{ supply: bigint; holdings: { symbol: string; mint: string; vault: string; effective: bigint; ratio: string; weightBps: number; targetWeightBps: number }[]; navUsd: number }> {
  const prices = loadPrices();
  const [supply, rows] = await Promise.all([client.readSupply(), client.readEffectiveBalances()]);
  let navUsd = 0;
  const vals = rows.map((r) => {
    const p = prices[r.asset.mint.toBase58()];
    const v = (Number(r.effective) / 10 ** r.asset.decimals) * (p?.priceUsd ?? 0);
    navUsd += v;
    return v;
  });
  return {
    supply,
    navUsd,
    holdings: rows.map((r, i) => ({
      symbol: prices[r.asset.mint.toBase58()]?.symbol ?? r.asset.mint.toBase58().slice(0, 4),
      mint: r.asset.mint.toBase58(),
      vault: r.asset.vault.toBase58(),
      effective: r.effective,
      // effective / supply, 12 dp -- must be invariant across in-kind create/redeem
      ratio: supply > 0n ? ((r.effective * 10n ** 12n) / supply).toString() : '0',
      weightBps: navUsd > 0 ? Math.round(((vals[i] ?? 0) / navUsd) * 10_000) : 0,
      targetWeightBps: r.asset.targetWeightBps,
    })),
  };
}

async function main(): Promise<void> {
  const [cmd = 'status', ...args] = process.argv.slice(2).filter((a, i, arr) => a !== '--as' && arr[i - 1] !== '--as');
  if (cmd === 'set-price') {
    const [symbol, usd] = args;
    if (!symbol || !usd) throw new Error('usage: set-price <SYMBOL> <priceUsd>');
    const prices = loadPrices();
    const entry = Object.entries(prices).find(([, r]) => r.symbol?.toUpperCase() === symbol.toUpperCase());
    if (!entry) throw new Error(`symbol ${symbol} not in ${PRICES_PATH}`);
    const before = entry[1].priceUsd;
    entry[1].priceUsd = Number(usd);
    writeFileSync(PRICES_PATH, JSON.stringify(prices, null, 2));
    out({ symbol: entry[1].symbol, mint: entry[0], before, after: entry[1].priceUsd, file: PRICES_PATH });
    return;
  }

  if (!INDEX_MINT) throw new Error('INDEX_MINT missing; run localnet-setup first');
  const connection = new Connection(RPC_URL, 'confirmed');
  const ap = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(AP_KEYPAIR, 'utf8')) as number[]));
  const client = new Fi6900Client(connection, new PublicKey(INDEX_MINT), { lookupTable: LOOKUP_TABLE ? new PublicKey(LOOKUP_TABLE) : undefined });

  switch (cmd) {
    case 'status': {
      const fund = await client.readFund();
      const s = await snapshot(client);
      out({ ap: ap.publicKey.toBase58(), fund: client.fund.toBase58(), epoch: fund.epoch, openAuctions: fund.openAuctions, ...s, apUnits: await tokenBalance(connection, client.indexAta(ap.publicKey)) });
      return;
    }
    case 'create':
    case 'redeem': {
      const unitsUi = Number(args[0] ?? '0');
      if (!(unitsUi > 0)) throw new Error(`usage: ${cmd} <units>`);
      const units = BigInt(Math.round(unitsUi * 1e6));
      const before = await snapshot(client);
      const apBefore = await tokenBalance(connection, client.indexAta(ap.publicKey));
      const txs = cmd === 'create' ? await client.buildMintTxs(ap.publicKey, units) : await client.buildRedeemTxs(ap.publicKey, units);
      const sigs = await sendV0(connection, txs, ap, cmd);
      const after = await snapshot(client);
      const apAfter = await tokenBalance(connection, client.indexAta(ap.publicKey));
      const fund = await client.readFund();
      const feeBps = cmd === 'create' ? fund.mintFeeBps : fund.redeemFeeBps;
      const fee = (units * BigInt(feeBps)) / 10_000n;
      // Supply also grows by the management fee accrued in the prelude ix (1%/yr, minted to fee_recipient);
      // that dilutes effective/supply uniformly, so the invariant is "ratio change <= accrual dilution + rounding".
      const signedUnits = cmd === 'create' ? units : -(units - fee);
      const accruedUnits = after.supply - before.supply - signedUnits;
      const dilution = Number(accruedUnits) / Number(after.supply);
      const ratiosUnchanged = before.holdings.every((h, i) => {
        const a = after.holdings[i]!;
        const rel = Math.abs(Number(BigInt(h.ratio) - BigInt(a.ratio))) / Number(BigInt(h.ratio));
        return rel <= dilution + 1e-8; // ceil/floor rounding of per-slot amounts (noticeable when units >> supply)
      });
      out({
        action: cmd,
        units: units.toString(),
        feeUnits: fee.toString(),
        txCount: txs.length,
        signatures: sigs,
        supplyBefore: before.supply.toString(),
        supplyAfter: after.supply.toString(),
        supplyDelta: (after.supply - before.supply).toString(),
        mgmtFeeAccruedUnits: accruedUnits.toString(),
        accrualDilution: dilution,
        apUnitsBefore: apBefore.toString(),
        apUnitsAfter: apAfter.toString(),
        vaultRatiosUnchanged: ratiosUnchanged,
        holdings: after.holdings.map((h, i) => ({ symbol: h.symbol, effectiveBefore: before.holdings[i]!.effective.toString(), effectiveAfter: h.effective.toString(), ratioBefore: before.holdings[i]!.ratio, ratioAfter: h.ratio })),
      });
      return;
    }
    case 'fill': {
      const open = await client.readAuctions(AuctionStatus.Open);
      if (open.length === 0) {
        out({ filled: [], note: 'no open auctions' });
        return;
      }
      const assets = await client.readAssets();
      const slot = BigInt(await connection.getSlot());
      const results: unknown[] = [];
      for (const a of open) {
        // Auctions last `durationSlots` (150 ≈ 60 s on devnet); an ended one is still "open" on-chain until the keeper cancels it.
        if (slot > a.endSlot) {
          results.push({ auction: a.address.toBase58(), skipped: `ended at slot ${a.endSlot} (now ${slot})` });
          continue;
        }
        const sellAsset = assets.find((x) => x.address.equals(a.sellAsset))!;
        const buyAsset = assets.find((x) => x.address.equals(a.buyAsset))!;
        const price = auctionPriceAt(a, slot);
        const need = buyAmountFor(a.sellRemaining, price);
        const have = await tokenBalance(connection, client.assetAta(ap.publicKey, buyAsset));
        if (have < need) {
          results.push({ auction: a.address.toBase58(), skipped: `AP holds ${have} of buy token, needs ${need}` });
          continue;
        }
        const ata = client.assetAta(ap.publicKey, sellAsset);
        const ixs = [
          createAssociatedTokenAccountIdempotentInstruction(ap.publicKey, ata, ap.publicKey, sellAsset.mint, sellAsset.tokenProgram),
          await client.fillAuctionIx(ap.publicKey, a, a.sellRemaining, { sellAsset, buyAsset, fillerSellToken: ata }),
        ];
        try {
          const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [ap], { commitment: 'confirmed' });
          results.push({ auction: a.address.toBase58(), sig, sellAmount: a.sellRemaining.toString(), buyAmountAtQuote: need.toString(), price: fromQ64(price) });
        } catch (err) {
          // e.g. AuctionEnded / already filled by the keeper between the read and the send; keep going with the others
          results.push({ auction: a.address.toBase58(), failed: (err as Error).message.split('\n')[0] });
        }
      }
      out({ filler: ap.publicKey.toBase58(), filled: results });
      return;
    }
    default:
      process.stdout.write('usage: localnet-ap <status|create <units>|redeem <units>|set-price <SYMBOL> <usd>|fill>\n');
  }
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(ata);
  if (!info || info.data.length < 72) return 0n;
  return info.data.readBigUInt64LE(64);
}

void TOKEN_PROGRAM_ID;

main().catch((err: Error) => {
  process.stderr.write(`localnet-ap failed: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
