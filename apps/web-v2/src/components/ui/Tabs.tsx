"use client";

import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Underline tabs. The ink underline slides between tabs. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  size = "md",
  className,
  id = "tabs",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  size?: "sm" | "md";
  className?: string;
  id?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label ?? id} className={cn("tabs", size === "sm" && "tabs-sm", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button key={it.value} role="tab" type="button" aria-selected={active} onClick={() => onChange(it.value)} className="tab">
            {it.label}
            {active && <motion.span layoutId={`${id}-u`} className="tab-u" transition={SPRING} />}
          </button>
        );
      })}
    </div>
  );
}
