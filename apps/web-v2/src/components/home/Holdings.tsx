"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFund, useHoldings, useVerify } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { coinColor } from "@/lib/coin";
import { compact, int, usd } from "@/lib/format";

const usd2 = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "(devnet)" in a token name is a test-mint artefact, not part of the name. It is shown as a small tag instead. */
function splitName(name: string): { name: string; tag: string | null } {
  const m = name.match(/^(.*?)\s*\((devnet|testnet|localnet)\)\s*$/i);
  return m ? { name: m[1], tag: m[2].toLowerCase() } : { name, tag: null };
}
import type { Holding } from "@/lib/schemas";
import { EASE_SETTLE, readSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Delta } from "../ui/Delta";
import { Flash } from "../ui/Flash";
import { Notes } from "../ui/Fn";
import { SectionHead } from "../ui/SectionHead";
import { TokenLogo } from "../ui/TokenLogo";

type Key = "slot" | "symbol" | "weight" | "drift" | "price" | "chg" | "value" | "mcap";
type Dir = "asc" | "desc";

const COLS: { key: Key; label: string; align?: "r"; cls: string }[] = [
  { key: "slot", label: "#", cls: "c-idx" },
  { key: "symbol", label: "Token", cls: "c-tok" },
  { key: "weight", label: "Weight / target", cls: "c-wt" },
  { key: "drift", label: "Drift", align: "r", cls: "c-drift" },
  { key: "price", label: "Price", align: "r", cls: "c-price" },
  { key: "chg", label: "24h", align: "r", cls: "c-chg" },
  { key: "value", label: "Value", align: "r", cls: "c-val" },
  { key: "mcap", label: "Mkt cap", align: "r", cls: "c-mcap" },
];

const pick: Record<Key, (h: Holding) => number | string> = {
  slot: (h) => h.slot,
  symbol: (h) => h.symbol.toLowerCase(),
  weight: (h) => h.weightBps,
  drift: (h) => h.driftBps,
  price: (h) => h.priceUsd,
  chg: (h) => h.change24hPct ?? -Infinity,
  value: (h) => h.valueUsd,
  mcap: (h) => h.marketCapUsd ?? -Infinity,
};

export function Holdings() {
  const { data, isLoading } = useHoldings();
  const { data: verify } = useVerify();
  const { data: fund } = useFund();
  const asOf = useAsOf();
  const [sort, setSort] = useState<{ key: Key; dir: Dir }>({ key: "weight", dir: "desc" });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = (data ?? []).slice();
    const get = pick[sort.key];
    list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : (x as number) - (y as number);
      return sort.dir === "asc" ? c : -c;
    });
    return list;
  }, [data, sort]);

  const scaleMax = useMemo(() => Math.max(1, ...(data ?? []).map((h) => Math.max(h.weightBps, h.targetWeightBps))) * 1.12, [data]);
  const ownedBy = useMemo(() => new Map((verify?.vaults ?? []).map((v) => [v.vault, v.owner])), [verify]);
  const toggle = (k: Key) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "symbol" || k === "slot" ? "asc" : "desc" }));
  const clock = asOf ? `${utcClock(asOf)} UTC` : undefined;

  return (
    <section className="sec" aria-labelledby="holdings-h">
      <SectionHead n={2} title={<span id="holdings-h">Holdings</span>} />
      <p className="sec-lede">What is in the vault right now. Each bar is the coin&apos;s weight; the ink tick is its target. The gap between them is the drift.</p>

      <div className="mobile-sort">
        <label className="micro muted" htmlFor="hold-sort">
          Sort by
        </label>
        <select id="hold-sort" value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(":"); setSort({ key: k as Key, dir: d as Dir }); }}>
          {COLS.filter((c) => c.key !== "slot").flatMap((c) => [
            <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ▼</option>,
            <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ▲</option>,
          ])}
        </select>
      </div>

      <div className="hold" role="table" aria-label="Fund holdings" aria-rowcount={rows.length + 1}>
        <div className="hrow hhead" role="row">
          {COLS.map((c) => (
            <div key={c.key} role="columnheader" className={cn(c.cls, c.align === "r" && "r")} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" className={cn("sortbtn micro", sort.key === c.key && "is-active")} onClick={() => toggle(c.key)}>
                {c.label}
                <span className="sortglyph" aria-hidden>
                  {sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div role="rowgroup">
          {isLoading && !data && Array.from({ length: 6 }).map((_, i) => <div key={i} className="hrow hskel" aria-hidden />)}
          {data && data.length === 0 && <p className="empty-note">No constituents in the vault yet.</p>}
          {rows.map((h, i) => (
            <HoldingRow key={h.mint} h={h} i={i} scaleMax={scaleMax} open={open === h.mint} onToggle={() => setOpen(open === h.mint ? null : h.mint)} owner={ownedBy.get(h.vault)} fundPda={verify?.fundPda ?? fund?.fundPda} />
          ))}
        </div>
      </div>

      <Notes
        notes={[{ label: "Weights are vault balances × keeper prices ÷ total vault value. Target weights are stored per asset in the fund account", address: fund?.fundPda ?? verify?.fundPda }]}
        asOf={clock}
      />
    </section>
  );
}

function HoldingRow({ h, i, scaleMax, open, onToggle, owner, fundPda }: { h: Holding; i: number; scaleMax: number; open: boolean; onToggle: () => void; owner?: string; fundPda?: string }) {
  const introDone = useRef(false);
  const spring = readSpring();
  const w = (h.weightBps / scaleMax) * 100;
  const t = (h.targetWeightBps / scaleMax) * 100;
  // Bars grow from 0 on mount with a 30ms stagger per row, then follow each update with the spring.
  const delay = introDone.current ? 0 : Math.min(i, 14) * 0.03;
  useEffect(() => {
    const t = setTimeout(() => (introDone.current = true), 1200);
    return () => clearTimeout(t);
  }, []);
  const id = `hrow-${h.mint.slice(0, 8)}`;
  const owned = owner && fundPda ? owner === fundPda : null;
  const nm = splitName(h.name);
  const driftPct = h.driftBps / 100;

  return (
    <div className={cn("hwrap", open && "is-open")} style={{ ["--coin" as string]: coinColor(h.mint) }}>
      <div className="hrow hbody" role="row" onClick={onToggle}>
        <div className="c-idx m muted" role="cell" title="Rank in the current sort">
          {i + 1}
        </div>
        <div className="c-tok" role="cell">
          <button type="button" className="rowbtn" aria-expanded={open} aria-controls={id} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            <TokenLogo symbol={h.symbol} mint={h.mint} src={h.logo} />
            <span className="tok-t">
              <span className="tok-s">{h.symbol}</span>
              <span className="tok-n" title={nm.name}>
                {nm.name}
                {nm.tag && <span className="tok-tag">{nm.tag}</span>}
              </span>
            </span>
            {h.status === "removing" && <span className="chip chip-pending">removing</span>}
          </button>
        </div>
        <div className="c-wt" role="cell">
          <span className="wt-t m">
            {(h.weightBps / 100).toFixed(2)}% <span className="faint">/ {(h.targetWeightBps / 100).toFixed(2)}%</span>
            <span className="wt-drift">
              <span className="faint">drift </span>
              <Delta value={driftPct} digits={2} />
            </span>
          </span>
          <span className="bartrack" aria-hidden>
            <motion.span className="barfill" initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ ...spring, delay }} />
            <motion.span className="bartick" initial={{ y: -4, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring, delay: delay + 0.25 }} style={{ left: `${t}%` }} />
          </span>
        </div>
        <div className="c-drift r m" role="cell">
          <Flash value={h.driftBps}>
            <Delta value={driftPct} digits={2} />
          </Flash>
        </div>
        <div className="c-price r m" role="cell">
          <Flash value={h.priceUsd}>{usd(h.priceUsd)}</Flash>
        </div>
        <div className="c-chg r m" role="cell">
          <Flash value={h.change24hPct}>
            <Delta value={h.change24hPct} />
          </Flash>
        </div>
        <div className="c-val r m" role="cell">
          <Flash value={h.valueUsd}>{usd2(h.valueUsd)}</Flash>
        </div>
        <div className="c-mcap r m muted" role="cell">
          {h.marketCapUsd != null ? "$" + compact(h.marketCapUsd, 1) : "—"}
        </div>
        {/* Phone layout only (see pages.css): the second row of the ruled list with its own micro labels. */}
        <div className="hsub" role="cell" aria-label="Price, 24h change and value">
          <div>
            <span className="micro muted">Price</span>
            <span className="m">{usd(h.priceUsd)}</span>
          </div>
          <div>
            <span className="micro muted">24h</span>
            <span className="m">
              <Delta value={h.change24hPct} />
            </span>
          </div>
          <div>
            <span className="micro muted">Value</span>
            <span className="m">{usd2(h.valueUsd)}</span>
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={id} className="hpanel" role="region" aria-label={`${h.symbol} vault details`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: EASE_SETTLE }}>
            <dl className="hpanel-in">
              <div>
                <dt className="micro muted">Vault account</dt>
                <dd>
                  <Address value={h.vault} head={6} tail={6} />
                </dd>
              </div>
              <div>
                <dt className="micro muted">Mint</dt>
                <dd>
                  <Address value={h.mint} kind="token" head={6} tail={6} />
                </dd>
              </div>
              <div>
                <dt className="micro muted">Balance</dt>
                <dd className="m">
                  {h.balanceUi.toLocaleString("en-US", { maximumFractionDigits: 4 })} {h.symbol}
                </dd>
              </div>
              <div>
                <dt className="micro muted">Owner</dt>
                <dd>
                  {owned == null ? <span className="faint">checking</span> : owned ? <span className="chip chip-verified">owned by fund PDA ✓</span> : <span className="chip chip-down">owner is not the fund PDA ×</span>}
                </dd>
              </div>
              <div>
                <dt className="micro muted">Decimals</dt>
                <dd className="m">{int(h.decimals)}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
