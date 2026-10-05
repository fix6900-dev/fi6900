"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/** Springs and easings come from tokens.css. These defaults match it and are re-read at runtime. */
export const SPRING_DEFAULT = { stiffness: 420, damping: 38, mass: 1 };

export function readSpring() {
  if (typeof window === "undefined") return { type: "spring" as const, ...SPRING_DEFAULT };
  const cs = getComputedStyle(document.documentElement);
  const num = (name: string, d: number) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : d;
  };
  return {
    type: "spring" as const,
    stiffness: num("--spring-stiffness", SPRING_DEFAULT.stiffness),
    damping: num("--spring-damping", SPRING_DEFAULT.damping),
    mass: num("--spring-mass", SPRING_DEFAULT.mass),
  };
}

export const SPRING = { type: "spring" as const, ...SPRING_DEFAULT };
export const EASE_SETTLE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** True once the element has been at least `threshold` visible. Never flips back. Re-attaches if the element is replaced. */
export function useInViewOnce<T extends Element>(threshold = 0.2): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen, threshold]);
  return [setEl, seen];
}

const settle = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Tweens a number. First run (when `active` turns true) counts up from `from` (default 0).
 * Later changes tween from the previous value. Reduced motion jumps straight to the value.
 * Never overshoots the target.
 */
export function useCountTo(value: number | null | undefined, opts: { active?: boolean; from?: number; duration?: number } = {}): number | null {
  const { active = true, from = 0, duration = 700 } = opts;
  const [shown, setShown] = useState<number | null>(null);
  const prev = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prev.current = null;
      setShown(null);
      return;
    }
    if (!active) return;
    if (prefersReducedMotion()) {
      prev.current = value;
      setShown(value);
      return;
    }
    const start = prev.current ?? from;
    const end = value;
    if (start === end) {
      prev.current = end;
      setShown(end);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (end - start) * settle(p);
      setShown(v);
      prev.current = v;
      if (p < 1) raf.current = requestAnimationFrame(step);
      else {
        prev.current = end;
        setShown(end);
      }
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    // Hidden tabs pause requestAnimationFrame. This guarantees the real value lands regardless.
    const safety = setTimeout(() => {
      prev.current = end;
      setShown(end);
    }, duration + 400);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearTimeout(safety);
    };
  }, [value, active, from, duration]);
  return shown;
}
