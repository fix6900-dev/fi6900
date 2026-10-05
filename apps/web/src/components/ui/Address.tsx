"use client";

import { ExternalLink } from "lucide-react";
import { solscan } from "@/lib/solscan";
import { cn, truncateMiddle } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

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
  // Full addresses flow inline so they can break mid-string on narrow screens; truncated ones stay on one line.
  const inner = <span className={cn("font-mono text-xs tabular-nums", full ? "break-all" : "whitespace-nowrap")}>{text}</span>;
  const icon = <ExternalLink size={11} className={cn("text-dim transition-colors group-hover:text-accent", full ? "ml-1 inline-block align-[-1px]" : "")} />;
  return (
    <span className={cn(full ? "inline min-w-0" : "inline-flex min-w-0 items-center gap-1 whitespace-nowrap", className)}>
      {link ? (
        <a
          href={solscan(kind, value)}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className={cn("group text-text/90 hover:text-accent", full ? "inline" : "inline-flex items-center gap-1")}
          title={value}
        >
          {inner}
          {icon}
        </a>
      ) : (
        <span title={value}>{inner}</span>
      )}
      {copy && <CopyButton value={value} className={cn(full && "ml-1 inline-flex align-middle")} />}
    </span>
  );
}
