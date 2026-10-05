import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "verified" | "pending" | "down" | "outline";

/** State chips. Colour is reserved for state: verified (blue), pending and premium (orange), failure (down). */
export function Badge({ tone = "outline", className, children }: { tone?: Tone | "accent" | "neg" | "amber"; className?: string; children: ReactNode }) {
  const t = tone === "accent" ? "verified" : tone === "amber" ? "pending" : tone === "neg" ? "down" : tone;
  return <span className={cn("chip", `chip-${t}`, className)}>{children}</span>;
}
