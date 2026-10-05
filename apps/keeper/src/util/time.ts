export const SEC = 1_000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Average Solana slot time used for slot<->time estimates. */
export const SLOT_MS = 400;

export const nowIso = (): string => new Date().toISOString();

export function startOfNextMonthUtc(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export function startOfMonthUtc(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function msToSlots(ms: number): number {
  return Math.max(1, Math.round(ms / SLOT_MS));
}
