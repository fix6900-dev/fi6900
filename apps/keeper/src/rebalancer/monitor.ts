/** Auction monitor: reconcile fills, fallback-fill when price is attractive, cancel expired. */
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { AuctionState, ChainClient } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { Env } from '../config/env.js';
import type { MethodologyConfig } from '../config/methodology.config.js';
import type { Repo } from '../db/repo.js';
import type { NavService } from '../nav/service.js';
import { WSOL_MINT, type QuoteSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';
import { fromQ64 } from '../util/math.js';
import { buyAmountFor, priceAtSlot, shouldSelfFill } from './auction-pricing.js';
import type { Connection } from '@solana/web3.js';

const log = childLogger('auction-monitor');

export interface MonitorDeps {
  chain: ChainClient;
  connection: Connection;
  tx: TxSender;
  nav: NavService;
  quotes: QuoteSource;
  repo: Repo;
  cfg: MethodologyConfig;
  env: Env;
  events: EventBus;
}

export interface MonitorResult {
  open: number;
  fillsRecorded: number;
  selfFilled: string[];
  cancelled: string[];
}

export class AuctionMonitor {
  constructor(private readonly d: MonitorDeps) {}

  async tick(): Promise<MonitorResult> {
    const result: MonitorResult = { open: 0, fillsRecorded: 0, selfFilled: [], cancelled: [] };
    const onchain = await this.d.chain.readAuctions('all');
    const slot = BigInt(await this.d.connection.getSlot());
    let balancesChanged = false;

    for (const a of onchain) {
      const row = this.d.repo.getAuction(a.pda);
      const prevRemaining = row ? BigInt(row.sell_remaining) : a.sellTotal;

      this.d.repo.upsertAuction({
        pda: a.pda,
        nonce: a.nonce.toString(),
        sell_mint: a.sellMint,
        buy_mint: a.buyMint,
        sell_total: a.sellTotal.toString(),
        sell_remaining: a.sellRemaining.toString(),
        start_price: a.startPrice.toString(),
        end_price: a.endPrice.toString(),
        start_slot: a.startSlot.toString(),
        end_slot: a.endSlot.toString(),
        status: a.status,
        mid_price: row?.mid_price ?? null,
        reason: row?.reason ?? null,
        start_sig: row?.start_sig ?? null,
      });

      // ---- fills since last tick ----
      if (a.sellRemaining < prevRemaining) {
        balancesChanged = true;
        const fills = await this.d.chain.getAuctionFills(a.pda).catch(() => []);
        if (fills.length) {
          for (const f of fills) {
            if (this.d.repo.insertFill({ auctionPda: a.pda, sig: f.sig, filler: f.filler, sellAmount: f.sellAmount, buyAmount: f.buyAmount, price: f.price, slot: f.slot })) {
              result.fillsRecorded++;
              this.d.repo.insertFlywheelEvent({ kind: 'auction_fill', sig: f.sig, amounts: { auction: a.pda, sellAmount: f.sellAmount, buyAmount: f.buyAmount, price: f.price, filler: f.filler } });
            }
          }
        } else {
          // No event index available: synthesise one fill from the delta at the current curve price.
          const delta = prevRemaining - a.sellRemaining;
          const price = priceAtSlot(a.startPrice, a.endPrice, a.startSlot, a.endSlot, slot);
          const sig = `delta-${a.pda.slice(0, 8)}-${slot.toString()}`;
          if (this.d.repo.insertFill({ auctionPda: a.pda, sig, filler: 'unknown', sellAmount: delta, buyAmount: buyAmountFor(delta, price), price, slot: Number(slot) })) {
            result.fillsRecorded++;
            this.d.repo.insertFlywheelEvent({ kind: 'auction_fill', sig, amounts: { auction: a.pda, sellAmount: delta, buyAmount: buyAmountFor(delta, price), price }, note: 'inferred from sell_remaining delta' });
          }
        }
        this.d.events.emit('auction', { pda: a.pda, status: a.status, sellRemaining: a.sellRemaining.toString() });
      }

      if (a.status !== 'open') continue;
      result.open++;

      // ---- expired -> cancel ----
      if (slot > a.endSlot) {
        try {
          const ixs = await this.d.chain.cancelAuctionIx(new PublicKey(a.pda), this.d.tx.payer);
          const sig = await this.d.tx.sendIxs(ixs, { label: `cancel_auction ${a.pda}` });
          result.cancelled.push(a.pda);
          this.d.events.emit('auction', { pda: a.pda, status: 'expired' });
          log.warn({ pda: a.pda, sig }, 'expired auction cancelled');
        } catch (err) {
          log.error({ err: (err as Error).message, pda: a.pda }, 'cancel failed');
        }
        continue;
      }

      // ---- fallback fill ----
      const current = priceAtSlot(a.startPrice, a.endPrice, a.startSlot, a.endSlot, slot);
      const mid = row?.mid_price ?? (await this.midFromPrices(a));
      if (mid && shouldSelfFill(current, mid, this.d.cfg.rebalance.auction.fallbackFillDiscountBps)) {
        try {
          const sig = await this.selfFill(a, current);
          result.selfFilled.push(a.pda);
          if (sig !== DRY_RUN_SIG) balancesChanged = true;
        } catch (err) {
          log.error({ err: (err as Error).message, pda: a.pda }, 'self-fill failed');
        }
      } else {
        log.debug({ pda: a.pda, price: fromQ64(current), mid, remaining: a.sellRemaining.toString(), slotsLeft: (a.endSlot - slot).toString() }, 'auction open');
      }
    }

    if (balancesChanged) await this.d.nav.snapshot().catch((e: Error) => log.warn({ err: e.message }, 'post-fill snapshot failed'));
    return result;
  }

  /** Raw balance of `mint` in the keeper's ATA (0 if the account does not exist). */
  private async inventory(mint: string): Promise<bigint> {
    const asset = this.d.nav.latest?.assets.find((x) => x.mint === mint);
    const tokenProgram = asset ? new PublicKey(asset.tokenProgram) : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), this.d.tx.payer, true, tokenProgram);
    const info = await this.d.connection.getAccountInfo(ata).catch(() => null);
    if (!info || info.data.length < 72) return 0n;
    return info.data.readBigUInt64LE(64);
  }

  private async midFromPrices(a: AuctionState): Promise<number | null> {
    const nav = this.d.nav.latest;
    if (!nav) return null;
    const sell = nav.assets.find((x) => x.mint === a.sellMint);
    const buy = nav.assets.find((x) => x.mint === a.buyMint);
    const sp = nav.prices.get(a.sellMint);
    const bp = nav.prices.get(a.buyMint);
    if (!sell || !buy || !sp || !bp) return null;
    return (sp / bp) * 10 ** (buy.decimals - sell.decimals);
  }

  /**
   * Keeper acts as filler: acquire buy-token via Jupiter (SOL -> buy token, ExactOut), call fill_auction
   * for the whole remainder, then recycle the received sell-token back to SOL.
   */
  async selfFill(a: AuctionState, priceQ64: bigint): Promise<string> {
    const need = buyAmountFor(a.sellRemaining, priceQ64);
    // Token-2022 fee-on-transfer buy token: the vault must RECEIVE `need`, so the keeper sends `gross` (> need).
    // The price only decays, so a gross sized at the current slot still clears when the tx lands later.
    const gross = await this.d.chain.fillGrossFor(new PublicKey(a.buyMint), need);
    const payer = this.d.tx.payer.toBase58();
    log.info({ pda: a.pda, buyMint: a.buyMint, need: need.toString(), gross: gross.toString(), price: fromQ64(priceQ64) }, 'self-filling auction');

    if (this.d.tx.dryRun) {
      this.d.repo.insertFlywheelEvent({
        kind: 'auction_fill',
        sig: DRY_RUN_SIG,
        amounts: { auction: a.pda, sellAmount: a.sellRemaining, buyAmount: need, price: priceQ64, filler: payer },
        note: 'DRY_RUN self-fill',
      });
      return DRY_RUN_SIG;
    }

    // 1) acquire buy token: use wallet inventory first, Jupiter (SOL -> buy token, ExactOut) for the shortfall
    const held = await this.inventory(a.buyMint);
    let swapSig: string | null = null;
    let solSpent = 0n;
    if (held >= gross) {
      log.info({ held: held.toString(), need: need.toString(), gross: gross.toString() }, 'self-fill from keeper inventory (no swap)');
    } else {
      // The swap's output transfer is taxed too for a fee mint: ask for enough that the wallet nets the shortfall.
      const shortfall = await this.d.chain.fillGrossFor(new PublicKey(a.buyMint), gross - held);
      const buyQuote = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: a.buyMint, amount: shortfall, slippageBps: this.d.env.AP_SLIPPAGE_BPS, swapMode: 'ExactOut' });
      const swapTx = await this.d.quotes.swapTx(buyQuote, payer);
      swapSig = await this.d.tx.sendVersioned(swapTx, { label: `self-fill buy ${a.buyMint}` });
      solSpent = buyQuote.inAmount;
    }

    // 2) fill
    const ixs = await this.d.chain.fillAuctionIx(new PublicKey(a.pda), a.sellRemaining, this.d.tx.payer, gross > need ? gross : null);
    const fillSig = await this.d.tx.sendIxs(ixs, { label: `fill_auction ${a.pda}` });

    // 3) recycle sell token -> SOL
    let sellSig: string | null = null;
    try {
      const sellQuote = await this.d.quotes.quote({ inputMint: a.sellMint, outputMint: WSOL_MINT, amount: a.sellRemaining, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
      const sellTx = await this.d.quotes.swapTx(sellQuote, payer);
      sellSig = await this.d.tx.sendVersioned(sellTx, { label: `self-fill sell ${a.sellMint}` });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'recycle swap failed; keeper holds sell token');
    }

    this.d.repo.insertFill({ auctionPda: a.pda, sig: fillSig, filler: payer, sellAmount: a.sellRemaining, buyAmount: need, price: priceQ64, slot: Number(await this.d.connection.getSlot()) });
    this.d.repo.insertFlywheelEvent({
      kind: 'auction_fill',
      sig: fillSig,
      amounts: { auction: a.pda, sellAmount: a.sellRemaining, buyAmount: need, price: priceQ64, filler: payer, swapSig, sellSig, solSpent },
      note: 'keeper fallback fill',
    });
    this.d.events.emit('auction', { pda: a.pda, status: 'filled', filler: payer });
    return fillSig;
  }
}
