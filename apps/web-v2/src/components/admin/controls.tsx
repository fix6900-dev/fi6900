"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact labelled input. Uses the shared `.field` wrapper so it matches the other app forms. */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="micro text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-relaxed text-dim">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, mono = true, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <span className={cn("field h-9", className)}>
      <input {...rest} className={cn("h-full w-full min-w-0 bg-transparent text-[13px] placeholder:text-dim", mono && "font-mono tabular-nums")} />
    </span>
  );
}

export function Toggle({ checked, onChange, label, tone = "neutral", disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; tone?: "neutral" | "neg"; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors hover:bg-panel-2 disabled:opacity-40", checked ? (tone === "neg" ? "text-neg" : "text-ink") : "text-muted")}
    >
      <span className={cn("relative inline-block h-4 w-7 rounded-full transition-colors", checked ? (tone === "neg" ? "bg-neg" : "bg-accent") : "bg-panel-3")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-paper transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function Warn({ children, tone = "neg" }: { children: ReactNode; tone?: "neg" | "amber" }) {
  return <div className={cn("rounded-md px-3 py-2 text-xs leading-relaxed", tone === "neg" ? "bg-neg-dim text-neg" : "bg-amber-dim text-amber")}>{children}</div>;
}

/** Key/value row used by the governance and status panels. */
export function KV({ k, v, note }: { k: ReactNode; v: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-2.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start">
      <dt className="text-xs text-muted sm:pt-0.5">{k}</dt>
      <dd className="min-w-0 text-[13px]">
        {v}
        {note && <div className="mt-0.5 text-[11px] leading-relaxed text-dim">{note}</div>}
      </dd>
    </div>
  );
}

/* Solana slot cadence; used for the ≈ time hints next to slot numbers. */
export const SLOT_MS = 400;
export function slotsToMs(slots: number | string): number {
  return Number(slots) * SLOT_MS;
}
export function approxDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  if (abs < 48 * 3_600_000) return `${(abs / 3_600_000).toFixed(1)}h`;
  return `${(abs / 86_400_000).toFixed(1)}d`;
}
