import { ImageResponse } from "next/og";
import { mockFund, mockHoldings } from "@/lib/mock";

export const runtime = "edge";
export const alt = "FI6900 — The memecoin index fund";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

async function load() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const [f, h] = await Promise.all([fetch(`${API}/v1/fund`, { signal: ctrl.signal }), fetch(`${API}/v1/holdings`, { signal: ctrl.signal })]);
    clearTimeout(t);
    const fj = await f.json();
    const hj = await h.json();
    const fund = fj.data ?? fj;
    const holdings = (hj.data ?? hj) as { symbol: string; weightBps: number; change24hPct?: number }[];
    return { level: Number(fund.indexLevel), premiumBps: Number(fund.premiumBps ?? 0), nav: Number(fund.navUsd), top: holdings.slice().sort((a, b) => b.weightBps - a.weightBps).slice(0, 8), demo: false };
  } catch {
    const h = mockHoldings();
    const f = mockFund(h);
    return { level: f.indexLevel, premiumBps: f.premiumBps ?? 0, nav: f.navUsd, top: h.slice().sort((a, b) => b.weightBps - a.weightBps).slice(0, 8), demo: true };
  }
}

export default async function OG() {
  const d = await load();
  const level = d.level.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const prem = (d.premiumBps / 100).toFixed(2);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0A0B0D", color: "#E8EAED", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#B6FF3B", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none"><path d="M2 12V2h10M2 7h7" stroke="#0A0B0D" strokeWidth="2.4" /></svg>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -1 }}>FI6900</div>
          <div style={{ marginLeft: 16, fontSize: 18, color: "#8B919A", letterSpacing: 2, textTransform: "uppercase" }}>Memecoin Index · Equal Weight · 40</div>
          {d.demo && <div style={{ marginLeft: "auto", fontSize: 16, color: "#FFB547", border: "1px solid rgba(255,181,71,0.4)", padding: "4px 10px", borderRadius: 6 }}>DEMO DATA</div>}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 28, marginTop: 70 }}>
          <div style={{ fontSize: 168, fontWeight: 600, letterSpacing: -8, lineHeight: 1, fontFamily: "monospace" }}>{level}</div>
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: 18 }}>
            <div style={{ fontSize: 22, color: "#8B919A", textTransform: "uppercase", letterSpacing: 3 }}>Index level</div>
            <div style={{ fontSize: 30, color: d.premiumBps > 0 ? "#E8EAED" : "#B6FF3B", fontFamily: "monospace", marginTop: 6 }}>{`${d.premiumBps >= 0 ? "Premium" : "Discount"} ${prem}%`}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: "auto", flexWrap: "wrap" }}>
          {d.top.map((h) => (
            <div key={h.symbol} style={{ display: "flex", gap: 10, alignItems: "center", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 16px", fontSize: 22 }}>
              <span style={{ fontWeight: 600 }}>{h.symbol}</span>
              <span style={{ color: "#8B919A", fontFamily: "monospace" }}>{(h.weightBps / 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, fontSize: 20, color: "#8B919A" }}>
          <span>Redeemable in-kind · Dutch-auction rebalancing · No oracle</span>
          <span style={{ fontFamily: "monospace" }}>{`AUM $${Math.round(d.nav).toLocaleString("en-US")}`}</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
