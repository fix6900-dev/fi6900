import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Stat({ label, value, sub, className, align = "left" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", align === "right" && "items-end text-right", className)}>
      <div className="eyebrow">{label}</div>
      <div className="num text-lg font-medium leading-none tracking-[-0.01em] sm:text-xl">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Signed percentage. Up/down colour is data, not decoration, so it stays. */
export function Delta({
  value,
  digits = 2,
  suffix = "%",
  className,
  size = "sm",
  reserve,
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  className?: string;
  size?: "xs" | "sm" | "md";
  /** Reserve a fixed width (ch) so ticking values never shift neighbours. */
  reserve?: boolean;
}) {
  const width = reserve ? "inline-block min-w-[7ch] text-right" : "";
  if (value == null || !Number.isFinite(value)) return <span className={cn("font-mono text-muted", width, className)}>—</span>;
  const pos = value > 0;
  const zero = Math.abs(value) < Math.pow(10, -digits) / 2;
  const txt = (pos ? "+" : "") + value.toFixed(digits) + suffix;
  return (
    <span className={cn("num font-mono", size === "xs" && "text-[11px]", size === "sm" && "text-xs", size === "md" && "text-sm", zero ? "text-muted" : pos ? "text-accent" : "text-neg", width, className)}>
      {txt}
    </span>
  );
}
