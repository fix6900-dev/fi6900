"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useHoldings } from "@/lib/api";
import { bpsToPct, compact, tokens, usd } from "@/lib/format";
import { useChangedAt } from "@/lib/useStream";
import type { Holding } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Badge } from "../ui/Badge";
import { NumberTicker } from "../ui/NumberTicker";
import { SkeletonRows } from "../ui/Skeleton";
import { Delta } from "../ui/Stat";
import { EmptyRow, SortTh, Table, TableWrap, Th, THead } from "../ui/Table";
import { TokenLogo } from "../ui/TokenLogo";

type SortKey = "symbol" | "weightBps" | "driftBps" | "priceUsd" | "change24hPct" | "valueUsd" | "marketCapUsd";
type Dir = "asc" | "desc";
const COLS = 9;

/** Background flash on change. Used only for price and 24h. */
function Flash({ keyId, children, className, neg }: { keyId: string; children: React.ReactNode; className?: string; neg?: boolean }) {
  const at = useChangedAt(keyId);
  return (
    <span key={at} className={cn("-mx-1 rounded-sm px-1", at ? (neg ? "flash-cell-neg" : "flash-cell") : "", className)}>
      {children}
    </span>
  );
}

/** One thin bar for actual weight, one 1px tick for target. */
export function WeightBar({ actual, target, max }: { actual: number; target: number; max: number }) {
  const a = Math.min(100, (actual / max) * 100);
  const t = Math.min(100, (target / max) * 100);
  return (
    <div className="relative h-3 w-full min-w-[72px]" title={`actual ${bpsToPct(actual)} · target ${bpsToPct(target)}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-surface-3" />
      <motion.div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-text/60" animate={{ width: `${a}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
      <motion.div className="absolute inset-y-0 w-px bg-muted" animate={{ left: `${t}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
    </div>
  );
}

export function HoldingsTable() {
  const { data, isLoading } = useHoldings();
  const [sortKey, setSortKey] = useState<SortKey>("weightBps");
  const [dir, setDir] = useState<Dir>("desc");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const toggle = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "symbol" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const list = (data ?? []).filter((h) => !q || h.symbol.toLowerCase().includes(q.toLowerCase()) || h.name.toLowerCase().includes(q.toLowerCase()));
    const m = dir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * m;
      return ((Number(av) || 0) - (Number(bv) || 0)) * m;
    });
  }, [data, sortKey, dir, q]);

  const maxW = useMemo(() => Math.max(...(data ?? []).map((h) => Math.max(h.weightBps, h.targetWeightBps)), 1) * 1.15, [data]);
  const total = useMemo(() => (data ?? []).reduce((a, h) => a + h.valueUsd, 0), [data]);


  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>
            <span className="font-mono text-text">{data?.length ?? "—"}</span> constituents
          </span>
          <span className="hidden sm:inline">
            <span className="font-mono text-text">{usd(total, { compact: true })}</span> vault value
          </span>
          <span className="hidden items-center gap-1.5 sm:inline-flex">
            <span className="inline-block h-[3px] w-4 rounded-full bg-text/60" /> actual
            <span className="ml-2 inline-block h-3 w-px bg-muted" /> target
          </span>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="field h-8 w-full text-[13px] placeholder:text-dim sm:w-40" aria-label="Filter holdings" />
      </div>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <Th className="w-10 pl-4">#</Th>
              <SortTh active={sortKey === "symbol"} dir={dir} onClick={() => toggle("symbol")}>
                Asset
              </SortTh>
              <SortTh active={sortKey === "weightBps"} dir={dir} onClick={() => toggle("weightBps")} className="sm:min-w-[200px]">
                Weight
              </SortTh>
              <SortTh active={sortKey === "driftBps"} dir={dir} onClick={() => toggle("driftBps")} align="right" className="hidden md:table-cell">
                Drift
              </SortTh>
              <SortTh active={sortKey === "priceUsd"} dir={dir} onClick={() => toggle("priceUsd")} align="right">
                Price
              </SortTh>
              <SortTh active={sortKey === "change24hPct"} dir={dir} onClick={() => toggle("change24hPct")} align="right">
                24h
              </SortTh>
              <SortTh active={sortKey === "valueUsd"} dir={dir} onClick={() => toggle("valueUsd")} align="right" className="hidden sm:table-cell">
                Value
              </SortTh>
              <SortTh active={sortKey === "marketCapUsd"} dir={dir} onClick={() => toggle("marketCapUsd")} align="right" className="hidden md:table-cell">
                Mkt cap
              </SortTh>
              <Th align="right" className="hidden w-24 pr-4 sm:table-cell">
                <span className="sr-only">Status</span>
              </Th>
            </tr>
          </THead>
          <LayoutGroup id="holdings">
            <tbody>
              {isLoading && !data ? (
                <SkeletonRows rows={12} cols={COLS} />
              ) : rows.length === 0 ? (
                <EmptyRow colSpan={COLS}>No constituents match.</EmptyRow>
              ) : (
                rows.map((h, i) => <Row key={h.mint} h={h} i={i} maxW={maxW} open={open === h.mint} onToggle={() => setOpen(open === h.mint ? null : h.mint)} />)
              )}
            </tbody>
          </LayoutGroup>
        </Table>
      </TableWrap>
    </div>
  );
}

function Row({ h, i, maxW, open, onToggle }: { h: Holding; i: number; maxW: number; open: boolean; onToggle: () => void }) {
  const removing = h.status === "removing";
  const outOfBand = h.targetWeightBps > 0 && Math.abs(h.driftBps) / h.targetWeightBps >= 0.5;
  const drift = `${h.driftBps > 0 ? "+" : ""}${(h.driftBps / 100).toFixed(2)}%`;
  return (
    <>
      <motion.tr
        layout="position"
        transition={{ type: "spring", stiffness: 350, damping: 36 }}
        onClick={onToggle}
        className={cn("group cursor-pointer border-b border-line transition-colors hover:bg-surface-2/50", open && "bg-surface-2/50", removing && "opacity-60")}
        aria-expanded={open}
      >
        <td className="h-11 pl-4 pr-2 font-mono text-xs text-muted">{i + 1}</td>
        <td className="h-11 px-3">
          <div className="flex items-center gap-2.5">
            <TokenLogo symbol={h.symbol} src={h.logo} size={22} />
            <span className="text-[13px] font-semibold">{h.symbol}</span>
            <span className="hidden max-w-[140px] truncate text-xs text-muted md:inline">{h.name}</span>
            <ChevronDown size={12} className={cn("text-dim opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100", open && "rotate-180 opacity-100")} />
          </div>
        </td>
        <td className="h-11 px-3">
          <div className="flex items-center gap-3">
            <div className="hidden flex-1 sm:block">
              <WeightBar actual={h.weightBps} target={h.targetWeightBps} max={maxW} />
            </div>
            <span className="w-[6.5ch] text-right font-mono text-[13px]">
              <NumberTicker value={h.weightBps} format={(n) => bpsToPct(n, 2)} />
            </span>
          </div>
        </td>
        <td className={cn("hidden h-11 px-3 text-right font-mono text-[13px] md:table-cell", outOfBand ? "text-text" : "text-muted")}>{drift}</td>
        <td className="h-11 px-3 text-right">
          <Flash keyId={`h.${h.mint}.price`} className="font-mono text-[13px]">
            <NumberTicker value={h.priceUsd} format={(n) => usd(n, { precise: true })} />
          </Flash>
        </td>
        <td className="h-11 px-3 text-right">
          <Flash keyId={`h.${h.mint}.chg`} neg={(h.change24hPct ?? 0) < 0}>
            <Delta value={h.change24hPct} size="md" className="text-[13px]" reserve />
          </Flash>
        </td>
        <td className="hidden h-11 px-3 text-right font-mono text-[13px] sm:table-cell">
          <NumberTicker value={h.valueUsd} format={(n) => usd(n, { compact: true })} />
        </td>
        <td className="hidden h-11 px-3 text-right font-mono text-[13px] text-muted md:table-cell">{h.marketCapUsd != null ? "$" + compact(h.marketCapUsd, 1) : "—"}</td>
        <td className="hidden h-11 pl-3 pr-4 text-right sm:table-cell">{removing && <Badge tone="amber">Removing</Badge>}</td>
      </motion.tr>
      <AnimatePresence initial={false}>
        {open && (
          <motion.tr key={`${h.mint}-x`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="border-b border-line bg-surface-2/30">
            <td colSpan={COLS} className="px-4 py-4">
              <dl className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="eyebrow mb-1.5">Vault</dt>
                  <dd>
                    <Address value={h.vault} head={6} tail={6} />
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow mb-1.5">Mint</dt>
                  <dd>
                    <Address value={h.mint} kind="token" head={6} tail={6} />
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow mb-1.5">Balance</dt>
                  <dd className="font-mono">
                    {tokens(h.balance, h.decimals)} <span className="text-muted">{h.symbol}</span>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow mb-1.5">Slot · Target · Drift</dt>
                  <dd className="font-mono">
                    {h.slot} · {bpsToPct(h.targetWeightBps)} · {drift}
                    {removing && <Badge tone="amber" className="ml-2 sm:hidden">Removing</Badge>}
                  </dd>
                </div>
              </dl>
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}


