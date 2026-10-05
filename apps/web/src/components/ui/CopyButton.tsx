"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label ?? "Copy"}
      title={label ?? "Copy"}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => setDone(true));
      }}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-surface-3 hover:text-text",
        done && "text-accent hover:text-accent",
        className,
      )}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
