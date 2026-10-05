import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "FIX6900 Solana Memecoin Equal Weight Index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 60;

// satori cannot read CSS variables, so the paper-theme values from tokens.css are repeated here.
const PAPER = "#f7f6f2";
const INK = "#11110f";
const MUTED = "#55554f";
const RULE = "#c6c5be";
const UP = "#0d7344";
const DOWN = "#ab3224";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

async function get<T>(path: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${API}${path}`, { signal: ctrl.signal, next: { revalidate: 60 } });
    clearTimeout(t);
    const j = (await res.json()) as { ok?: boolean; data?: T };
    return j.ok ? (j.data ?? null) : null;
  } catch {
    return null;
  }
}

function hue(mint: string): number {
  let h = 2166136261;
  for (let i = 0; i < mint.length; i++) {
    h ^= mint.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

export default async function Image() {
  const [fund, holdings, font] = await Promise.all([
    get<{ indexLevel: number | string }>("/v1/fund"),
    get<{ symbol: string; mint: string; weightBps: number | string }[]>("/v1/holdings"),
    readFile(join(process.cwd(), "node_modules/@fontsource/azeret-mono/files/azeret-mono-latin-300-normal.woff")).catch(() => null),
  ]);
  const level = fund ? Number(fund.indexLevel) : null;
  const text = level != null ? level.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "1,000.00 · base";
  const top = (holdings ?? [])
    .map((h) => ({ symbol: h.symbol, mint: h.mint, w: Number(h.weightBps) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 5);
  const max = Math.max(1, ...top.map((t) => t.w));
  const cluster = (process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet-beta") === "mainnet-beta" ? "Mainnet" : "Devnet";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAPER, color: INK, padding: 56, fontFamily: "Azeret" }}>
        <div style={{ display: "flex", borderTop: `4px solid ${INK}`, paddingTop: 14, fontSize: 20, letterSpacing: 2, color: MUTED, textTransform: "uppercase" }}>FIX6900 Solana Memecoin Equal Weight Index</div>
        <div style={{ display: "flex", fontSize: level != null ? 200 : 150, fontWeight: 300, letterSpacing: -6, lineHeight: 1, marginTop: 28 }}>{text}</div>
        <div style={{ display: "flex", fontSize: 26, color: fund ? UP : DOWN, marginTop: 8 }}>{fund ? "Index level · base 1000.00" : "Keeper unreachable"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 28 }}>
          {top.map((t) => (
            <div key={t.mint} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 20 }}>
              <div style={{ display: "flex", width: 120 }}>{t.symbol}</div>
              <div style={{ display: "flex", width: 520, height: 14, background: "#eeede8" }}>
                <div style={{ display: "flex", width: `${(t.w / max) * 100}%`, height: 14, background: `hsl(${hue(t.mint)} 55% 72%)` }} />
              </div>
              <div style={{ display: "flex", color: MUTED }}>{(t.w / 100).toFixed(2)}%</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", marginTop: "auto", borderTop: `1px solid ${RULE}`, paddingTop: 14, fontSize: 18, color: MUTED }}>
          {cluster} · as of {stamp}
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Azeret", data: font, weight: 300, style: "normal" }] : undefined },
  );
}
