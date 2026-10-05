import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "neg" | "amber" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent-dim text-accent",
  neg: "bg-neg-dim text-neg",
  amber: "bg-amber-dim text-amber",
  outline: "hairline text-muted",
};

/** Reserved for exceptional states. Normal states render as plain text, not a pill. */
export function Badge({ tone = "neutral", className, children, mono }: { tone?: Tone; className?: string; children: ReactNode; mono?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none tracking-wide", mono && "font-mono", tones[tone], className)}>
      {children}
    </span>
  );
}
