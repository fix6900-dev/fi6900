"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * Test-runner resolution for verification rows: each row shows "·" (waiting), "◐" (running) and then
 * its real result, 120ms apart, top to bottom. Rows resolve only once `ready` is true, which callers
 * set from real data, so a row is never shown as passing before the check has actually run.
 */
export function useRunner(ready: boolean, count: number, gap = 120): number {
  const [resolved, setResolved] = useState(0);
  useEffect(() => {
    if (!ready) {
      setResolved(0);
      return;
    }
    if (prefersReducedMotion()) {
      setResolved(count);
      return;
    }
    setResolved(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= count; i++) timers.push(setTimeout(() => setResolved(i), i * gap));
    return () => timers.forEach(clearTimeout);
  }, [ready, count, gap]);
  return resolved;
}

export type CheckState = "waiting" | "running" | "pass" | "fail";

export function stateFor(i: number, resolved: number, ready: boolean, ok: boolean | null): CheckState {
  if (!ready) return "waiting";
  if (i < resolved) return ok === false ? "fail" : "pass";
  if (i === resolved) return "running";
  return "waiting";
}

/** The glyph chip. A pass stamps in as a pastel-blue chip with scale 0.9 to 1. */
export function CheckGlyph({ state }: { state: CheckState }) {
  if (state === "pass")
    return (
      <motion.span key="pass" className="ck ck-pass" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 38 }} role="img" aria-label="passed">
        ✓
      </motion.span>
    );
  if (state === "fail")
    return (
      <span className="ck ck-fail" role="img" aria-label="failed">
        ×
      </span>
    );
  if (state === "running")
    return (
      <span className="ck ck-run" role="img" aria-label="running">
        ◐
      </span>
    );
  return (
    <span className="ck ck-wait" role="img" aria-label="waiting">
      ·
    </span>
  );
}
