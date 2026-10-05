const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0Fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function usd(n: number | null | undefined, opts?: { compact?: boolean; precise?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts?.compact) return "$" + compact(n);
  if (opts?.precise || (Math.abs(n) < 1 && n !== 0)) {
    // small prices: show significant digits
    const abs = Math.abs(n);
    const digits = abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : 8;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  if (Math.abs(n) >= 100_000) return usd0Fmt.format(n);
  return usdFmt.format(n);
}

export function compact(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(digits) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(digits) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(digits) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(digits) + "K";
  return sign + numFmt.format(abs);
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function pct(n: number | null | undefined, digits = 2, signed = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toFixed(digits) + "%";
  return signed && n > 0 ? "+" + s : s;
}

export function bpsToPct(bps: number | null | undefined, digits = 2, signed = false): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  return pct(bps / 100, digits, signed);
}

/** Raw token amount (string|number|bigint) → UI float using decimals. */
export function fromRaw(amount: string | number | bigint, decimals: number): number {
  const s = typeof amount === "bigint" ? amount.toString() : String(amount);
  if (!/^\d+$/.test(s)) return Number(s) / 10 ** decimals;
  const padded = s.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  return Number(`${whole}.${frac}`);
}

export function tokens(amount: string | number | bigint, decimals: number, maxDigits = 4): string {
  const v = fromRaw(amount, decimals);
  if (v >= 1_000_000) return compact(v, 2);
  return v.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}

export function sol(lamportsOrSol: number, isLamports = false, digits = 3): string {
  const v = isLamports ? lamportsOrSol / 1e9 : lamportsOrSol;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " SOL";
}

export function relTime(iso: string | number | Date, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const d = Math.round((now - t) / 1000);
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function dateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

export function dateOnly(iso: string | number | Date): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

export function durationParts(ms: number): { d: number; h: number; m: number; s: number } {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
