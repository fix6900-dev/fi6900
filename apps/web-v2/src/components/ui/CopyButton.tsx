"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Text glyph copy control. Shows a check for 1.2s after copying. */
export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : (label ?? "Copy to clipboard")}
      title={label ?? "Copy"}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => setDone(true));
      }}
      className={cn("copybtn", done && "is-done", className)}
    >
      <span aria-hidden>{done ? "✓" : "copy"}</span>
    </button>
  );
}
