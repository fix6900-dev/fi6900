"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { isDemo, ping, qk, useDemoMode } from "./api";
import { env } from "./env";
import * as mock from "./mock";
import { AuctionSchema, FlywheelEventSchema, FundSchema, HoldingsSchema, type Auction, type FlywheelEvent, type Fund, type Holding } from "./schemas";

/* ------------------------------------------------------------------ */
/* "Changed" registry: cells subscribe to flash when their key updates  */
/* ------------------------------------------------------------------ */

const changed = new Map<string, number>();
const changeListeners = new Set<() => void>();
function markChanged(keys: string[]) {
  const t = Date.now();
  for (const k of keys) changed.set(k, t);
  changeListeners.forEach((l) => l());
}
export function useChangedAt(key: string): number {
  return useSyncExternalStore(
    (l) => {
      changeListeners.add(l);
      return () => changeListeners.delete(l);
    },
    () => changed.get(key) ?? 0,
    () => 0,
  );
}

/* ------------------------------------------------------------------ */
/* Connection status                                                    */
/* ------------------------------------------------------------------ */

type StreamStatus = "connecting" | "live" | "demo" | "offline";
let status: StreamStatus = "connecting";
const statusListeners = new Set<() => void>();
function setStatus(s: StreamStatus) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}
export function useStreamStatus(): StreamStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
    () => "connecting" as StreamStatus,
  );
}

/* ------------------------------------------------------------------ */
/* The hook. Mount once in Providers.                                   */
/* ------------------------------------------------------------------ */

export function useStream() {
  const qc = useQueryClient();
  const { demo } = useDemoMode();
  const esRef = useRef<EventSource | null>(null);

  // Real SSE connection
  useEffect(() => {
    if (demo) return;
    let closed = false;
    let retry = 1000;
    let es: EventSource | null = null;

    const patchFund = (data: unknown) => {
      const p = FundSchema.safeParse(data);
      if (!p.success) return;
      const prev = qc.getQueryData<Fund>(qk.fund);
      qc.setQueryData<Fund>(qk.fund, p.data);
      const keys: string[] = [];
      if (prev) {
        if (prev.indexLevel !== p.data.indexLevel) keys.push("fund.indexLevel");
        if (prev.navPerUnitUsd !== p.data.navPerUnitUsd) keys.push("fund.nav");
        if (prev.marketPriceUsd !== p.data.marketPriceUsd) keys.push("fund.market");
        if (prev.premiumBps !== p.data.premiumBps) keys.push("fund.premium");
        if (prev.epoch !== p.data.epoch) keys.push("fund.epoch");
        if (prev.openAuctions !== p.data.openAuctions) keys.push("fund.openAuctions");
      }
      markChanged(keys);
    };
    const patchHoldings = (data: unknown) => {
      const p = HoldingsSchema.safeParse(data);
      if (!p.success) return;
      const prev = qc.getQueryData<Holding[]>(qk.holdings);
      qc.setQueryData<Holding[]>(qk.holdings, p.data);
      const keys: string[] = [];
      if (prev) {
        const byMint = new Map(prev.map((h) => [h.mint, h]));
        for (const h of p.data) {
          const o = byMint.get(h.mint);
          if (!o) continue;
          if (o.priceUsd !== h.priceUsd) keys.push(`h.${h.mint}.price`);
          if (o.valueUsd !== h.valueUsd) keys.push(`h.${h.mint}.value`);
          if (o.weightBps !== h.weightBps) keys.push(`h.${h.mint}.weight`);
          if (o.change24hPct !== h.change24hPct) keys.push(`h.${h.mint}.chg`);
        }
      }
      markChanged(keys);
    };
    const patchAuction = (data: unknown) => {
      const p = AuctionSchema.safeParse(data);
      if (!p.success) return;
      for (const s of ["open", "all"] as const) {
        qc.setQueryData<Auction[]>(qk.auctions(s), (prev) => {
          if (!prev) return prev;
          const idx = prev.findIndex((a) => a.pda === p.data.pda);
          if (idx === -1) return s === "all" || p.data.status === "open" ? [p.data, ...prev] : prev;
          const next = prev.slice();
          next[idx] = p.data;
          return s === "open" ? next.filter((a) => a.status === "open") : next;
        });
      }
      markChanged([`auction.${p.data.pda}`]);
    };
    const patchEvent = (data: unknown) => {
      const p = FlywheelEventSchema.safeParse(data);
      if (!p.success) return;
      qc.getQueryCache()
        .findAll({ queryKey: ["flywheel-events"] })
        .forEach((q) => {
          qc.setQueryData<FlywheelEvent[]>(q.queryKey, (prev) => (prev ? [p.data, ...prev.filter((e) => String(e.id) !== String(p.data.id))].slice(0, 200) : prev));
        });
      qc.invalidateQueries({ queryKey: qk.flywheel });
      markChanged([`event.${p.data.id}`]);
    };

    const connect = () => {
      if (closed) return;
      try {
        es = new EventSource(`${env.apiUrl}/v1/stream`);
      } catch {
        setStatus("offline");
        return;
      }
      esRef.current = es;
      es.onopen = () => {
        retry = 1000;
        setStatus("live");
      };
      es.onerror = () => {
        setStatus(isDemo() ? "demo" : "offline");
        es?.close();
        if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 30_000)));
      };
      const parse = (e: MessageEvent) => {
        try {
          const j = JSON.parse(e.data);
          return j && typeof j === "object" && "data" in j ? j.data : j;
        } catch {
          return null;
        }
      };
      es.addEventListener("fund", (e) => patchFund(parse(e as MessageEvent)));
      es.addEventListener("holdings", (e) => patchHoldings(parse(e as MessageEvent)));
      es.addEventListener("auction", (e) => patchAuction(parse(e as MessageEvent)));
      es.addEventListener("flywheel_event", (e) => patchEvent(parse(e as MessageEvent)));
      // Also accept untyped messages: { type, data }
      es.onmessage = (e) => {
        try {
          const j = JSON.parse(e.data);
          const type = j?.type ?? j?.event;
          const data = j?.data ?? j;
          if (type === "fund") patchFund(data);
          else if (type === "holdings") patchHoldings(data);
          else if (type === "auction") patchAuction(data);
          else if (type === "flywheel_event") patchEvent(data);
        } catch {
          /* ignore */
        }
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [demo, qc]);

  // Demo mode: simulate ticks so the UI demonstrates its live behaviour, and re-probe the API.
  useEffect(() => {
    if (!demo) return;
    setStatus("demo");
    let i = 0;
    const tick = setInterval(() => {
      i++;
      const holdings = qc.getQueryData<Holding[]>(qk.holdings);
      const fund = qc.getQueryData<Fund>(qk.fund);
      if (holdings && fund) {
        const keys: string[] = [];
        // nudge 3-5 random holdings
        const n = 3 + Math.floor(Math.random() * 3);
        const next = holdings.map((h) => ({ ...h }));
        for (let k = 0; k < n; k++) {
          const idx = Math.floor(Math.random() * next.length);
          const h = next[idx];
          const drift = (Math.random() - 0.5) * 0.006;
          h.priceUsd = h.priceUsd * (1 + drift);
          h.valueUsd = h.priceUsd * h.balanceUi;
          h.change24hPct = (h.change24hPct ?? 0) + drift * 100;
          keys.push(`h.${h.mint}.price`, `h.${h.mint}.value`, `h.${h.mint}.chg`);
        }
        const total = next.reduce((a, h) => a + h.valueUsd, 0);
        for (const h of next) {
          const w = Math.round((h.valueUsd / total) * 10_000);
          if (w !== h.weightBps) keys.push(`h.${h.mint}.weight`);
          h.weightBps = w;
          h.driftBps = w - h.targetWeightBps;
        }
        const prevNav = fund.navUsd;
        const navUsd = total;
        const navPerUnitUsd = navUsd / (Number(fund.supply) / 1e6);
        const indexLevel = fund.indexLevel * (navUsd / prevNav);
        const premiumBps = Math.round((fund.premiumBps ?? 0) + (Math.random() - 0.5) * 6);
        const marketPriceUsd = navPerUnitUsd * (1 + premiumBps / 10_000);
        qc.setQueryData<Holding[]>(qk.holdings, next);
        qc.setQueryData<Fund>(qk.fund, { ...fund, navUsd, navPerUnitUsd, indexLevel, premiumBps, marketPriceUsd });
        keys.push("fund.indexLevel", "fund.nav", "fund.market", "fund.premium");
        markChanged(keys);
      }
      // advance auctions' current price
      for (const s of ["open", "all"] as const) {
        qc.setQueryData<Auction[]>(qk.auctions(s), (prev) => {
          if (!prev) return prev;
          const slot = mock.mockSlot();
          return prev.map((a) => {
            if (a.status !== "open") return a;
            const dur = a.endSlot - a.startSlot;
            const el = Math.min(Math.max(slot - a.startSlot, 0), dur);
            return { ...a, currentSlot: slot, currentPrice: a.startPrice - (a.startPrice - a.endPrice) * (el / dur) };
          });
        });
      }
      // every ~5 ticks, push a new flywheel event
      if (i % 5 === 0) {
        const ev = mock.mockEvent(i, Date.now(), "live");
        qc.getQueryCache()
          .findAll({ queryKey: ["flywheel-events"] })
          .forEach((q) => qc.setQueryData<FlywheelEvent[]>(q.queryKey, (prev) => (prev ? [ev, ...prev].slice(0, 200) : prev)));
        markChanged([`event.${ev.id}`]);
      }
    }, 3000);
    const probe = setInterval(() => {
      void ping().then((ok) => {
        if (ok) qc.invalidateQueries();
      });
    }, 20_000);
    return () => {
      clearInterval(tick);
      clearInterval(probe);
    };
  }, [demo, qc]);
}
