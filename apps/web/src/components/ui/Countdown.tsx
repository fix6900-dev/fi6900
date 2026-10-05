"use client";

import { useEffect, useState } from "react";
import { durationParts, pad2 } from "@/lib/format";
import { cn } from "@/lib/utils";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Countdown({ to, className, compact, showDays = true }: { to: string | number | Date | null | undefined; className?: string; compact?: boolean; showDays?: boolean }) {
  const now = useNow();
  if (!to) return <span className={cn("font-mono text-muted", className)}>—</span>;
  const target = new Date(to).getTime();
  if (now == null) return <span className={cn("font-mono text-dim", className)}>{compact ? "--:--:--" : "--d --:--:--"}</span>;
  const ms = target - now;
  if (ms <= 0) return <span className={cn("font-mono text-accent", className)}>now</span>;
  const { d, h, m, s } = durationParts(ms);
  if (compact) {
    return (
      <span className={cn("font-mono tabular-nums", className)}>
        {d > 0 && showDays && <span>{d}d </span>}
        {pad2(h)}:{pad2(m)}:{pad2(s)}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-mono tabular-nums", className)}>
      {showDays && d > 0 && (
        <>
          <span>{d}</span>
          <span className="text-[0.7em] text-muted">d</span>
        </>
      )}
      <span>{pad2(h)}</span>
      <span className="text-[0.7em] text-muted">h</span>
      <span>{pad2(m)}</span>
      <span className="text-[0.7em] text-muted">m</span>
      <span>{pad2(s)}</span>
      <span className="text-[0.7em] text-muted">s</span>
    </span>
  );
}
