"use client";

import { useDemoMode } from "@/lib/api";
import { useStreamStatus } from "@/lib/useStream";
import { cn } from "@/lib/utils";

/** The one pulsing element on the site. */
export function LiveDot({ tone = "accent", className }: { tone?: "accent" | "muted" | "amber" | "neg"; className?: string }) {
  const color = tone === "accent" ? "bg-accent" : tone === "amber" ? "bg-amber" : tone === "neg" ? "bg-neg" : "bg-muted";
  return <span className={cn("relative inline-block h-1.5 w-1.5 rounded-full", color, tone === "accent" && "live-dot", className)} aria-hidden />;
}

export function useLiveStatus() {
  const raw = useStreamStatus();
  const { demo } = useDemoMode();
  const status = demo ? "demo" : raw;
  return {
    live: { label: "Live", tone: "accent" as const },
    demo: { label: "Demo", tone: "amber" as const },
    connecting: { label: "Connecting", tone: "muted" as const },
    offline: { label: "Polling", tone: "muted" as const },
  }[status];
}

export function LivePill({ className, labelOverride }: { className?: string; labelOverride?: string }) {
  const map = useLiveStatus();
  return (
    <span className={cn("eyebrow inline-flex items-center gap-2", map.tone === "amber" && "text-amber", className)}>
      <LiveDot tone={map.tone} />
      {labelOverride ?? map.label}
    </span>
  );
}
