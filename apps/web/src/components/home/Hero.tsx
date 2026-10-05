"use client";

import { ArrowUpRight } from "lucide-react";
import { useFund, useHistory } from "@/lib/api";
import { num, usd } from "@/lib/format";
import { Button } from "../ui/Button";
import { LivePill } from "../ui/LivePill";
import { NumberTicker } from "../ui/NumberTicker";
import { PremiumBadge } from "../ui/PremiumBadge";
import { Skeleton } from "../ui/Skeleton";
import { Delta } from "../ui/Stat";

export function Hero() {
  const { data: fund } = useFund();
  const { data: hist } = useHistory("1d");

  const first = hist?.[0]?.indexLevel;
  const change24 = fund && first ? ((fund.indexLevel - first) / first) * 100 : null;

  const facts: string[] = [
    "Equal weight",
    `${fund?.assetCount ?? 40} constituents`,
    "Weekly rebalance · drift-triggered auctions",
    "Dutch auctions · no oracle",
    "In-kind create / redeem",
    fund ? `Fees ${fund.fees.mintBps / 100}% / ${fund.fees.redeemBps / 100}% / ${fund.fees.mgmtBps / 100}% p.a.` : "Fees — / — / —",
  ];

  return (
    <section className="border-b border-line">
      <div className="wrap pb-10 pt-14 sm:pb-12 sm:pt-20">
        <div className="flex items-center gap-4">
          <LivePill />
          <span className="eyebrow">Solana memecoin index</span>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="sr-only">FI6900 index level</h1>
          <div className="num text-[clamp(64px,13vw,164px)] font-semibold leading-[0.9] tracking-[-0.05em]">
            {fund ? <NumberTicker value={fund.indexLevel} format={(n) => num(n, 2)} duration={900} className="font-display" /> : <Skeleton className="h-[0.9em] w-[5.2ch]" />}
          </div>
          <div className="mb-2 flex items-baseline gap-2 sm:mb-4">
            <Delta value={change24} size="md" className="text-base sm:text-lg" reserve />
            <span className="text-xs text-muted">24h</span>
          </div>
        </div>

        {/* One line: NAV / market / premium. Widths reserved so ticks never reflow. */}
        <div className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-muted">NAV / unit</span>
            {fund ? <NumberTicker value={fund.navPerUnitUsd} format={(n) => usd(n, { precise: true })} reserve="$0.0000" className="font-medium" /> : <Skeleton className="h-4 w-16" />}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-muted">Market</span>
            {fund ? <NumberTicker value={fund.marketPriceUsd ?? null} format={(n) => usd(n, { precise: true })} reserve="$0.0000" className="font-medium" /> : <Skeleton className="h-4 w-16" />}
          </div>
          {fund ? <PremiumBadge bps={fund.premiumBps} /> : <Skeleton className="h-4 w-28" />}
        </div>

        <p className="mt-8 max-w-xl text-balance text-sm leading-relaxed text-muted sm:text-base">
          One token backed by a vault of the 40 largest Solana memecoins, equal-weighted, rebalanced through Dutch auctions and redeemable in-kind.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button href="/buy" variant="primary" size="lg">
            Buy $FI6900 <ArrowUpRight size={16} />
          </Button>
          <Button href="/verify" size="lg">
            Verify holdings
          </Button>
        </div>
      </div>

      {/* Fund facts, as one slim row rather than a card competing with the number. Hidden on phones, where it would stack. */}
      <div className="hidden border-t border-line sm:block">
        <ul className="wrap hidden flex-wrap gap-x-6 gap-y-2 py-3 font-mono text-xs text-muted sm:flex">
          {facts.map((f) => (
            <li key={f} className="whitespace-nowrap">
              {f}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
