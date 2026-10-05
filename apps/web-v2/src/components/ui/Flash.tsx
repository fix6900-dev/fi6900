"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a cell. When `value` changes the cell flashes the up or down fill for 900ms.
 * Reduced motion swaps the flash for a static underline (see globals.css), cleared after 2s.
 */
export function Flash({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef<number | null | undefined>(value);
  const [fl, setFl] = useState<{ dir: "up" | "down"; k: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p == null || value == null || p === value) return;
    setFl((f) => ({ dir: value > p ? "up" : "down", k: (f?.k ?? 0) + 1 }));
    const t = setTimeout(() => setFl(null), 2000);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <span key={fl ? fl.k : "idle"} className={cn("flashcell", fl && `flash-${fl.dir}`, className)}>
      {children}
    </span>
  );
}
