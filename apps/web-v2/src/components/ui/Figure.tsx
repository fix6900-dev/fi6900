"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A number rendered at its final value the moment it is known. There is no count-up: a figure never shows
 * a value that is not the real one. A changed value can flash.
 * The width is reserved from the text so ticking never shifts the layout.
 * `empty` is shown (in words) when the value is null: null means "not yet", never zero.
 */
export function Figure({
  value,
  format,
  empty = "—",
  className,
  flash,
}: {
  value: number | null | undefined;
  format: (n: number) => string;
  empty?: ReactNode;
  className?: string;
  /** Flash the cell on change, coloured by direction. */
  flash?: boolean;
}) {
  const final = value != null && Number.isFinite(value) ? format(value) : null;

  const prev = useRef<number | null>(null);
  const [fl, setFl] = useState<{ dir: "up" | "down"; k: number } | null>(null);
  useEffect(() => {
    if (!flash || value == null) {
      prev.current = value ?? null;
      return;
    }
    if (prev.current != null && prev.current !== value) {
      setFl((f) => ({ dir: value > prev.current! ? "up" : "down", k: (f?.k ?? 0) + 1 }));
      const t = setTimeout(() => setFl(null), 2000);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value, flash]);

  if (final == null) {
    return <span className={cn("fig", className)}>{empty}</span>;
  }
  return (
    <span className={cn("fig", fl && `flash-${fl.dir}`, className)} key={fl ? fl.k : "idle"} style={{ minWidth: `${final.length}ch` }}>
      {final}
    </span>
  );
}
