"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFund, useHoldings, useQuoteCreate, useQuoteRedeem } from "@/lib/api";
import { env } from "@/lib/env";
import { bpsToPct, fromRaw, num, tokens, usd } from "@/lib/format";
import { createClient, runTxPipeline, SdkUnavailableError, type TxStep } from "@/lib/sdk";
import { solscanTx } from "@/lib/solscan";
import { cn, truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { Tabs } from "../ui/Tabs";
import { TokenLogo } from "../ui/TokenLogo";

type Mode = "create" | "redeem";
const WITHDRAWS_PER_TX = 12;
const DEPOSITS_PER_TX = 6;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const GLYPH: Record<TxStep["status"], string> = { idle: "·", signing: "◐", sending: "◐", confirming: "◐", confirmed: "✓", failed: "×" };

export function CreateView() {
  const [mode, setMode] = useState<Mode>("create");
  const [unitsStr, setUnitsStr] = useState("100");
  // Deep link from the portfolio: /create?mode=redeem&units=<n> preselects the tab and prefills the amount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const m = q.get("mode");
    const u = q.get("units");
    if (m === "redeem" || m === "create") setMode(m);
    if (u != null) {
      const n = Number(u.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) setUnitsStr(String(Math.floor(n * 1e6) / 1e6));
    }
  }, []);
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
        /* RPC unavailable: balances stay empty */
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

  const short = basketRows.filter((r) => r.shortfall > 0).length;
  const n = basketRows.length;
  const batches = Math.max(1, Math.ceil(n / (mode === "create" ? DEPOSITS_PER_TX : WITHDRAWS_PER_TX)));
  const labels = useMemo(
    () =>
      mode === "create"
        ? ["Begin mint session", ...Array.from({ length: batches }, (_, i) => `Deposit batch ${i + 1} of ${batches}`), "Finalize mint"]
        : ["Begin redeem (burn units)", ...Array.from({ length: batches }, (_, i) => `Withdraw batch ${i + 1} of ${batches}`), "Close redeem session"],
    [mode, batches],
  );

  const reset = useCallback(() => {
    setSteps(null);
    setTxs(null);
    setFatal(null);
  }, []);
  useEffect(reset, [mode, debounced, reset]);

  const start = async (resumeAt?: number) => {
    if (!wallet.publicKey) return setVisible(true);
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
        const raw = BigInt(Math.round(units * 1e6));
        list = mode === "create" ? await client.buildMintTxs(raw) : await client.buildRedeemTxs(raw);
        setTxs(list);
      }
      const lbls = list.length === labels.length ? labels : list.map((_, i) => (i === 0 ? labels[0] : i === list.length - 1 ? labels[labels.length - 1] : `${mode === "create" ? "Deposit" : "Withdraw"} batch ${i} of ${list.length - 2}`));
      await runTxPipeline({ connection, wallet, txs: list, labels: lbls, onUpdate: setSteps, startAt: resumeAt, initial: resumeAt != null ? (steps ?? undefined) : undefined });
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
  const feeBps = fund ? Number(mode === "create" ? fund.fees.mintBps : fund.fees.redeemBps) : 50;
  const openAuctions = fund ? Number(fund.openAuctions) : 0;
  const shownSteps = steps ?? labels.map((label, i) => ({ id: String(i), label, status: "idle" as const }));

  return (
    <div className="page pagebody">
      <PageHeader
        eyebrow="Authorized participant console"
        title="Create and redeem in-kind."
        desc="Deliver the exact basket and receive newly minted units, or burn units and withdraw your pro-rata share of every constituent. There is no whitelist. Anyone can do this."
        right={<Tabs id="create-mode" label="Mode" value={mode} onChange={setMode} items={[{ value: "create", label: "Create" }, { value: "redeem", label: "Redeem" }]} />}
      />

      <div className="split split-create">
        <div className="split-side stack">
          <section className="panel" aria-label="Amount">
            <div className="panel-h">
              <span className="micro muted">{mode === "create" ? "Units to create" : "Units to redeem"}</span>
            </div>
            <div className="panel-b">
              <label className="field field-lg">
                <input inputMode="decimal" value={unitsStr} onChange={(e) => setUnitsStr(e.target.value.replace(/[^\d.,]/g, ""))} aria-label="Units" placeholder="0" />
                <span className="muted">FI6900</span>
              </label>
              <div className="quick">
                {[10, 100, 1000, 10000].map((v) => (
                  <button key={v} type="button" onClick={() => setUnitsStr(String(v))} className="btn btn-secondary btn-sm">
                    {v.toLocaleString()}
                  </button>
                ))}
              </div>
              <dl className="kvl">
                <div>
                  <dt>{mode === "create" ? "Estimated NAV value delivered" : "Estimated value received"}</dt>
                  <dd>{quoteLoading ? <Skeleton className="w-16" /> : estUsd != null ? usd(estUsd) : "—"}</dd>
                </div>
                {mode === "create" && (
                  <div>
                    <dt>Estimated cost</dt>
                    <dd>{create.data ? `${num(create.data.estCostSol, 3)} SOL` : "—"}</dd>
                  </div>
                )}
                <div>
                  <dt>{mode === "create" ? "Creation" : "Redemption"} fee ({bpsToPct(feeBps, 2)})</dt>
                  <dd>{fund ? `${num(units * (feeBps / 10_000), 4)} units` : "—"}</dd>
                </div>
                <div>
                  <dt>{mode === "create" ? "You receive" : "Net units burned"}</dt>
                  <dd>{num(units * (1 - feeBps / 10_000), 4)} units</dd>
                </div>
                <div>
                  <dt>Transactions</dt>
                  <dd>{labels.length}</dd>
                </div>
              </dl>
              {openAuctions > 0 && mode === "create" && (
                <div className="banner-inline" role="status">
                  <p>
                    {openAuctions} auction{openAuctions > 1 ? "s are" : " is"} open. Creation requires none open and will fail until they close. Redemption is unaffected.
                  </p>
                </div>
              )}
              {short > 0 && mode === "create" && (
                <p className="field-err" role="alert">
                  Your wallet is short on {short} of {n} constituents. Acquire them before you begin or the deposit step will fail.
                </p>
              )}
              <div className="actions">
                {!wallet.publicKey ? (
                  <Button variant="primary" onClick={() => setVisible(true)}>
                    Connect wallet
                  </Button>
                ) : done ? (
                  <Button variant="primary" onClick={reset}>
                    Done. Start another
                  </Button>
                ) : failedIdx >= 0 ? (
                  <Button variant="primary" disabled={running} onClick={() => start(failedIdx)}>
                    Retry step {failedIdx + 1}
                  </Button>
                ) : (
                  <Button variant="primary" disabled={running || units <= 0 || !quote} onClick={() => start()}>
                    {running ? "Working" : mode === "create" ? "Begin creation" : "Begin redemption"}
                  </Button>
                )}
                {steps && !done && (
                  <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
                    Abandon session
                  </Button>
                )}
              </div>
              {env.cluster !== "mainnet-beta" && <p className="faint">On {env.cluster} you can connect a &quot;Devnet test wallet&quot;. Test wallet, keys stay in this browser tab.</p>}
              {fatal && (
                <p className="field-err" role="alert">
                  {fatal}
                </p>
              )}
            </div>
          </section>

          <section className="panel" aria-label="Progress">
            <div className="panel-h">
              <span className="micro muted">Progress</span>
            </div>
            <ol className="steps">
              {shownSteps.map((s, i) => (
                <li key={s.id} className={cn("step", `st-${s.status}`)}>
                  <span className="step-g" aria-hidden>
                    {GLYPH[s.status]}
                  </span>
                  <div>
                    <div className="step-t">
                      <span className="muted">{String(i + 1).padStart(2, "0")}</span> {s.label}
                    </div>
                    {"signature" in s && s.signature && (
                      <a className="lnk faint" href={solscanTx(s.signature)} target="_blank" rel="noreferrer noopener">
                        {truncateMiddle(s.signature, 8, 8)} ↗
                      </a>
                    )}
                    {"error" in s && s.error && <p className="field-err">{s.error}</p>}
                  </div>
                  <span className="micro muted step-s">{s.status}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="split-main" aria-label="Basket preview">
          <div className="panel-h">
            <span className="micro muted">
              Basket preview · {mode === "create" ? `deliver ${n || "—"} coins` : `receive ${n || "—"} coins`}
            </span>
            <span className="faint">epoch {fund ? Number(fund.epoch) : "—"}</span>
          </div>
          <div className="tw tw-flat" tabIndex={0}>
            <table className="t">
              <thead>
                <tr>
                  <th className="micro">Coin</th>
                  <th className="micro r">{mode === "create" ? "Required" : "Entitled"}</th>
                  <th className="micro r hide-sm">Value</th>
                  <th className="micro r">Wallet</th>
                  <th className="micro r">{mode === "create" ? "Shortfall" : "Mint"}</th>
                </tr>
              </thead>
              <tbody>
                {quoteLoading || (!quote && units > 0) ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, c) => (
                        <td key={c}>
                          <Skeleton className={c === 0 ? "w-28" : "w-16"} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : basketRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Enter an amount to preview the basket.
                    </td>
                  </tr>
                ) : (
                  basketRows.map((r) => (
                    <tr key={r.mint}>
                      <td>
                        <span className="cellrow">
                          <TokenLogo symbol={r.symbol} mint={r.mint} src={r.logo} size={20} />
                          <b>{r.symbol}</b>
                        </span>
                      </td>
                      <td className="r m">{tokens(r.amount, r.decimals, 6)}</td>
                      <td className="r m muted hide-sm">{r.valueUsd != null ? usd(r.valueUsd) : "—"}</td>
                      <td className="r m muted">{r.bal == null ? (wallet.publicKey ? "…" : "—") : r.bal.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                      <td className="r m">
                        {mode === "create" ? (
                          r.bal == null ? (
                            <span className="muted">—</span>
                          ) : r.shortfall > 0 ? (
                            <span className="delta-down">-{r.shortfall.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
                          ) : (
                            <span aria-label="Sufficient">✓</span>
                          )
                        ) : (
                          <Address value={r.mint} kind="token" copy={false} />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="panel-f faint">
            {mode === "create"
              ? "Required amounts are fixed when the mint session begins. If an auction fills before you finalize, the session goes stale and deposits are refunded."
              : `Entitled amounts are reserved when the redeem session begins. Withdrawals are batched, about ${WITHDRAWS_PER_TX} per transaction.`}
          </p>
        </section>
      </div>
    </div>
  );
}
