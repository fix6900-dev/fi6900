"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useFlywheel, useFlywheelEvents } from "@/lib/api";
import { compact, num } from "@/lib/format";
import { Figure } from "../ui/Figure";
import { Notes } from "../ui/Fn";
import { SectionHead } from "../ui/SectionHead";
import { FeeLoop, flows24h } from "../flywheel/FeeLoop";

export function FlywheelSection() {
  const { data } = useFlywheel();
  const { data: events } = useFlywheelEvents(100);
  const flows = useMemo(() => flows24h(events), [events]);
  const idle = !!data && !data.coinMint;

  return (
    <section className="sec" aria-labelledby="fw-h">
      <SectionHead n={5} title={<span id="fw-h">Flywheel</span>} right={<Link href="/flywheel" className="lnk">Flywheel detail →</Link>} />
      <p className="sec-lede">Two tokens. $FIX6900 creator fees fund the index; the index&apos;s own fees buy back and burn $FIX6900.</p>
      <div className="fw-grid">
        <FeeLoop data={data} flows={flows} />
        <dl className="counters">
          <div>
            <dt className="micro muted">Creator fees claimed</dt>
            <dd>
              <Figure value={data?.creatorFeesClaimedSol} format={(n) => num(n, 2)} /> <span className="unit">SOL</span>
            </dd>
          </div>
          <div>
            <dt className="micro muted">Liquidity added</dt>
            <dd>
              <Figure value={data?.lpAddedSol} format={(n) => num(n, 2)} /> <span className="unit">SOL</span>
            </dd>
          </div>
          <div>
            <dt className="micro muted">Units airdropped</dt>
            <dd>
              <Figure value={data?.airdroppedUnits} format={(n) => compact(n, 2)} /> <span className="unit">$FI6900</span>
            </dd>
          </div>
          <div>
            <dt className="micro muted">$FIX6900 burned</dt>
            <dd>
              <Figure value={data?.burnedCoin} format={(n) => compact(n, 2)} /> <span className="unit">$FIX6900</span>
            </dd>
          </div>
        </dl>
      </div>
      {idle && <p className="faint idle-note">Counters start when $FIX6900 launches. Coin mint not set on devnet.</p>}
      <Notes notes={[{ label: "Counters are keeper totals taken from its flywheel ledger; every event behind them has a transaction signature on Flywheel", source: "keeper snapshot" }]} />
    </section>
  );
}
