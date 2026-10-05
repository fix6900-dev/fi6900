"use client";

import { bpsToPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NumberTicker } from "./NumberTicker";

/**
 * Market price vs NAV. Quiet mono text; amber only when the premium exceeds
 * 150bps (creation is then cheaper than buying).
 */
export function PremiumBadge({ bps, size = "md", className }: { bps: number | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  if (bps == null || !Number.isFinite(bps)) {
    return <span className={cn("font-mono text-xs text-muted", className)}>No market price</span>;
  }
  const premium = bps > 0;
  const warn = bps > 150;
  const label = premium ? "Premium" : bps < 0 ? "Discount" : "At NAV";
  return (
    <span
      className={cn("inline-flex items-baseline gap-2 font-mono", size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm", warn ? "text-amber" : "text-text", className)}
      title="Market price vs NAV per unit"
    >
      <span className={cn("eyebrow", warn && "text-amber")}>{label}</span>
      <NumberTicker value={Math.abs(bps)} format={(n) => bpsToPct(n, 2)} reserve="00.00%" />
    </span>
  );
}
