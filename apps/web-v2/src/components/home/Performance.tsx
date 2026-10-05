"use client";

import { useEffect, useMemo, useState } from "react";
import { useHistory } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { num } from "@/lib/format";
import { useInViewOnce } from "@/lib/motion";
import type { HistoryPoint, HistoryRange } from "@/lib/schemas";
import { Notes } from "../ui/Fn";
import { SectionHead } from "../ui/SectionHead";
import { Tabs } from "../ui/Tabs";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "1d", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "ALL" },
];

const nav4 = (n: number) => "$" + n.toFixed(4);

/** Resolves a token to a plain rgb() string through computed style, so the chart library always receives a parseable colour. */
function cssVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return raw;
  const probe = document.createElement("span");
  probe.style.color = raw;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out || raw;
}

/** Keeps a flat series from autoscaling sub-point noise into full-height steps: minimum span is 1% of the mean. */
function minSpan(data: { value: number }[]) {
  return (orig: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
    const res = orig();
    if (!res || !res.priceRange || !data.length) return res;
    const mean = data.reduce((a, d) => a + d.value, 0) / data.length;
    const half = Math.abs(mean) * 0.005;
    const { minValue, maxValue } = res.priceRange;
    const mid = (minValue + maxValue) / 2;
    if (maxValue - minValue >= half * 2) return res;
    return { ...res, priceRange: { minValue: mid - half, maxValue: mid + half } };
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** Intraday ticks show HH:mm, longer ranges show dd MMM. Never the library default, which collapses to bare digits. */
function tickLabel(sec: number, intraday: boolean): string {
  const d = new Date(sec * 1000);
  return intraday ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

/** Re-reads the chart colours whenever the theme attribute flips. */
function useThemeKey() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setK((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return k;
}

function toCsv(data: HistoryPoint[]): string {
  const head = "timestamp_utc,index_level,nav_per_unit_usd,market_price_usd";
  const rows = data.map((p) => [new Date(p.t).toISOString(), p.indexLevel, p.navPerUnitUsd, p.marketPriceUsd ?? ""].join(","));
  return [head, ...rows].join("\n");
}

export function Performance() {
  const [range, setRange] = useState<HistoryRange>("7d");
  const { data, isLoading } = useHistory(range);
  const asOf = useAsOf();
  const [wrapRef, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const themeKey = useThemeKey();
  const [hover, setHover] = useState<{ t: number; level?: number; nav?: number; mkt?: number } | null>(null);

  const clean = useMemo(() => {
    if (!data) return null;
    const seenT = new Set<number>();
    const sorted = data
      .slice()
      .sort((a, b) => a.t - b.t)
      .filter((p) => {
        const s = Math.floor(p.t / 1000);
        if (seenT.has(s)) return false;
        seenT.add(s);
        return true;
      });
    // The 1000.00 base is shown as a price line, not as a data point: a base row would draw a cliff at the left edge.
    // Warm-up snapshots taken before prices loaded all read exactly 1000. Drop that leading run so the series starts at the first priced snapshot.
    const firstPriced = sorted.findIndex((p) => p.indexLevel !== 1000);
    if (firstPriced > 0 && sorted.length - firstPriced >= 2) return sorted.slice(firstPriced);
    return sorted;
  }, [data]);

  const hasMarket = !!clean?.some((p) => p.marketPriceUsd != null);

  // The host must have a non-zero size before the chart is created, or lightweight-charts draws nothing.
  // A ResizeObserver reports the size as soon as the box is laid out; the chart is built on the first non-zero report.
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [sized, setSized] = useState(false);
  useEffect(() => {
    if (!hostEl) return;
    const check = () => {
      const r = hostEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSized(true);
    };
    check();
    if (typeof ResizeObserver === "undefined") {
      setSized(true);
      return;
    }
    const ro = new ResizeObserver(check);
    ro.observe(hostEl);
    return () => ro.disconnect();
  }, [hostEl]);

  useEffect(() => {
    const el = hostEl;
    if (!el || !clean || clean.length < 2 || !sized) return;
    let disposed = false;
    let cleanup = () => {};
    let timer: ReturnType<typeof setTimeout> | null = null;
    void import("lightweight-charts").then((lc) => {
      if (disposed) return;
      const { createChart, LineSeries, ColorType, CrosshairMode, LineStyle } = lc;
      const text = cssVar("--color-text");
      const muted = cssVar("--color-text-muted");
      const rule = cssVar("--rule");
      const ruleStrong = cssVar("--rule-strong");
      const nav = cssVar("--line-nav");
      const mkt = cssVar("--line-market");
      const font = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
      // Tick format follows the data actually in view, not the requested range: a 7D range holding 22h of history reads HH:mm.
      const spanMs = clean[clean.length - 1].t - clean[0].t;
      const intraday = spanMs < 48 * 3_600_000;
      const chart = createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: muted, fontFamily: font, fontSize: 11, attributionLogo: false, panes: { separatorColor: ruleStrong, enableResize: false } },
        grid: { vertLines: { visible: false }, horzLines: { color: rule } },
        leftPriceScale: { visible: false },
        // entireTextOnly keeps the two panes' edge labels from colliding at the separator.
        rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.2 }, minimumWidth: 72, entireTextOnly: true },
        timeScale: { borderVisible: false, timeVisible: intraday, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: (t: unknown) => tickLabel(t as number, intraday) },
        localization: { timeFormatter: (t: unknown) => new Date((t as number) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" },
        crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: ruleStrong, width: 1, style: LineStyle.Solid, labelBackgroundColor: text }, horzLine: { visible: false, labelVisible: false } },
        handleScroll: false,
        handleScale: false,
      });
      const T = (ms: number) => Math.floor(ms / 1000) as unknown as import("lightweight-charts").UTCTimestamp;
      const level = chart.addSeries(LineSeries, { color: text, lineWidth: 1, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 3, priceFormat: { type: "custom", formatter: (p: number) => num(p, 2), minMove: 0.01 } }, 0);
      const levelData = clean.map((p) => ({ time: T(p.t), value: p.indexLevel }));
      level.applyOptions({ autoscaleInfoProvider: minSpan(levelData) as never });
      level.setData(levelData);
      // The 1000.00 base level, dashed, on the index pane. It is drawn only while it falls inside the autoscaled range.
      level.createPriceLine({ price: 1000, color: ruleStrong, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "base 1000.00" });
      const navS = chart.addSeries(LineSeries, { color: nav, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 3, priceFormat: { type: "custom", formatter: (p: number) => nav4(p), minMove: 0.0001 } }, 1);
      const navData = clean.map((p) => ({ time: T(p.t), value: p.navPerUnitUsd }));
      navS.applyOptions({ autoscaleInfoProvider: minSpan(navData) as never });
      navS.setData(navData);
      let market: ReturnType<typeof chart.addSeries> | null = null;
      if (hasMarket) {
        market = chart.addSeries(LineSeries, { color: mkt, lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 2, visible: false, priceFormat: { type: "custom", formatter: (p: number) => nav4(p), minMove: 0.0001 } }, 1);
        market.setData(clean.filter((p) => p.marketPriceUsd != null).map((p) => ({ time: T(p.t), value: p.marketPriceUsd as number })));
        // The market line follows the NAV line by 120ms.
        timer = setTimeout(() => market?.applyOptions({ visible: true }), 120);
      }
      const panes = chart.panes();
      panes[0]?.setStretchFactor(1.3);
      panes[1]?.setStretchFactor(1);
      chart.timeScale().fitContent();
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData.size) return setHover(null);
        const v = (s: unknown) => (param.seriesData.get(s as never) as { value?: number } | undefined)?.value;
        setHover({ t: (param.time as number) * 1000, level: v(level), nav: v(navS), mkt: market ? v(market) : undefined });
      });
      // Follow the box size (viewport resizes, theme font swaps).
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
        if (disposed) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w > 0 && h > 0) {
          chart.applyOptions({ width: w, height: h });
          chart.timeScale().fitContent();
        }
      }) : null;
      ro?.observe(el);
      cleanup = () => {
        ro?.disconnect();
        chart.remove();
      };
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      cleanup();
    };
  }, [clean, range, sized, themeKey, hasMarket, hostEl]);

  const last = clean?.[clean.length - 1];
  const lv = hover?.level ?? last?.indexLevel;
  const nv = hover?.nav ?? last?.navPerUnitUsd;
  const mv = hover ? hover.mkt : last?.marketPriceUsd;

  const exportCsv = () => {
    if (!clean) return;
    const blob = new Blob([toCsv(clean)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fi6900-history-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sec" aria-labelledby="perf-h">
      <SectionHead n={3} title={<span id="perf-h">Performance</span>} right={<Tabs id="perf-range" size="sm" label="Range" value={range} onChange={setRange} items={RANGES} />} />
      <div className="legend" aria-live="off">
        <div className="lg">
          <span className="lg-key lg-level" aria-hidden />
          <span className="micro muted">Index level</span>
          <span className="m">{lv != null ? num(lv, 2) : "—"}</span>
        </div>
        <div className="lg">
          <span className="lg-key lg-nav" aria-hidden />
          <span className="micro muted">NAV per unit</span>
          <span className="m">{nv != null ? nav4(nv) : "—"}</span>
        </div>
        <div className="lg">
          <span className="lg-key lg-mkt" aria-hidden />
          <span className="micro muted">Market price</span>
          <span className="m">{clean && !hasMarket ? "no market data yet" : mv != null ? nav4(mv) : "—"}</span>
        </div>
        <div className="lg-r">
          {hover && <span className="faint m">{new Date(hover.t).toISOString().slice(0, 16).replace("T", " ")} UTC</span>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!clean || clean.length === 0}>
            Export .csv
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="chartbox">
        {isLoading && !data && <p className="chart-msg faint">Loading history</p>}
        {clean && clean.length < 2 && <p className="chart-msg faint">Not enough history in this range yet. The keeper records a NAV snapshot every 30 seconds.</p>}
        <div ref={setHostEl} className={`chart${seen ? " draw" : ""}`} role="img" aria-label="Index level, NAV per unit and market price over time" />
      </div>

      <Notes notes={[{ label: "Source: keeper NAV snapshots every 30 s. The index level is the upper pane, NAV and market price the lower pane. The series starts at the first priced snapshot", source: "keeper history" }]} asOf={asOf ? `${utcClock(asOf)} UTC` : undefined} />
    </section>
  );
}
