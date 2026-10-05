"use client";

import { useEffect, useRef, useState } from "react";
import { useHistory } from "@/lib/api";
import { num, usd } from "@/lib/format";
import type { HistoryRange } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { Tabs } from "../ui/Tabs";

type Mode = "level" | "nav";

export function NavChart() {
  const [range, setRange] = useState<HistoryRange>("7d");
  const [mode, setMode] = useState<Mode>("nav");
  const { data, isLoading } = useHistory(range);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ t: number; a: number; b?: number | null } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !data || data.length < 2) return;
    let disposed = false;
    let cleanup = () => {};
    void import("lightweight-charts").then((lc) => {
      if (disposed) return;
      const { createChart, LineSeries, AreaSeries, ColorType, createSeriesMarkers, CrosshairMode, LineStyle } = lc;
      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8B919A", fontFamily: "var(--font-mono)", fontSize: 11, attributionLogo: false },
        // Horizontal hairlines only; vertical gridlines add noise without information.
        grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderVisible: false, timeVisible: range === "1d" || range === "7d", secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#1c2026" },
          horzLine: { visible: false, labelVisible: false },
        },
        handleScroll: false,
        handleScale: false,
        localization: { priceFormatter: (p: number) => (mode === "nav" ? usd(p, { precise: true }) : num(p, 2)) },
      });
      const toTime = (ms: number) => Math.floor(ms / 1000) as unknown as import("lightweight-charts").UTCTimestamp;
      // Single emphasised series: NAV (or level) in the accent with a faint fill.
      const primary = chart.addSeries(AreaSeries, {
        lineColor: "#B6FF3B",
        topColor: "rgba(182,255,59,0.10)",
        bottomColor: "rgba(182,255,59,0)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3,
      });
      primary.setData(data.map((p) => ({ time: toTime(p.t), value: mode === "nav" ? p.navPerUnitUsd : p.indexLevel })));
      let market: ReturnType<typeof chart.addSeries> | null = null;
      if (mode === "nav") {
        // Market price: thin grey dashed, secondary by design.
        market = chart.addSeries(LineSeries, { color: "#8B919A", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 2 });
        market.setData(data.filter((p) => p.marketPriceUsd != null).map((p) => ({ time: toTime(p.t), value: p.marketPriceUsd as number })));
      }
      const resets = data.filter((p) => p.divisorReset);
      if (resets.length) {
        createSeriesMarkers(
          primary,
          resets.map((p) => ({ time: toTime(p.t), position: "belowBar" as const, color: "#8B919A", shape: "circle" as const, size: 0.5, text: "" })),
        );
      }
      chart.timeScale().fitContent();
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData.size) {
          setHover(null);
          return;
        }
        const a = param.seriesData.get(primary) as { value?: number } | undefined;
        const b = market ? (param.seriesData.get(market) as { value?: number } | undefined) : undefined;
        setHover({ t: (param.time as number) * 1000, a: a?.value ?? 0, b: b?.value ?? null });
      });
      cleanup = () => chart.remove();
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [data, mode, range]);

  const last = data?.[data.length - 1];
  const first = data?.[0];
  const shownA = hover ? hover.a : mode === "nav" ? last?.navPerUnitUsd : last?.indexLevel;
  const shownB = hover ? hover.b : last?.marketPriceUsd;
  const chg = first && last ? ((mode === "nav" ? last.navPerUnitUsd / first.navPerUnitUsd : last.indexLevel / first.indexLevel) - 1) * 100 : null;
  const prem = shownA && shownB ? ((shownB - shownA) / shownA) * 100 : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num font-mono text-xl font-medium">{shownA != null ? (mode === "nav" ? usd(shownA, { precise: true }) : num(shownA, 2)) : <Skeleton className="h-5 w-24" />}</span>
          {chg != null && !hover && (
            <span className={cn("num font-mono text-sm", chg >= 0 ? "text-accent" : "text-neg")}>
              {chg >= 0 ? "+" : ""}
              {chg.toFixed(2)}% <span className="text-muted">{range.toUpperCase()}</span>
            </span>
          )}
          {hover && <span className="font-mono text-xs text-muted">{new Date(hover.t).toUTCString().slice(5, 22)} UTC</span>}
          {mode === "nav" && prem != null && (
            <span className="font-mono text-xs text-muted">
              market {prem >= 0 ? "+" : ""}
              {prem.toFixed(2)}% vs NAV
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs id="chart-mode" size="sm" value={mode} onChange={setMode} items={[{ value: "nav", label: "NAV / unit" }, { value: "level", label: "Index level" }]} />
          <Tabs
            id="chart-range"
            size="sm"
            value={range}
            onChange={setRange}
            items={[
              { value: "1d", label: "1D" },
              { value: "7d", label: "7D" },
              { value: "30d", label: "30D" },
              { value: "all", label: "ALL" },
            ]}
          />
        </div>
      </div>
      <div className="relative h-[280px] w-full sm:h-[360px]">
        {isLoading && !data && <Skeleton className="absolute inset-5 rounded-md" />}
        <div ref={ref} className="absolute inset-0 px-1 pt-2" />
      </div>
      {/* Legend: one small inline row in muted mono. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-5 py-3 font-mono text-[11px] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-accent" /> {mode === "nav" ? "NAV per unit" : "Index level · base 1000"}
        </span>
        {mode === "nav" && (
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-4 border-t border-dashed border-muted" /> Market price
          </span>
        )}
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted" /> Divisor reset
        </span>
      </div>
    </Card>
  );
}
