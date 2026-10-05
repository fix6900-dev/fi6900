"use client";

import { solscan } from "@/lib/solscan";
import { cn, truncateMiddle } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

/** Truncated address in mono, full value in title and aria, copy button and a Solscan link. */
export function Address({
  value,
  kind = "account",
  head = 4,
  tail = 4,
  copy = true,
  link = true,
  className,
  full,
}: {
  value: string;
  kind?: "account" | "token" | "tx";
  head?: number;
  tail?: number;
  copy?: boolean;
  link?: boolean;
  className?: string;
  full?: boolean;
}) {
  const text = full ? value : truncateMiddle(value, head, tail);
  return (
    <span className={cn("addr", full && "addr-full", className)}>
      {link ? (
        <a href={solscan(kind, value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="lnk" title={value} aria-label={`${kind} ${value}, open on Solscan`}>
          {text} ↗
        </a>
      ) : (
        <span title={value} aria-label={value}>
          {text}
        </span>
      )}
      {copy && <CopyButton value={value} />}
    </span>
  );
}
