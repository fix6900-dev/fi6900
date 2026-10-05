"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuctions, useHoldings } from "@/lib/api";
import { fromRaw, num, pct, tokens, usd } from "@/lib/format";
import { createClient, runTxPipeline, SdkUnavailableError } from "@/lib/sdk";
import type { Auction, Holding } from "@/lib/schemas";
import { useNow } from "../ui/Countdown";
import { useChangedAt } from "@/lib/useStream";
import { cn, truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardHeader, PageHeader, SectionHeader } from "../ui/Card";
import { LiveDot } from "../ui/LivePill";
import { NumberTicker } from "../ui/NumberTicker";
import { Skeleton } from "../ui/Skeleton";
import { Table, TableWrap, Td, Th, THead } from "../ui/Table";
import { TokenLogo } from "../ui/TokenLogo";

const SLOT_MS = 400;

export function AuctionsView() {
  const { data, isLoading } = useAuctions("all");
  const { data: holdings } = useHoldings();
  const byMint = useMemo(() => new Map((holdings ?? []).map((h) => [h.mint, h])), [holdings]);
  const open = (data ?? []).filter((a) => a.status === "open");
  const past = (data ?? []).filter((a) => a.status !== "open");

  return (
    <div className="wrap page">
      <PageHeader
        eyebrow="Rebalancing"
        title="Dutch auctions. No oracle."
        desc="To move an overweight asset into an underweight one, the rebalancer opens an auction whose price decays linearly from a premium to a discount. Anyone can fill any amount at the current price."
      />

      <section className="mb-16 sm:mb-20">
        <SectionHeader eyebrow="Open" title={<span>Live auctions{open.length > 0 && <span className="ml-3 font-mono text-base font-normal text-muted">{open.length}</span>}</span>} />
        {isLoading && !data ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className="h-[420px] rounded-lg" />
            <Skeleton className="h-[420px] rounded-lg" />
          </div>
        ) : open.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-sm font-medium">No open auctions</div>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted">All constituents are within the drift band. Auctions open on the weekly schedule or when any asset drifts more than 50% above or below its target weight.</p>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {open.map((a) => (
              <AuctionCard key={a.pda} a={a} sell={byMint.get(a.sellMint)} buy={byMint.get(a.buyMint)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader eyebrow="History" title="Past auctions" />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th className="pl-4">Pair</Th>
                <Th align="right">Sold</Th>
                <Th align="right">Avg price</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Fills
                </Th>
                <Th align="right" className="hidden md:table-cell">
                  Slots
                </Th>
                <Th align="right" className="pr-4">
                  Status
                </Th>
              </tr>
            </THead>
            <tbody>
              {past.length === 0 ? (
                <tr>
                  <td colSpan={6} className="h-20 text-center text-sm text-muted">
                    No past auctions yet.
                  </td>
                </tr>
              ) : (
                past.map((a) => {
                  const s = byMint.get(a.sellMint);
                  const b = byMint.get(a.buyMint);
                  const sd = a.sellDecimals ?? s?.decimals ?? 6;
                  const sold = fromRaw(a.sellTotal, sd) - fromRaw(a.sellRemaining, sd);
                  const avg = a.fills.length ? a.fills.reduce((x, f) => x + f.price, 0) / a.fills.length : null;
                  return (
                    <tr key={a.pda} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                      <td className="h-11 pl-4 pr-3">
                        <PairLabel a={a} sell={s} buy={b} size={18} />
                      </td>
                      <Td align="right" mono>
                        {sold.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-muted">{a.sellSymbol ?? s?.symbol}</span>
                      </Td>
                      <Td align="right" mono className="text-muted">
                        {avg != null ? num(avg, 4) : "—"}
                      </Td>
                      <Td align="right" mono className="hidden sm:table-cell">
                        {a.fills.length}
                      </Td>
                      <Td align="right" mono className="hidden text-muted md:table-cell">
                        {a.startSlot.toLocaleString()} → {a.endSlot.toLocaleString()}
                      </Td>
                      <td className="h-11 pl-3 pr-4 text-right">
                        {/* Filled is the normal outcome: plain text. Only exceptions get a pill. */}
                        {a.status === "filled" ? <span className="font-mono text-xs text-muted">filled</span> : <Badge tone={a.status === "expired" ? "amber" : "neutral"}>{a.status}</Badge>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </TableWrap>
      </section>
    </div>
  );
}

function PairLabel({ a, sell, buy, size = 20 }: { a: Auction; sell?: Holding; buy?: Holding; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
      <TokenLogo symbol={a.sellSymbol ?? sell?.symbol ?? "?"} src={sell?.logo} size={size} />
      {a.sellSymbol ?? sell?.symbol ?? truncateMiddle(a.sellMint)}
      <ArrowRight size={12} className="text-muted" />
      <TokenLogo symbol={a.buySymbol ?? buy?.symbol ?? "?"} src={buy?.logo} size={size} />
      {a.buySymbol ?? buy?.symbol ?? truncateMiddle(a.buyMint)}
    </span>
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

  // Estimate current slot if the API didn't send one: advance from the last known point.
  const dur = Math.max(1, a.endSlot - a.startSlot);
  const baseSlot = a.currentSlot ?? a.startSlot + Math.round(((a.startPrice - a.currentPrice) / Math.max(1e-12, a.startPrice - a.endPrice)) * dur);
  const slot = Math.min(a.endSlot, baseSlot + (now ? Math.floor(Math.max(0, now - changedAt) / SLOT_MS) * (changedAt ? 1 : 0) : 0));
  const elapsed = Math.min(Math.max(slot - a.startSlot, 0), dur);
  const price = a.startPrice - (a.startPrice - a.endPrice) * (elapsed / dur);
  const mid = a.jupiterMidPrice ?? (sell && buy ? sell.priceUsd / buy.priceUsd : null);
  const vsMid = mid ? (price / mid - 1) * 100 : null;
  const slotsLeft = Math.max(0, a.endSlot - slot);
  const sellSym = a.sellSymbol ?? sell?.symbol ?? "SELL";
  const buySym = a.buySymbol ?? buy?.symbol ?? "BUY";

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <LiveDot /> Open · {slotsLeft.toLocaleString()} slots left · ~{Math.round((slotsLeft * SLOT_MS) / 1000 / 60)} min
          </span>
        }
        title={<PairLabel a={a} sell={sell} buy={buy} />}
        right={<Address value={a.pda} head={4} tail={4} />}
      />
      <div className="grid grid-cols-3 gap-px border-b border-line bg-line">
        <Cell label="Price" value={<NumberTicker value={price} format={(n) => num(n, 5)} reserve="0.00000" />} sub={`${buySym} per ${sellSym}`} />
        <Cell label="vs Jupiter mid" value={vsMid != null ? <span className={cn(vsMid > 0 && "text-amber")}>{pct(vsMid, 2)}</span> : "—"} sub={mid != null ? `mid ${num(mid, 5)}` : undefined} />
        <Cell label="Remaining" value={<NumberTicker value={remaining} format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 })} />} sub={`${filledPct.toFixed(1)}% filled`} />
      </div>
      <div className="px-5 pt-5">
        <PriceCurve a={a} slot={slot} price={price} mid={mid} />
      </div>
      <FillForm a={a} price={price} remaining={remaining} sellSym={sellSym} buySym={buySym} sellDecimals={sd} buyDecimals={bd} sellPriceUsd={sell?.priceUsd} />
      {a.fills.length > 0 && (
        <div className="border-t border-line">
          <div className="eyebrow px-5 pb-1 pt-4">Fills</div>
          <Table>
            <tbody>
              {a.fills
                .slice()
                .sort((x, y) => y.slot - x.slot)
                .slice(0, 6)
                .map((f) => (
                  <tr key={f.sig} className="border-t border-line">
                    <td className="h-10 pl-5 pr-3">
                      <Address value={f.sig} kind="tx" head={6} tail={6} copy={false} />
                    </td>
                    <Td align="right" mono className="hidden text-muted sm:table-cell">
                      {truncateMiddle(f.filler, 4, 4)}
                    </Td>
                    <Td align="right" mono>
                      {tokens(f.sellAmount, sd, 2)} {sellSym}
                    </Td>
                    <Td align="right" mono className="text-muted">
                      @ {num(f.price, 5)}
                    </Td>
                    <Td align="right" mono className="hidden pr-5 text-muted md:table-cell">
                      slot {f.slot.toLocaleString()}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Cell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="eyebrow truncate">{label}</div>
      <div className="num mt-1.5 font-mono text-base font-medium sm:text-lg">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PriceCurve({ a, slot, price, mid }: { a: Auction; slot: number; price: number; mid: number | null }) {
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
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  const xNow = x(slot);
  const yNow = y(price);
  const fills = a.fills ?? [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Decaying auction price with current slot marker">
      {/* mid line */}
      {mid != null && (
        <>
          <line x1={padL} x2={W - padR} y1={y(mid)} y2={y(mid)} stroke="rgba(232,234,237,0.3)" strokeDasharray="3 4" />
          <text x={W - padR} y={y(mid) - 5} textAnchor="end" fill="#8B919A" fontSize="11" fontFamily="var(--font-mono)">
            Jupiter mid {num(mid, 5)}
          </text>
        </>
      )}
      {/* decay line: elapsed (accent) + future (dim) */}
      <line x1={x(a.startSlot)} y1={y(a.startPrice)} x2={xNow} y2={yNow} stroke="#B6FF3B" strokeWidth="1.5" />
      <line x1={xNow} y1={yNow} x2={x(a.endSlot)} y2={y(a.endPrice)} stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="2 3" />
      {/* fills */}
      {fills.map((f) => (
        <circle key={f.sig} cx={x(f.slot)} cy={y(f.price)} r="3" fill="#0A0B0D" stroke="#E8EAED" strokeWidth="1.25" />
      ))}
      {/* now marker (static: the live dot is the only pulsing element) */}
      <line x1={xNow} x2={xNow} y1={padT - 4} y2={H - padB} stroke="#B6FF3B" strokeWidth="1" opacity="0.5" />
      <circle cx={xNow} cy={yNow} r="4" fill="#B6FF3B" />
      <text x={Math.min(xNow + 8, W - 110)} y={Math.max(yNow - 8, padT + 6)} fill="#B6FF3B" fontSize="11" fontFamily="var(--font-mono)">
        now {num(price, 5)}
      </text>
      {/* axis labels */}
      <text x={padL} y={H - 8} fill="#8B919A" fontSize="11" fontFamily="var(--font-mono)">
        slot {a.startSlot.toLocaleString()} · start {num(a.startPrice, 5)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" fill="#8B919A" fontSize="11" fontFamily="var(--font-mono)">
        end {num(a.endPrice, 5)} · slot {a.endSlot.toLocaleString()}
      </text>
    </svg>
  );
}

function FillForm({
  a,
  price,
  remaining,
  sellSym,
  buySym,
  sellDecimals,
  sellPriceUsd,
}: {
  a: Auction;
  price: number;
  remaining: number;
  sellSym: string;
  buySym: string;
  sellDecimals: number;
  buyDecimals: number;
  sellPriceUsd?: number;
}) {
  const [amtStr, setAmtStr] = useState("");
  const amt = Math.min(remaining, Number(amtStr.replace(/,/g, "")) || 0);
  const cost = amt * price;
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; sig?: string } | null>(null);

  const fill = async () => {
    if (!wallet.publicKey) {
      setVisible(true);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const client = await createClient({ connection, wallet });
      const tx = await client.fillAuction(new PublicKey(a.pda), BigInt(Math.round(amt * 10 ** sellDecimals)));
      const steps = await runTxPipeline({ connection, wallet, txs: [tx], labels: ["fill_auction"], onUpdate: () => {} });
      setMsg({ kind: "ok", text: "Filled", sig: steps[0].signature });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof SdkUnavailableError ? "SDK unavailable: the @fi6900/sdk package is not in this build yet." : e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Buy {sellSym}</span>
          <span className="field">
            <input inputMode="decimal" value={amtStr} onChange={(e) => setAmtStr(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0" className="h-10 w-full bg-transparent font-mono text-base tabular-nums" />
            <button type="button" onClick={() => setAmtStr(String(Math.floor(remaining)))} className="text-[11px] font-medium text-muted hover:text-accent">
              MAX
            </button>
          </span>
        </label>
        <div>
          <span className="eyebrow mb-1.5 block">You pay · {buySym}</span>
          <div className="field h-10 justify-between font-mono text-base tabular-nums">
            <span>{amt > 0 ? cost.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
            {sellPriceUsd && amt > 0 && <span className="text-xs text-muted">≈ {usd(amt * sellPriceUsd)}</span>}
          </div>
        </div>
        <Button variant="primary" size="lg" className="h-10" disabled={busy || amt <= 0} onClick={fill}>
          {busy && <Loader2 size={14} className="animate-spin" />} Fill
        </Button>
      </div>
      {msg && (
        <div className={cn("mt-3 text-xs", msg.kind === "ok" ? "text-accent" : "text-neg")}>
          {msg.text}
          {msg.sig && (
            <>
              {" · "}
              <Address value={msg.sig} kind="tx" head={6} tail={6} />
            </>
          )}
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        <span className="font-mono">buy_amount = ceil(sell_amount × price)</span>. Filling bumps the fund epoch and invalidates open mint sessions.
      </p>
    </div>
  );
}
