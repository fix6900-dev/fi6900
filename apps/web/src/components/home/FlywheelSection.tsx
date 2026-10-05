"use client";

import { ArrowUpRight } from "lucide-react";
import { useFlywheel } from "@/lib/api";
import { compact, num } from "@/lib/format";
import { Button } from "../ui/Button";
import { Card, SectionHeader } from "../ui/Card";
import { Countdown } from "../ui/Countdown";
import { NumberTicker } from "../ui/NumberTicker";
import { Skeleton } from "../ui/Skeleton";
import { FeeFlowDiagram } from "../flywheel/FeeFlowDiagram";

export function FlywheelSection() {
  const { data } = useFlywheel();
  const stats = [
    { label: "Creator fees claimed", value: data ? <NumberTicker value={data.creatorFeesClaimedSol} format={(n) => num(n, 2)} /> : null, unit: "SOL" },
    { label: "Units airdropped", value: data ? <NumberTicker value={data.airdroppedUnits} format={(n) => compact(n, 2)} /> : null, unit: "$FI6900" },
    { label: "$FI burned", value: data ? <NumberTicker value={data.burnedCoin} format={(n) => compact(n, 2)} /> : null, unit: "$FI" },
    { label: "LP added", value: data ? <NumberTicker value={data.lpAddedSol} format={(n) => num(n, 2)} /> : null, unit: "SOL" },
  ];
  return (
    <section className="wrap section pt-0">
      <SectionHeader
        eyebrow="Flywheel"
        title="Two tokens. One loop."
        desc="$FI creator fees fund the index: half becomes FI6900/SOL liquidity, half becomes new units airdropped to $FI holders. The index's own fees buy back and burn $FI."
        right={
          <Button href="/flywheel">
            Open flywheel <ArrowUpRight size={14} />
          </Button>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-5 sm:p-6">
          <FeeFlowDiagram data={data} compactMode />
        </Card>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line hairline lg:grid-cols-1">
          {stats.map((s) => (
            <div key={s.label} className="bg-surface p-5">
              <div className="eyebrow mb-2">{s.label}</div>
              <div className="num flex items-baseline gap-1.5 text-xl font-medium tracking-[-0.01em] sm:text-2xl">
                {s.value ?? <Skeleton className="h-6 w-20" />}
                <span className="text-xs font-normal text-muted">{s.unit}</span>
              </div>
            </div>
          ))}
          <div className="bg-surface p-5">
            <div className="eyebrow mb-2">Next airdrop</div>
            <div className="num text-xl font-medium sm:text-2xl">
              <Countdown to={data?.next.airdropAt} compact showDays={false} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
