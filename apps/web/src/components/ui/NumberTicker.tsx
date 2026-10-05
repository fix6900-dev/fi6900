"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: number | null | undefined;
  format: (n: number) => string;
  className?: string;
  /** ms */
  duration?: number;
  /** flash background on change. Off by default; only price and 24h cells opt in. */
  flash?: boolean;
  /** Reserve width using the widest expected string so the layout never shifts. */
  reserve?: string;
}

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animates between numeric values with a count-up. Renders with tabular numerals
 * and an optional reserved width so widths never jitter.
 */
export function NumberTicker({ value, format, className, duration = 700, flash = false, reserve }: Props) {
  const [display, setDisplay] = useState<number | null>(value ?? null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(value ?? null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (value == null) {
      setDisplay(null);
      prev.current = null;
      return;
    }
    const from = prev.current ?? value;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    if (prefersReducedMotion()) {
      prev.current = to;
      setDisplay(to);
      return;
    }
    setDir(to > from ? "up" : "down");
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (to - from) * easeOutExpo(t);
      setDisplay(v);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else {
        prev.current = to;
        setDisplay(to);
      }
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    const clear = setTimeout(() => setDir(null), 900);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearTimeout(clear);
    };
  }, [value, duration]);

  const text = display == null ? "—" : format(display);
  return (
    <span className={cn("relative inline-grid font-mono tabular-nums", className)}>
      {reserve && (
        <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">
          {reserve}
        </span>
      )}
      <span key={dir ?? "idle"} className={cn("col-start-1 row-start-1 whitespace-pre rounded-sm", reserve && "text-right", flash && dir === "up" && "flash-cell", flash && dir === "down" && "flash-cell-neg")}>
        {text}
      </span>
    </span>
  );
}
