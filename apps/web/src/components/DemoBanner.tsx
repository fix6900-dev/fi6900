"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useDemoMode } from "@/lib/api";
import { env } from "@/lib/env";

export function DemoBanner() {
  const { demo } = useDemoMode();
  return (
    <AnimatePresence initial={false}>
      {demo && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-b border-amber/20 bg-amber-dim"
          role="status"
        >
          <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-1.5 text-[12px] text-amber sm:px-6">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
            <span className="min-w-0 truncate">
              <span className="font-semibold">Demo data.</span> Keeper API at <span className="font-mono">{env.apiUrl}</span> is unreachable; showing simulated fixtures. Reconnecting in the background.
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
