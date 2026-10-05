"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useMemo, useState } from "react";
import { useAuctions, useFlywheel, useHoldings } from "@/lib/api";
import { fromRaw, num, pct, tokens, usd } from "@/lib/format";
import type { Auction, Holding } from "@/lib/schemas";
import { createClient, runTxPipeline, SdkUnavailableError } from "@/lib/sdk";
import { useChangedAt } from "@/lib/useStream";
import { truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { Countdown, useNow } from "../ui/Countdown";
import { Skeleton } from "../ui/Skeleton";
import { TokenLogo } from "../ui/TokenLogo";

const SLOT_MS = 400;

function Pair({ a, sell, buy }: { a: Auction; sell?: Holding; buy?: Holding }) {
  const s = a.sellSymbol ?? sell?.symbol ?? truncateMiddle(a.sellMint);
  const b = a.buySymbol ?? buy?.symbol ?? truncateMiddle(a.buyMint);
  return (
    <span className="cellrow">
      <TokenLogo symbol={s} mint={a.sellMint} src={sell?.logo} size={20} />
      <b>{s}</b>
      <span aria-label="for" className="muted">→</span>
      <TokenLogo symbol={b} mint={a.buyMint} src={buy?.logo} size={20} />
      <b>{b}</b>
    </span>
  );
}

export function AuctionsView() {
  const { data, isLoading } = useAuctions("all");
  const { data: holdings } = useHoldings();
  const { data: fw } = useFlywheel();
  const byMint = useMemo(() => new Map((holdings ?? []).map((h) => [h.mint, h])), [holdings]);
  const open = (data ?? []).filter((a) => a.status === "open");
  const past = (data ?? []).filter((a) => a.status !== "open");

  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Rebalancing" title="Dutch auctions. No oracle." desc="To move an overweight coin into an underweight one, the rebalancer opens an auction whose price decays linearly from a premium to a discount. Anyone can fill any amount at the current price." />

      <section className="sec" aria-labelledby="open-h">
        <h2 id="open-h" className="h2">
          Open auctions {open.length > 0 && <span className="muted">{open.length}</span>}
        </h2>
        {isLoading && !data ? (
          <div className="auc-grid">
            <Skeleton className="skel-block" />
          </div>
        ) : open.length === 0 ? (
          <div className="empty-panel">
            <p className="prose">No open auctions. Auctions open when a constituent drifts beyond the band or at reconstitution.</p>
            <p className="faint">
              Next drift check: <Countdown to={fw?.next.rebalanceCheckAt} compact emptyText="not scheduled" />
            </p>
          </div>
        ) : (
          <div className="auc-grid">
            {open.map((a) => (
              <AuctionCard key={a.pda} a={a} sell={byMint.get(a.sellMint)} buy={byMint.get(a.buyMint)} />
            ))}
          </div>
        )}
      </section>

      <section className="sec" aria-labelledby="past-h">
        <h2 id="past-h" className="h2">
          Past auctions
        </h2>
        <div className="tw" tabIndex={0}>
          <table className="t">
            <thead>
              <tr>
                <th className="micro">Pair</th>
                <th className="micro r">Start slot</th>
                <th className="micro r">End slot</th>
                <th className="micro r">Filled</th>
                <th className="micro r">Avg price</th>
                <th className="micro r">Fills</th>
                <th className="micro r">Status</th>
                <th className="micro">Signatures</th>
              </tr>
            </thead>
            <tbody>
              {past.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No past auctions yet.
                  </td>
                </tr>
              ) : (
                past.map((a) => {
                  const s = byMint.get(a.sellMint);
                  const b = byMint.get(a.buyMint);
                  const sd = a.sellDecimals ?? s?.decimals ?? 6;
                  const total = fromRaw(a.sellTotal, sd);
                  const sold = total - fromRaw(a.sellRemaining, sd);
                  const avg = a.fills.length ? a.fills.reduce((x, f) => x + f.price, 0) / a.fills.length : null;
                  return (
                    <tr key={a.pda}>
                      <td>
                        <Pair a={a} sell={s} buy={b} />
                      </td>
                      <td className="r m muted">{a.startSlot.toLocaleString()}</td>
                      <td className="r m muted">{a.endSlot.toLocaleString()}</td>
                      <td className="r m">
                        {sold.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="muted">{a.sellSymbol ?? s?.symbol}</span>
                      </td>
                      <td className="r m">{avg != null ? num(avg, 4) : "—"}</td>
                      <td className="r m">{a.fills.length}</td>
                      <td className="r">{a.status === "filled" ? <span className="muted">filled</span> : <span className="chip chip-pending">{a.status}</span>}</td>
                      <td>
                        <span className="sigs">
                          {a.fills.slice(0, 3).map((f) => (
                            <Address key={f.sig} value={f.sig} kind="tx" head={4} tail={4} copy={false} />
                          ))}
                          {a.fills.length === 0 && <span className="muted">—</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AuctionCard({ a, sell, buy }: { a: Auction; sell?: Holding; buy?: Holding }) {
  const changedAt = useChangedAt(`auction.${a.pda}`);
  const now = useNow(1000);
  const sd = a.sellDecimals ?? sell?.decimals ?? 6;
  const bd = a.buyDecimals ?? buy?.decimals ?? 6;
  const remaining = fromRaw(a.sellRemaining, sd);
  const total = fromRaw(a.sellTotal, sd);
  const filledPct = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const dur = Math.max(1, a.endSlot - a.startSlot);
  const baseSlot = a.currentSlot ?? a.startSlot + Math.round(((a.startPrice - a.currentPrice) / Math.max(1e-12, a.startPrice - a.endPrice)) * dur);
  const slot = Math.min(a.endSlot, baseSlot + (now && changedAt ? Math.floor(Math.max(0, now - changedAt) / SLOT_MS) : 0));
  const elapsed = Math.min(Math.max(slot - a.startSlot, 0), dur);
  const price = a.startPrice - (a.startPrice - a.endPrice) * (elapsed / dur);
  const mid = a.jupiterMidPrice ?? (sell && buy ? sell.priceUsd / buy.priceUsd : null);
  const vsMid = mid ? (price / mid - 1) * 100 : null;
  const slotsLeft = Math.max(0, a.endSlot - slot);
  const sellSym = a.sellSymbol ?? sell?.symbol ?? "SELL";
  const buySym = a.buySymbol ?? buy?.symbol ?? "BUY";

  return (
    <article className="card auc">
      <div className="card-head">
        <div>
          <div className="micro muted">
            Open · {slotsLeft.toLocaleString()} slots left · about {Math.round((slotsLeft * SLOT_MS) / 60000)} min
          </div>
          <div className="card-title">
            <Pair a={a} sell={sell} buy={buy} />
          </div>
        </div>
        <Address value={a.pda} />
      </div>
      <dl className="auc-stats">
        <div>
          <dt className="micro muted">Price</dt>
          <dd className="m">{num(price, 5)}</dd>
          <dd className="faint">
            {buySym} per {sellSym}
          </dd>
        </div>
        <div>
          <dt className="micro muted">vs Jupiter mid</dt>
          <dd className="m">{vsMid != null ? (vsMid > 0 ? <span className="chip chip-pending">{pct(vsMid, 2)}</span> : pct(vsMid, 2)) : "—"}</dd>
          <dd className="faint">{mid != null ? `mid ${num(mid, 5)}` : "no mid price"}</dd>
        </div>
        <div>
          <dt className="micro muted">Remaining</dt>
          <dd className="m">{remaining.toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
          <dd className="faint">{filledPct.toFixed(1)}% filled</dd>
        </div>
      </dl>
      <div className="auc-curve">
        <PriceCurve a={a} slot={slot} price={price} mid={mid} />
      </div>
      <FillForm a={a} price={price} remaining={remaining} sellSym={sellSym} buySym={buySym} sellDecimals={sd} buyDecimals={bd} sellPriceUsd={sell?.priceUsd} />
      {a.fills.length > 0 && (
        <div className="auc-fills">
          <div className="micro muted">Fills</div>
          {a.fills
            .slice()
            .sort((x, y) => y.slot - x.slot)
            .slice(0, 5)
            .map((f) => (
              <div key={f.sig} className="fillrow">
                <Address value={f.sig} kind="tx" head={6} tail={6} copy={false} />
                <span className="m">
                  {tokens(f.sellAmount, sd, 2)} {sellSym} @ {num(f.price, 5)}
                </span>
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

/** The decay line with a dot at the current price. The dot moves each second. */
function PriceCurve({ a, slot, price, mid }: { a: Auction; slot: number; price: number; mid: number | null }) {
  const W = 600;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 14;
  const padB = 24;
  const dur = Math.max(1, a.endSlot - a.startSlot);
  const lo = Math.min(a.endPrice, mid ?? a.endPrice) * 0.995;
  const hi = Math.max(a.startPrice, mid ?? a.startPrice) * 1.005;
  const x = (s: number) => padL + ((s - a.startSlot) / dur) * (W - padL - padR);
  const y = (p: number) => padT + (1 - (p - lo) / Math.max(1e-12, hi - lo)) * (H - padT - padB);
  const xNow = x(slot);
  const yNow = y(price);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="curve" role="img" aria-label="Auction price decaying over time with the current price marked">
      {mid != null && (
        <>
          <line x1={padL} x2={W - padR} y1={y(mid)} y2={y(mid)} className="cv-mid" />
          <text x={W - padR} y={y(mid) - 5} textAnchor="end" className="cv-t">
            Jupiter mid {num(mid, 5)}
          </text>
        </>
      )}
      <line x1={x(a.startSlot)} y1={y(a.startPrice)} x2={xNow} y2={yNow} className="cv-past" />
      <line x1={xNow} y1={yNow} x2={x(a.endSlot)} y2={y(a.endPrice)} className="cv-future" />
      {a.fills.map((f) => (
        <circle key={f.sig} cx={x(f.slot)} cy={y(f.price)} r="3" className="cv-fill" />
      ))}
      <circle cx={xNow} cy={yNow} r="4.5" className="cv-now" />
      <text x={Math.min(xNow + 8, W - 110)} y={Math.max(yNow - 8, padT + 6)} className="cv-t">
        now {num(price, 5)}
      </text>
      <text x={padL} y={H - 8} className="cv-t">
        start {num(a.startPrice, 5)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" className="cv-t">
        floor {num(a.endPrice, 5)}
      </text>
    </svg>
  );
}

function FillForm({ a, price, remaining, sellSym, buySym, sellDecimals, sellPriceUsd }: { a: Auction; price: number; remaining: number; sellSym: string; buySym: string; sellDecimals: number; buyDecimals: number; sellPriceUsd?: number }) {
  const [amtStr, setAmtStr] = useState("");
  const amt = Math.min(remaining, Number(amtStr.replace(/,/g, "")) || 0);
  const cost = amt * price;
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  const fill = async () => {
    if (!wallet.publicKey) return setVisible(true);
    setBusy(true);
    setMsg(null);
    try {
      const client = await createClient({ connection, wallet });
      const tx = await client.fillAuction(new PublicKey(a.pda), BigInt(Math.round(amt * 10 ** sellDecimals)));
      const steps = await runTxPipeline({ connection, wallet, txs: [tx], labels: ["fill_auction"], onUpdate: () => {} });
      setMsg({ ok: true, text: "Filled", sig: steps[0].signature });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SdkUnavailableError ? "SDK unavailable: the index mint is not configured." : e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fillform">
      <div className="fill-grid">
        <label>
          <span className="micro muted">Buy {sellSym}</span>
          <span className="field">
            <input inputMode="decimal" value={amtStr} onChange={(e) => setAmtStr(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" />
            <button type="button" className="copybtn" onClick={() => setAmtStr(String(Math.floor(remaining)))}>
              max
            </button>
          </span>
        </label>
        <div>
          <span className="micro muted">You pay · {buySym}</span>
          <div className="field field-static">
            <span className="m">{amt > 0 ? cost.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
            {sellPriceUsd && amt > 0 ? <span className="faint">≈ {usd(amt * sellPriceUsd)}</span> : null}
          </div>
        </div>
        <Button variant="primary" disabled={busy || amt <= 0} onClick={fill}>
          {busy ? "Filling" : "Fill"}
        </Button>
      </div>
      {msg && (
        <p className={msg.ok ? "faint" : "field-err"} role="status">
          {msg.text}
          {msg.sig && (
            <>
              {" · "}
              <Address value={msg.sig} kind="tx" head={6} tail={6} />
            </>
          )}
        </p>
      )}
      <p className="faint">Filling bumps the fund epoch and invalidates open mint sessions.</p>
    </div>
  );
}
