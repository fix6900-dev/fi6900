"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  className,
  id = "tabs",
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  size?: "sm" | "md";
  className?: string;
  id?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-md bg-surface-2 p-0.5 hairline", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn("relative rounded-[5px] font-medium transition-colors", size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3.5 text-[13px]", active ? "text-text" : "text-muted hover:text-text")}
          >
            {active && <motion.span layoutId={`${id}-pill`} className="absolute inset-0 rounded-[5px] bg-surface-3" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            <span className="relative z-10">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
