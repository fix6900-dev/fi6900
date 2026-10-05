"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAirdrops, useFlywheel, useFlywheelEvents } from "@/lib/api";
import { compact, dateTime, num, relTime } from "@/lib/format";
import type { EventKind, FlywheelEvent } from "@/lib/schemas";
import { solscanTx } from "@/lib/solscan";
import { cn, truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Card, CardHeader, PageHeader } from "../ui/Card";
import { Countdown, useNow } from "../ui/Countdown";
import { NumberTicker } from "../ui/NumberTicker";
import { Skeleton } from "../ui/Skeleton";
import { Table, TableWrap, Td, Th, THead } from "../ui/Table";
import { FeeFlowDiagram } from "./FeeFlowDiagram";

/** Kind labels. Burns are the one kind drawn in colour; everything else is plain text. */
const KIND_META: Record<EventKind, { label: string; tone?: "neg" | "accent" }> = {
  claim: { label: "Claim" },
  buy_index: { label: "Buy index" },
  add_lp: { label: "Add LP" },
  airdrop: { label: "Airdrop", tone: "accent" },
  buyback: { label: "Buyback" },
  burn: { label: "Burn", tone: "neg" },
  create: { label: "Create" },
  redeem: { label: "Redeem" },
  auction_start: { label: "Auction open" },
  auction_fill: { label: "Auction fill" },
  fee_accrual: { label: "Fee accrual" },
};

export function FlywheelView() {
  const { data } = useFlywheel();
  return (
    <div className="wrap page">
      <PageHeader
        eyebrow="Flywheel"
        title="The coin funds the index. The index burns the coin."
        desc="$FI creator fees are split: half becomes permanent FI6900/SOL liquidity, half creates units airdropped to $FI holders every 15 minutes. Index fees are redeemed for SOL and 75% buys and burns $FI."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5 sm:p-6">
          <FeeFlowDiagram data={data} />
        </Card>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line hairline lg:grid-cols-1">
          <Counter label="Creator fees claimed" value={data?.creatorFeesClaimedSol} fmt={(n) => num(n, 2)} unit="SOL" />
          <Counter label="LP added" value={data?.lpAddedSol} fmt={(n) => num(n, 2)} unit="SOL" />
          <Counter label="Units airdropped" value={data?.airdroppedUnits} fmt={(n) => compact(n, 2)} unit="$FI6900" sub={data ? `${data.airdropRounds.toLocaleString()} rounds` : undefined} />
          <Counter label="$FI burned" value={data?.burnedCoin} fmt={(n) => compact(n, 2)} unit="$FI" sub={data ? `${num(data.buybackSol, 2)} SOL of buybacks` : undefined} />
          <div className="bg-surface p-5">
            <div className="eyebrow mb-2">Next airdrop</div>
            <div className="num text-xl font-medium sm:text-2xl">
              <Countdown to={data?.next.airdropAt} compact showDays={false} />
            </div>
            <div className="mt-1 text-xs text-muted">every 15 min · dust carried forward</div>
          </div>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-4 sm:mt-20 lg:grid-cols-[380px_minmax(0,1fr)]">
        <AirdropLookup />
        <EventFeed />
      </div>
    </div>
  );
}

function Counter({ label, value, fmt, unit, sub }: { label: string; value?: number; fmt: (n: number) => string; unit: string; sub?: string }) {
  return (
    <div className="bg-surface p-5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="num flex items-baseline gap-1.5 text-xl font-medium tracking-[-0.01em] sm:text-2xl">
        {value != null ? <NumberTicker value={value} format={fmt} /> : <Skeleton className="h-6 w-24" />}
        <span className="text-xs font-normal text-muted">{unit}</span>
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function AirdropLookup() {
  const wallet = useWallet();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    if (wallet.publicKey && !input) {
      const k = wallet.publicKey.toBase58();
      setInput(k);
      setQuery(k);
    }
  }, [wallet.publicKey, input]);
  const { data, isLoading, isError } = useAirdrops(query);
  const total = useMemo(() => (data ?? []).reduce((a, r) => a + r.units, 0), [data]);
  return (
    <Card className="self-start">
      <CardHeader eyebrow="Airdrops" title="Look up a wallet" />
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim().length >= 32) setQuery(input.trim());
        }}
      >
        <div className="field">
          <Search size={14} className="shrink-0 text-dim" />
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Wallet address" className="h-10 w-full bg-transparent font-mono text-[13px] placeholder:text-dim" aria-label="Wallet address" />
          {wallet.publicKey && (
            <button
              type="button"
              className="shrink-0 text-dim hover:text-accent"
              title="Use connected wallet"
              onClick={() => {
                const k = wallet.publicKey!.toBase58();
                setInput(k);
                setQuery(k);
              }}
            >
              <Wallet size={14} />
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" className="mt-3 w-full" disabled={input.trim().length < 32}>
          Look up
        </Button>
      </form>
      <div className="border-t border-line">
        {!query ? (
          <p className="p-5 text-xs leading-relaxed text-muted">Connect a wallet or paste an address to see every airdrop round it received.</p>
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-48" />
          </div>
        ) : isError ? (
          <p className="p-5 text-xs text-neg">Lookup failed. Check the address.</p>
        ) : !data || data.length === 0 ? (
          <p className="p-5 text-xs leading-relaxed text-muted">No airdrops recorded for {truncateMiddle(query, 6, 6)}. Hold $FI above the minimum balance to be included in the next round.</p>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3 text-xs">
              <span className="text-muted">{data.length} rounds</span>
              <span className="font-mono">
                {num(total, 4)} <span className="text-muted">units total</span>
              </span>
            </div>
            <div className="max-h-[360px] overflow-auto">
              <Table>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.roundId} className="border-t border-line">
                      <Td mono className="pl-5 text-muted">
                        #{r.roundId}
                      </Td>
                      <Td mono className="text-muted">
                        {dateTime(r.ts)}
                      </Td>
                      <Td mono align="right">
                        +{num(r.units, 4)}
                      </Td>
                      <td className="h-11 pl-3 pr-5 text-right">
                        <Address value={r.sig} kind="tx" head={4} tail={4} copy={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function EventFeed() {
  const { data, isLoading } = useFlywheelEvents(50);
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const now = useNow(10_000);
  const list = useMemo(() => (data ?? []).filter((e) => filter === "all" || e.kind === filter), [data, filter]);
  const kinds = Object.keys(KIND_META) as EventKind[];
  return (
    <Card className="min-w-0">
      <CardHeader
        eyebrow="Event feed"
        title="Every action, signed"
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value as EventKind | "all")} className="field h-8 text-xs text-muted" aria-label="Filter events">
            <option value="all">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_META[k].label}
              </option>
            ))}
          </select>
        }
      />
      <TableWrap className="rounded-none bg-transparent shadow-none" maxHeight="720px">
        <Table>
          <THead>
            <tr>
              <Th className="pl-5">Kind</Th>
              <Th>Detail</Th>
              <Th align="right" className="hidden sm:table-cell">
                Amounts
              </Th>
              <Th align="right">When</Th>
              <Th align="right" className="pr-5">
                Tx
              </Th>
            </tr>
          </THead>
          <tbody>
            {isLoading && !data ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="h-11 px-5">
                    <Skeleton className="h-3 w-16" />
                  </td>
                  <td className="h-11 px-3">
                    <Skeleton className="h-3 w-48" />
                  </td>
                  <td className="hidden h-11 px-3 sm:table-cell">
                    <Skeleton className="h-3 w-20" />
                  </td>
                  <td className="h-11 px-3">
                    <Skeleton className="h-3 w-12" />
                  </td>
                  <td className="h-11 px-5">
                    <Skeleton className="h-3 w-20" />
                  </td>
                </tr>
              ))
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={5} className="h-20 text-center text-sm text-muted">
                  No events.
                </td>
              </tr>
            ) : (
              <AnimatePresence initial={false}>
                {list.map((e) => (
                  <EventRow key={String(e.id)} e={e} now={now ?? Date.now()} />
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function fmtAmounts(a: Record<string, number | string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(a)) {
    const n = typeof v === "number" ? v : Number(v);
    const isInt = k === "wallets" || k === "coin";
    const s = Number.isFinite(n) ? (Math.abs(n) >= 1000 ? compact(n, 2) : isInt ? String(Math.round(n)) : num(n, n < 1 ? 4 : 2)) : String(v);
    const unit = k === "sol" ? "SOL" : k === "units" ? "units" : k === "coin" ? "$FI" : k === "wallets" ? "wallets" : k === "sellAmount" ? "sold" : k === "buyAmount" ? "bought" : k.replace(/([A-Z])/g, " $1").toLowerCase();
    parts.push(`${s} ${unit}`);
  }
  return parts.join(" · ");
}

function EventRow({ e, now }: { e: FlywheelEvent; now: number }) {
  const meta = KIND_META[e.kind];
  return (
    <motion.tr layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="border-b border-line last:border-0">
      <td className={cn("h-11 pl-5 pr-3 text-[13px] font-medium", meta.tone === "neg" ? "text-neg" : meta.tone === "accent" ? "text-accent" : "text-text")}>{meta.label}</td>
      <td className="h-11 px-3 text-[13px] text-muted" title={e.note ?? ""}>
        <div className="max-w-[160px] truncate lg:max-w-[260px]">{e.note ?? "—"}</div>
      </td>
      <td className="hidden h-11 px-3 text-right font-mono text-[13px] sm:table-cell">
        <div className="ml-auto max-w-[220px] truncate" title={fmtAmounts(e.amounts)}>
          {fmtAmounts(e.amounts)}
        </div>
      </td>
      <Td align="right" mono className="text-muted">
        <span title={dateTime(e.ts)}>{relTime(e.ts, now)}</span>
      </Td>
      <td className="h-11 pl-3 pr-5 text-right">
        {e.sig ? (
          <a href={solscanTx(e.sig)} target="_blank" rel="noreferrer noopener" className="whitespace-nowrap font-mono text-xs text-muted hover:text-accent">
            {truncateMiddle(e.sig, 5, 5)} ↗
          </a>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </motion.tr>
  );
}
