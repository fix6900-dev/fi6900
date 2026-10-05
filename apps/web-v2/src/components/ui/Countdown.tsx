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

/** Per-second digits. No animation. Digits are tabular so the width never shifts. */
export function Countdown({
  to,
  className,
  compact,
  showDays = true,
  emptyText = "—",
}: {
  to: string | number | Date | null | undefined;
  className?: string;
  compact?: boolean;
  showDays?: boolean;
  emptyText?: string;
}) {
  const now = useNow();
  if (!to) return <span className={cn("cd", className)}>{emptyText}</span>;
  const target = new Date(to).getTime();
  if (now == null) return <span className={cn("cd", className)}>{compact ? "--:--:--" : "--d --:--:--"}</span>;
  const ms = target - now;
  if (ms <= 0) return <span className={cn("cd", className)}>due</span>;
  const { d, h, m, s } = durationParts(ms);
  return (
    <span className={cn("cd", className)}>
      {d > 0 && showDays && <>{d}d </>}
      {pad2(h)}:{pad2(m)}:{pad2(s)}
    </span>
  );
}

/** Seconds remaining, or null when unknown. */
export function useSecondsLeft(to: string | null | undefined): number | null {
  const now = useNow();
  if (!to || now == null) return null;
  return Math.floor((new Date(to).getTime() - now) / 1000);
}
