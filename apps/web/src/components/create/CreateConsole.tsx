"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CircleDashed, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFund, useHoldings, useQuoteCreate, useQuoteRedeem } from "@/lib/api";
import { env } from "@/lib/env";
import { bpsToPct, fromRaw, num, tokens, usd } from "@/lib/format";
import { createClient, runTxPipeline, SdkUnavailableError, type TxStep } from "@/lib/sdk";
import { solscanTx } from "@/lib/solscan";
import { cn, truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Card, CardHeader, PageHeader } from "../ui/Card";
import { HelpPopover } from "../ui/Popover";
import { Skeleton } from "../ui/Skeleton";
import { Table, TableWrap, Td, Th, THead } from "../ui/Table";
import { Tabs } from "../ui/Tabs";
import { TokenLogo } from "../ui/TokenLogo";

type Mode = "create" | "redeem";

const WITHDRAWS_PER_TX = 12;
const DEPOSITS_PER_TX = 6;

export function CreateConsole() {
  const [mode, setMode] = useState<Mode>("create");
  const [unitsStr, setUnitsStr] = useState("100");
  const units = useMemo(() => {
    const n = Number(unitsStr.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [unitsStr]);
  const debounced = useDebounced(units, 350);

  const { data: fund } = useFund();
  const { data: holdings } = useHoldings();
  const create = useQuoteCreate(mode === "create" ? debounced : 0);
  const redeem = useQuoteRedeem(mode === "redeem" ? debounced : 0);
  const quote = mode === "create" ? create.data : redeem.data;
  const quoteLoading = mode === "create" ? create.isLoading : redeem.isLoading;

  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [steps, setSteps] = useState<TxStep[] | null>(null);
  const [txs, setTxs] = useState<VersionedTransaction[] | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const byMint = useMemo(() => new Map((holdings ?? []).map((h) => [h.mint, h])), [holdings]);

  // Load wallet token balances for the basket
  useEffect(() => {
    if (!wallet.publicKey || !quote) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await connection.getParsedTokenAccountsByOwner(wallet.publicKey!, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
        const res22 = await connection.getParsedTokenAccountsByOwner(wallet.publicKey!, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }).catch(() => ({ value: [] }));
        const map: Record<string, number> = {};
        for (const acc of [...res.value, ...res22.value]) {
          const info = (acc.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } }).parsed?.info;
          if (info?.mint) map[info.mint] = (map[info.mint] ?? 0) + (info.tokenAmount?.uiAmount ?? 0);
        }
        if (!cancelled) setBalances(map);
      } catch {
        /* RPC unavailable; leave balances empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.publicKey, connection, quote?.basket.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const basketRows = useMemo(() => {
    if (!quote) return [];
    return quote.basket.map((b) => {
      const h = byMint.get(b.mint);
      const decimals = b.decimals ?? h?.decimals ?? 6;
      const amountUi = fromRaw(b.amount, decimals);
      const bal = wallet.publicKey ? balances[b.mint] : undefined;
      const shortfall = mode === "create" && bal != null ? Math.max(0, amountUi - bal) : 0;
      return { mint: b.mint, symbol: b.symbol ?? h?.symbol ?? truncateMiddle(b.mint), logo: h?.logo, decimals, amount: b.amount, amountUi, bal, shortfall, valueUsd: h ? amountUi * h.priceUsd : null };
    });
  }, [quote, byMint, balances, wallet.publicKey, mode]);

  const totalShortfall = basketRows.filter((r) => r.shortfall > 0).length;
  const n = basketRows.length;
  const batches = Math.max(1, Math.ceil(n / (mode === "create" ? DEPOSITS_PER_TX : WITHDRAWS_PER_TX)));
  const labels = useMemo(() => {
    if (mode === "create") return ["Begin mint session", ...Array.from({ length: batches }, (_, i) => `Deposit batch ${i + 1} / ${batches}`), "Finalize mint"];
    return ["Begin redeem (burn units)", ...Array.from({ length: batches }, (_, i) => `Withdraw batch ${i + 1} / ${batches}`), "Close redeem session"];
  }, [mode, batches]);

  const reset = useCallback(() => {
    setSteps(null);
    setTxs(null);
    setFatal(null);
  }, []);
  useEffect(reset, [mode, debounced, reset]);

  const start = async (resumeAt?: number) => {
    if (!wallet.publicKey) {
      setVisible(true);
      return;
    }
    setFatal(null);
    setRunning(true);
    try {
      let list = txs;
      if (!list) {
        const client = await createClient({
          connection,
          wallet,
          programId: env.programId ? new PublicKey(env.programId) : undefined,
          indexMint: env.indexMint ? new PublicKey(env.indexMint) : fund ? new PublicKey(fund.indexMint) : undefined,
        });
        const rawUnits = BigInt(Math.round(units * 1e6));
        list = mode === "create" ? await client.buildMintTxs(rawUnits) : await client.buildRedeemTxs(rawUnits);
        setTxs(list);
      }
      const lbls = list.length === labels.length ? labels : list.map((_, i) => (i === 0 ? labels[0] : i === list.length - 1 ? labels[labels.length - 1] : `${mode === "create" ? "Deposit" : "Withdraw"} batch ${i} / ${list.length - 2}`));
      await runTxPipeline({ connection, wallet, txs: list, labels: lbls, onUpdate: setSteps, startAt: resumeAt, initial: resumeAt != null ? steps ?? undefined : undefined });
    } catch (e) {
      if (e instanceof SdkUnavailableError) setFatal(e.message);
      else if (!steps) setFatal(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const failedIdx = steps?.findIndex((s) => s.status === "failed") ?? -1;
  const done = !!steps && steps.every((s) => s.status === "confirmed");
  const estUsd = mode === "create" ? create.data?.estNavUsd : redeem.data?.estValueUsd;
  const fee = fund ? (mode === "create" ? fund.fees.mintBps : fund.fees.redeemBps) : 50;

  return (
    <div className="wrap page">
      <PageHeader
        eyebrow="Authorized Participant console"
        title="Create or redeem units in-kind."
        desc="Deliver the exact basket and receive freshly minted units, or burn units and withdraw your pro-rata share of every constituent. There is no AP whitelist."
        right={<Tabs id="create-mode" value={mode} onChange={setMode} items={[{ value: "create", label: "Create" }, { value: "redeem", label: "Redeem" }]} />}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Left: input + steps */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader eyebrow={mode === "create" ? "Units to create" : "Units to redeem"} title="Amount" right={<HelpInfo mode={mode} />} />
            <div className="p-5">
              <label className="field gap-3">
                <input
                  inputMode="decimal"
                  value={unitsStr}
                  onChange={(e) => setUnitsStr(e.target.value.replace(/[^\d.,]/g, ""))}
                  className="h-12 w-full bg-transparent font-mono text-2xl tabular-nums placeholder:text-dim"
                  placeholder="0"
                  aria-label="Units"
                />
                <span className="font-mono text-sm text-muted">FI6900</span>
              </label>
              <div className="mt-2 flex gap-1.5">
                {[10, 100, 1000, 10000].map((v) => (
                  <button key={v} type="button" onClick={() => setUnitsStr(String(v))} className="h-7 rounded bg-surface-2 px-2 font-mono text-xs text-muted hover:text-text">
                    {v.toLocaleString()}
                  </button>
                ))}
              </div>
              <dl className="mt-5 divide-y divide-line text-[13px]">
                <KV k={mode === "create" ? "Est. NAV value delivered" : "Est. value received"} v={quoteLoading ? <Skeleton className="h-4 w-20" /> : estUsd != null ? usd(estUsd) : "—"} />
                {mode === "create" && <KV k="Est. cost (SOL)" v={create.data ? `${num(create.data.estCostSol, 3)} SOL` : "—"} />}
                <KV k={`${mode === "create" ? "Creation" : "Redemption"} fee (${bpsToPct(fee, 2)})`} v={fund ? `${num(units * (fee / 10_000), 4)} units` : "—"} />
                <KV k={mode === "create" ? "You receive" : "Net units burned"} v={<span className="text-accent">{num(units * (1 - fee / 10_000), 4)} units</span>} />
                <KV k="Transactions" v={`${labels.length}`} />
              </dl>
              {fund && fund.openAuctions > 0 && mode === "create" && (
                <div className="mt-4 flex gap-2 rounded-md bg-amber-dim p-3 text-xs leading-relaxed text-amber">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {fund.openAuctions} auction{fund.openAuctions > 1 ? "s are" : " is"} open. <span className="font-mono">begin_mint</span> requires <span className="font-mono">open_auctions == 0</span>; creation will fail until they close. Redemption is unaffected.
                  </span>
                </div>
              )}
              {totalShortfall > 0 && mode === "create" && (
                <div className="mt-4 flex gap-2 rounded-md bg-neg-dim p-3 text-xs leading-relaxed text-neg">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Your wallet is short on {totalShortfall} of {n} constituents. Acquire them before beginning, or the deposit step will fail.
                  </span>
                </div>
              )}
              <div className="mt-5 flex flex-col gap-2">
                {!wallet.publicKey ? (
                  <Button variant="primary" size="lg" onClick={() => setVisible(true)}>
                    Connect wallet
                  </Button>
                ) : done ? (
                  <Button variant="primary" size="lg" onClick={reset}>
                    <Check size={16} /> Done — start another
                  </Button>
                ) : failedIdx >= 0 ? (
                  <Button variant="primary" size="lg" disabled={running} onClick={() => start(failedIdx)}>
                    <RotateCcw size={16} /> Retry step {failedIdx + 1}
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" disabled={running || units <= 0 || !quote} onClick={() => start()}>
                    {running ? <Loader2 size={16} className="animate-spin" /> : null}
                    {mode === "create" ? "Begin creation" : "Begin redemption"}
                  </Button>
                )}
                {steps && !done && (
                  <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
                    <X size={14} /> Abandon session
                  </Button>
                )}
              </div>
              {fatal && (
                <div className="mt-4 rounded-md bg-surface-2 p-3 text-xs leading-relaxed text-muted">
                  <div className="mb-1 font-semibold text-text">{fatal.includes("sdk") || fatal.includes("SDK") ? "SDK unavailable" : "Could not start"}</div>
                  {fatal}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Progress" title="Step tracker" right={<HelpPopover title="Why several transactions?"><AltHelp /></HelpPopover>} />
            <ol className="divide-y divide-line">
              {(steps ?? labels.map((label, i) => ({ id: String(i), label, status: "idle" as const }))).map((s, i) => (
                <StepRow key={s.id} step={s} index={i} />
              ))}
            </ol>
          </Card>
        </div>

        {/* Right: basket preview */}
        <Card className="min-w-0">
          <CardHeader
            eyebrow="Basket preview"
            title={mode === "create" ? `Deliver ${n || "—"} assets` : `Receive ${n || "—"} assets`}
            right={
              <span className="text-xs text-muted">
                epoch <span className="font-mono text-text">{fund?.epoch ?? "—"}</span>
              </span>
            }
          />
          <TableWrap className="rounded-none bg-transparent shadow-none" maxHeight="min(70vh, 760px)">
            <Table>
              <THead>
                <tr>
                  <Th className="pl-5">Asset</Th>
                  <Th align="right">{mode === "create" ? "Required" : "Entitled"}</Th>
                  <Th align="right" className="hidden sm:table-cell">
                    Value
                  </Th>
                  <Th align="right">Your balance</Th>
                  <Th align="right" className="pr-5">
                    {mode === "create" ? "Shortfall" : "Mint"}
                  </Th>
                </tr>
              </THead>
              <tbody>
                {quoteLoading || (!quote && units > 0) ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-line">
                      {Array.from({ length: 5 }).map((_, c) => (
                        <td key={c} className="h-11 px-3">
                          <Skeleton className={cn("h-3", c === 0 ? "w-28" : "w-16")} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : basketRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="h-24 text-center text-sm text-muted">
                      Enter an amount to preview the basket.
                    </td>
                  </tr>
                ) : (
                  basketRows.map((r) => (
                    <tr key={r.mint} className="border-b border-line last:border-0">
                      <td className="h-11 pl-5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <TokenLogo symbol={r.symbol} src={r.logo} size={20} />
                          <span className="text-[13px] font-semibold">{r.symbol}</span>
                        </div>
                      </td>
                      <Td align="right" mono>
                        {tokens(r.amount, r.decimals, 6)}
                      </Td>
                      <Td align="right" mono className="hidden text-muted sm:table-cell">
                        {r.valueUsd != null ? usd(r.valueUsd) : "—"}
                      </Td>
                      <Td align="right" mono className="text-muted">
                        {r.bal == null ? (wallet.publicKey ? "…" : "—") : r.bal.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                      </Td>
                      <td className="h-11 pl-3 pr-5 text-right font-mono text-[13px]">
                        {mode === "create" ? (
                          r.bal == null ? (
                            <span className="text-muted">—</span>
                          ) : r.shortfall > 0 ? (
                            <span className="text-neg">-{r.shortfall.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                          ) : (
                            <Check size={14} className="ml-auto text-muted" aria-label="Sufficient" />
                          )
                        ) : (
                          <Address value={r.mint} kind="token" copy={false} />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableWrap>
          <div className="border-t border-line px-5 py-4 text-xs leading-relaxed text-muted">
            {mode === "create" ? (
              <>
                Required amounts are <span className="font-mono">ceil(effective_balance × units / supply)</span> per asset, fixed at <span className="font-mono">begin_mint</span>. If any auction fills before you finalize, the session goes stale and deposits are refunded.
              </>
            ) : (
              <>
                Entitled amounts are <span className="font-mono">floor(effective_balance × net_units / supply)</span>, reserved at <span className="font-mono">begin_redeem</span>. Withdrawals are batched ~{WITHDRAWS_PER_TX} per transaction.
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: TxStep; index: number }) {
  const icon =
    step.status === "confirmed" ? (
      <Check size={14} className="text-accent" />
    ) : step.status === "failed" ? (
      <X size={14} className="text-neg" />
    ) : step.status === "idle" ? (
      <CircleDashed size={14} className="text-dim" />
    ) : (
      <Loader2 size={14} className="animate-spin text-text" />
    );
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <span className={cn("font-medium", step.status === "idle" && "text-muted")}>
            <span className="mr-2 font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</span>
            {step.label}
          </span>
          <span className={cn("eyebrow shrink-0", step.status === "confirmed" ? "text-accent" : step.status === "failed" ? "text-neg" : "")}>{step.status}</span>
        </div>
        <AnimatePresence initial={false}>
          {step.signature && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-1 overflow-hidden text-xs">
              <a href={solscanTx(step.signature)} target="_blank" rel="noreferrer noopener" className="font-mono text-muted hover:text-accent">
                {truncateMiddle(step.signature, 8, 8)} ↗
              </a>
            </motion.div>
          )}
          {step.error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-1 break-words text-xs text-neg/90">
              {step.error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className="num font-mono font-medium">{v}</dd>
    </div>
  );
}

function HelpInfo({ mode }: { mode: Mode }) {
  return (
    <HelpPopover title={mode === "create" ? "How creation works" : "How redemption works"}>
      {mode === "create" ? (
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            <span className="font-mono text-text">begin_mint</span> snapshots the required deposit for each active asset and opens a session bound to the current epoch.
          </li>
          <li>
            <span className="font-mono text-text">deposit</span> moves each required amount from your wallet into the vault, several per transaction.
          </li>
          <li>
            <span className="font-mono text-text">finalize_mint</span> checks every slot is deposited and the epoch is unchanged, then mints units minus the fee to you.
          </li>
        </ol>
      ) : (
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            <span className="font-mono text-text">begin_redeem</span> burns your units (minus the fee) and reserves your entitlement in every vault.
          </li>
          <li>
            <span className="font-mono text-text">withdraw</span> transfers each entitled amount to your wallet, ~12 per transaction.
          </li>
          <li>
            <span className="font-mono text-text">close_redeem</span> closes the session and refunds rent.
          </li>
        </ol>
      )}
    </HelpPopover>
  );
}

function AltHelp() {
  return (
    <div className="space-y-2">
      <p>A Solana transaction can only reference a limited number of accounts (~1232 bytes). Touching 40 vaults plus your 40 token accounts does not fit in one.</p>
      <p>
        The SDK uses the fund&apos;s <span className="text-text">address lookup table (ALT)</span> to compress account references, then splits deposits/withdrawals into batches. You sign each transaction in order; if one fails you can retry it without restarting the session.
      </p>
      <p>Deposits are refundable via cancel_mint until finalize; redemption entitlements are reserved on-chain until withdrawn.</p>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
