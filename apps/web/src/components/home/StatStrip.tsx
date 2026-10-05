"use client";

import Link from "next/link";
import { useFlywheel, useFund } from "@/lib/api";
import { compact, int, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Countdown } from "../ui/Countdown";
import { NumberTicker } from "../ui/NumberTicker";
import { Skeleton } from "../ui/Skeleton";

export function StatStrip() {
  const { data: fund } = useFund();
  const { data: fw } = useFlywheel();
  const supplyUi = fund ? Number(fund.supply) / 1e6 : null;

  const cells: { label: string; value: React.ReactNode; href?: string; sub?: string }[] = [
    { label: "AUM", value: fund ? <NumberTicker value={fund.navUsd} format={(n) => usd(n, { compact: true })} /> : <Skeleton className="h-4 w-20" /> },
    { label: "Supply", value: supplyUi != null ? <NumberTicker value={supplyUi} format={(n) => compact(n, 2)} /> : <Skeleton className="h-4 w-20" />, sub: "units" },
    { label: "Constituents", value: fund ? <span className="font-mono">{fund.assetCount}</span> : <Skeleton className="h-4 w-8" />, href: "#holdings" },
    {
      label: fw?.next.scheduledRebalanceAt ? "Scheduled rebalance" : "Next drift check",
      value: <Countdown to={fw?.next.scheduledRebalanceAt ?? fw?.next.rebalanceCheckAt} compact />,
      href: "/methodology",
    },
    { label: "Epoch", value: fund ? <span className="font-mono">{int(fund.epoch)}</span> : <Skeleton className="h-4 w-12" />, sub: "fills" },
    { label: "Open auctions", value: fund ? <span className={cn("font-mono", fund.openAuctions > 0 && "text-accent")}>{fund.openAuctions}</span> : <Skeleton className="h-4 w-8" />, href: "/auctions" },
  ];

  return (
    <section className="border-b border-line bg-line">
      {/* gap-px on a line-coloured background draws every divider, however the grid wraps. */}
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => {
          const inner = (
            <div className="flex h-full flex-col gap-1.5 bg-bg px-4 py-4 sm:px-6">
              <div className="eyebrow truncate">{c.label}</div>
              <div className="num flex items-baseline gap-1.5 text-lg font-medium leading-none tracking-[-0.01em] sm:text-xl">
                {c.value}
                {c.sub && <span className="text-xs font-normal text-muted">{c.sub}</span>}
              </div>
            </div>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} className="bg-bg transition-colors hover:[&>div]:bg-surface">
              {inner}
            </Link>
          ) : (
            <div key={c.label}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}
