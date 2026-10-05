import { cn } from "@/lib/utils";

/** Signed value. Up/down colour is data, never decoration. A null is a dash, not a zero. */
export function Delta({ value, digits = 2, suffix = "%", className, arrow }: { value: number | null | undefined; digits?: number; suffix?: string; className?: string; arrow?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn("delta delta-none", className)}>—</span>;
  const zero = Math.abs(value) < Math.pow(10, -digits) / 2;
  const up = value > 0;
  return (
    <span className={cn("delta", zero ? "delta-none" : up ? "delta-up" : "delta-down", className)}>
      {arrow && !zero ? (up ? "▲ " : "▼ ") : ""}
      {up ? "+" : ""}
      {value.toFixed(digits)}
      {suffix}
    </span>
  );
}
