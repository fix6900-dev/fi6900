"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function HelpPopover({ title, children, className, align = "right" }: { title?: string; children: ReactNode; className?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-6 w-6 items-center justify-center rounded text-dim transition-colors hover:bg-surface-3 hover:text-text", open && "text-text")}
      >
        <CircleHelp size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={cn("absolute top-8 z-40 w-[min(92vw,360px)] rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-muted shadow-2xl hairline", align === "right" ? "right-0" : "left-0")}
          >
            {title && <div className="mb-1.5 text-sm font-semibold text-text">{title}</div>}
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
