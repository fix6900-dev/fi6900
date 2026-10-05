"use client";

import { useState } from "react";
import { coinColor } from "@/lib/coin";
import { cn } from "@/lib/utils";

/** 24px circle chip: logo if the API has one, otherwise a coin-colour disc with a 2-letter mono fallback. */
export function TokenLogo({ symbol, mint, src, size = 24, className }: { symbol: string; mint?: string; src?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const show = !!src && !failed;
  return (
    <span className={cn("tlogo", className)} style={{ width: size, height: size, background: coinColor(mint ?? symbol), fontSize: Math.max(10, Math.floor(size * 0.42)) }} aria-hidden>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        symbol.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
