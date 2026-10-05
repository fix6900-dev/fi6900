"use client";

import { compact } from "@/lib/format";
import { truncateMiddle } from "@/lib/utils";

/**
 * Compact rendering of a proposal's `reason` record. Methodology proposals carry
 * { rank, marketCapUsd, fdvUsd, volume24hUsd, avgVolume7dUsd, sellImpactBps, eligible, reasons[], mintAuthority, freezeAuthority };
 * manual ones carry { decimals, mintAuthority, freezeAuthority, force, transferFeeBps? }. Unknown keys are listed verbatim.
 */
export function MetricReasons({ reason }: { reason: Record<string, unknown> }) {
  const r = reason;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const known = new Set(["source", "rank", "cgRank", "cgId", "universeSource", "marketCapUsd", "fdvUsd", "volume24hUsd", "avgVolume7dUsd", "sellImpactBps", "eligible", "reasons", "mintAuthority", "freezeAuthority", "force", "decimals", "configVersion", "runTs", "transferFeeBps"]);
  const chips: { k: string; v: string; tone?: "neg" | "accent" }[] = [];
  const rank = num(r.rank);
  if (rank != null) chips.push({ k: "rank", v: `#${rank}` });
  const cgRank = num(r.cgRank);
  if (cgRank != null) chips.push({ k: "coingecko", v: `CG #${cgRank}` });
  const mcap = num(r.marketCapUsd);
  if (mcap != null) chips.push({ k: "mcap", v: "$" + compact(mcap, 1) });
  const fdv = num(r.fdvUsd);
  if (fdv != null && fdv !== mcap) chips.push({ k: "fdv", v: "$" + compact(fdv, 1) });
  const v24 = num(r.volume24hUsd);
  if (v24 != null) chips.push({ k: "vol24h", v: "$" + compact(v24, 1) });
  const v7 = num(r.avgVolume7dUsd);
  if (v7 != null) chips.push({ k: "vol7d", v: "$" + compact(v7, 1) });
  const impact = num(r.sellImpactBps);
  if (impact != null) chips.push({ k: "impact", v: `${(impact / 100).toFixed(2)}%`, tone: impact > 200 ? "neg" : undefined });
  else if ("sellImpactBps" in r) chips.push({ k: "impact", v: "n/a" });
  if ("mintAuthority" in r || "freezeAuthority" in r) {
    const ma = str(r.mintAuthority);
    const fa = str(r.freezeAuthority);
    chips.push({ k: "mint auth", v: ma ? truncateMiddle(ma, 4, 4) : "revoked", tone: ma ? "neg" : "accent" });
    chips.push({ k: "freeze auth", v: fa ? truncateMiddle(fa, 4, 4) : "revoked", tone: fa ? "neg" : "accent" });
  }
  const dec = num(r.decimals);
  if (dec != null) chips.push({ k: "decimals", v: String(dec) });
  if (r.force === true) chips.push({ k: "force", v: "authority check skipped", tone: "neg" });
  const feeBps = num(r.transferFeeBps);
  if (feeBps != null && feeBps > 0) chips.push({ k: "transfer fee", v: `${(feeBps / 100).toFixed(2)}% (rule 2.7 override)`, tone: "neg" });
  if (typeof r.eligible === "boolean") chips.push({ k: "eligible", v: r.eligible ? "yes" : "no", tone: r.eligible ? undefined : "neg" });
  const reasons = Array.isArray(r.reasons) ? (r.reasons as unknown[]).map(String) : [];
  for (const [k, v] of Object.entries(r)) if (!known.has(k)) chips.push({ k, v: typeof v === "object" ? JSON.stringify(v) : String(v) });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
        {typeof r.source === "string" && <span className="text-dim">{r.source}</span>}
        {chips.map((c) => (
          <span key={c.k} className="whitespace-nowrap">
            <span className="text-muted">{c.k} </span>
            <span className={c.tone === "neg" ? "text-neg" : c.tone === "accent" ? "text-accent" : "text-ink"}>{c.v}</span>
          </span>
        ))}
        {chips.length === 0 && !r.source && <span className="text-dim">no metrics</span>}
      </div>
      {reasons.length > 0 && <div className="font-mono text-[11px] text-neg">fails: {reasons.join(", ")}</div>}
    </div>
  );
}
