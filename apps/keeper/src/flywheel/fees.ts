/**
 * ETF fee processing. fee_recipient (the keeper wallet) accumulates index units from mint/redeem/mgmt fees.
 * Hourly: accrue mgmt fee -> redeem all fee units -> sell basket to SOL -> 75% buys $FIX6900 and burns it,
 * 25% is transferred to the treasury wallet.
 */
import { PublicKey, SystemProgram, type Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { ChainClient, MintInfo } from '../chain/types.js';
import { DRY_RUN_SIG, type TxSender } from '../chain/tx.js';
import type { BalanceSource, MintInfoSource } from '../chain/accounts.js';
import type { Env } from '../config/env.js';
import { feeBurnPct } from '../config/overrides.js';
import type { Repo } from '../db/repo.js';
import { redemptionBasket } from '../nav/compute.js';
import type { NavService } from '../nav/service.js';
import { WSOL_MINT, type QuoteSource } from '../sources/types.js';
import { childLogger } from '../util/logger.js';
import type { EventBus } from '../util/events.js';

const log = childLogger('flywheel.fees');

export interface FeeProcessorDeps {
  connection: Connection;
  chain: ChainClient;
  tx: TxSender; // keeper (fee_recipient)
  nav: NavService;
  quotes: QuoteSource;
  balances: BalanceSource;
  mints: MintInfoSource;
  repo: Repo;
  env: Env;
  events: EventBus;
  coinMint: PublicKey;
  treasury: PublicKey | null;
}

export interface FeeRunResult {
  units: bigint;
  solFromBasket: bigint;
  buybackSol: bigint;
  burnedCoin: bigint;
  treasurySol: bigint;
  sigs: string[];
  skipped?: string;
}

export class FeeProcessor {
  constructor(private readonly d: FeeProcessorDeps) {}

  async run(opts: { dry?: boolean; minUnits?: bigint } = {}): Promise<FeeRunResult> {
    const dry = opts.dry ?? this.d.tx.dryRun;
    const sigs: string[] = [];
    const none = (skipped: string): FeeRunResult => ({ units: 0n, solFromBasket: 0n, buybackSol: 0n, burnedCoin: 0n, treasurySol: 0n, sigs, skipped });

    // 1) accrue management fee (permissionless)
    try {
      const ixs = await this.d.chain.accrueManagementFeeIx(this.d.tx.payer);
      if (ixs.length) {
        const sig = await this.d.tx.sendIxs(ixs, { label: 'accrue_management_fee' });
        sigs.push(sig);
        this.d.repo.insertFlywheelEvent({ kind: 'fee_accrual', sig, amounts: {}, note: 'accrue_management_fee' });
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'fee accrual skipped');
    }

    const nav = await this.d.nav.get();
    if (nav.fund.openAuctions > 0) return none('auctions open; redeem would fail');
    // Only the part of the fee_recipient balance above FEE_RESERVED_UNITS is fees; the rest (bootstrap /
    // seed units minted to the keeper at launch) must never be redeemed by this job.
    const held = await this.d.balances.getTokenBalance(this.d.tx.payer, this.d.chain.indexMint);
    const reserved = BigInt(this.d.env.FEE_RESERVED_UNITS);
    const units = held > reserved ? held - reserved : 0n;
    const minUnits = opts.minUnits ?? 1_000_000n; // 1 unit
    if (units < minUnits) return none(`fee units ${units} (held ${held}, reserved ${reserved}) below minimum ${minUnits}`);

    const payer = this.d.tx.payer.toBase58();
    if (dry) {
      const estUsd = (Number(units) / 1e6) * nav.nav.navPerUnitUsd;
      log.info({ units: units.toString(), estUsd: estUsd.toFixed(2) }, 'DRY_RUN fee processing');
      this.d.repo.insertFlywheelEvent({ kind: 'redeem', sig: DRY_RUN_SIG, amounts: { units, estUsd, source: 'fees' }, note: 'DRY_RUN fee redemption' });
      this.d.repo.insertFlywheelEvent({ kind: 'buyback', sig: DRY_RUN_SIG, amounts: { sol: (estUsd * (feeBurnPct(this.d.env, this.d.repo) / 100)) / nav.solPriceUsd }, note: 'DRY_RUN buyback' });
      this.d.repo.insertFlywheelEvent({ kind: 'burn', sig: DRY_RUN_SIG, amounts: { coin: 0 }, note: 'DRY_RUN burn' });
      this.d.repo.insertFlywheelEvent({ kind: 'treasury', sig: DRY_RUN_SIG, amounts: { sol: (estUsd * (1 - feeBurnPct(this.d.env, this.d.repo) / 100)) / nav.solPriceUsd }, note: 'DRY_RUN treasury' });
      return { units, solFromBasket: 0n, buybackSol: 0n, burnedCoin: 0n, treasurySol: 0n, sigs: [DRY_RUN_SIG] };
    }

    // 2) redeem in kind
    const redeemTxs = await this.d.chain.buildRedeemTxs(units, this.d.tx.payer);
    const redeemSigs = await this.d.tx.sendMany(redeemTxs, { label: 'fee redeem' });
    sigs.push(...redeemSigs);
    this.d.repo.insertFlywheelEvent({ kind: 'redeem', sig: redeemSigs[redeemSigs.length - 1] ?? DRY_RUN_SIG, amounts: { units, source: 'fees', txs: redeemSigs }, note: 'fee units redeemed in kind' });

    // 3) sell basket -> SOL
    let sol = 0n;
    for (const leg of redemptionBasket(nav.assets, units, nav.nav.supply, nav.fund.redeemFeeBps)) {
      if (leg.amount === 0n) continue;
      try {
        const q = await this.d.quotes.quote({ inputMint: leg.mint, outputMint: WSOL_MINT, amount: leg.amount, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
        sigs.push(await this.d.tx.sendVersioned(await this.d.quotes.swapTx(q, payer), { label: `fee sell ${leg.mint}` }));
        sol += q.outAmount;
      } catch (err) {
        log.warn({ err: (err as Error).message, mint: leg.mint }, 'basket leg sale failed; keeper holds token');
      }
    }

    // 4) split
    const buybackSol = (sol * BigInt(feeBurnPct(this.d.env, this.d.repo))) / 100n;
    const treasurySol = sol - buybackSol;
    let burned = 0n;
    if (buybackSol > 0n) {
      const q = await this.d.quotes.quote({ inputMint: WSOL_MINT, outputMint: this.d.coinMint.toBase58(), amount: buybackSol, slippageBps: this.d.env.AP_SLIPPAGE_BPS });
      const buySig = await this.d.tx.sendVersioned(await this.d.quotes.swapTx(q, payer), { label: 'buyback $FIX6900' });
      sigs.push(buySig);
      this.d.repo.insertFlywheelEvent({ kind: 'buyback', sig: buySig, amounts: { sol: Number(buybackSol) / 1e9, coin: q.outAmount }, note: 'fee buyback' });

      const info: MintInfo | undefined = (await this.d.mints.getMintInfo([this.d.coinMint.toBase58()])).get(this.d.coinMint.toBase58());
      const decimals = info?.decimals ?? 6;
      // pump.fun coins created in 2026 are Token-2022 mints: use the mint's owner program, never assume SPL Token.
      const coinProgram = info ? new PublicKey(info.tokenProgram) : TOKEN_PROGRAM_ID;
      const coinBal = await this.d.balances.getTokenBalance(this.d.tx.payer, this.d.coinMint, coinProgram);
      const toBurn = coinBal < q.outAmount ? coinBal : q.outAmount;
      if (toBurn > 0n) {
        const ata = getAssociatedTokenAddressSync(this.d.coinMint, this.d.tx.payer, false, coinProgram);
        const burnSig = await this.d.tx.sendIxs([createBurnCheckedInstruction(ata, this.d.coinMint, this.d.tx.payer, toBurn, decimals, [], coinProgram)], { label: 'burn $FIX6900' });
        sigs.push(burnSig);
        burned = toBurn;
        this.d.repo.insertFlywheelEvent({ kind: 'burn', sig: burnSig, amounts: { coin: Number(toBurn) / 10 ** decimals, coinRaw: toBurn }, note: 'provable SPL burn' });
        this.d.events.emit('flywheel_event', { kind: 'burn', coin: Number(toBurn) / 10 ** decimals, sig: burnSig });
      }
    }
    if (treasurySol > 0n && this.d.treasury) {
      const sig = await this.d.tx.sendIxs([SystemProgram.transfer({ fromPubkey: this.d.tx.payer, toPubkey: this.d.treasury, lamports: treasurySol })], { label: 'treasury transfer' });
      sigs.push(sig);
      this.d.repo.insertFlywheelEvent({ kind: 'treasury', sig, amounts: { sol: Number(treasurySol) / 1e9 }, note: 'fee share to treasury' });
    } else if (treasurySol > 0n) {
      log.warn('TREASURY_WALLET not set; treasury share stays in keeper wallet');
    }
    log.info({ units: units.toString(), sol: Number(sol) / 1e9, burned: burned.toString() }, 'fees processed');
    return { units, solFromBasket: sol, buybackSol, burnedCoin: burned, treasurySol, sigs };
  }
}
