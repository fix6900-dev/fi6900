"use client";

import { useState } from "react";
import { cn, hash32 } from "@/lib/utils";

const SHADES = ["#262b33", "#2a2520", "#1f2a2a", "#2b2230", "#20262e", "#2a2a22"];

export function TokenLogo({ symbol, src, size = 28, className }: { symbol: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const show = !!src && !failed;
  const bg = SHADES[hash32(symbol) % SHADES.length];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-mono font-semibold text-text/80 hairline", className)}
      style={{ width: size, height: size, background: bg, fontSize: Math.max(11, Math.floor(size * 0.4)) }}
      aria-hidden
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt="" width={size} height={size} className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        symbol.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
