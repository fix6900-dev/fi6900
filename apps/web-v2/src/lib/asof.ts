"use client";

import { useSyncExternalStore } from "react";

/** Timestamp (ms) of the keeper's most recent `asOf`. Null until the first live response. */
let asOf: number | null = null;
const listeners = new Set<() => void>();

export function setAsOf(ms: number) {
  if (!Number.isFinite(ms) || ms === asOf) return;
  asOf = ms;
  listeners.forEach((l) => l());
}

export function useAsOf(): number | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => asOf,
    () => null,
  );
}

export function utcClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}
