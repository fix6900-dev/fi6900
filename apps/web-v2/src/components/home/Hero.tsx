"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDemoMode, useFlywheel, useFund, useHistory } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { env } from "@/lib/env";
import { bpsToPct, dateOnly, int } from "@/lib/format";
import { Countdown, useSecondsLeft } from "../ui/Countdown";
import { Delta } from "../ui/Delta";
import { Figure } from "../ui/Figure";
import { Flash } from "../ui/Flash";
import { Fn, Notes, type Note } from "../ui/Fn";
import { Level } from "../ui/Level";
import { Needle } from "../ui/Needle";

const money = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function useDayChange(indexLevel: number | undefined) {
  const { data } = useHistory("1d");
  return useMemo(() => {
    if (!data || data.length < 2 || indexLevel == null) return { pct: null as number | null, spanH: null as number | null };
    const first = data[0];
    const last = data[data.length - 1];
    const spanH = (last.t - first.t) / 3_600_000;
    if (spanH < 23.5) return { pct: null, spanH };
    return { pct: (indexLevel / first.indexLevel - 1) * 100, spanH };
  }, [data, indexLevel]);
}

export function Hero() {
  const { data: fund } = useFund();
  const { data: fw } = useFlywheel();
  const { demo } = useDemoMode();
  const asOf = useAsOf();
  const clock = demo ? "sample" : asOf ? `${utcClock(asOf)} UTC` : null;
  const change = useDayChange(fund?.indexLevel);
  const supply = fund ? Number(fund.supply) / 1e6 : null;
  const offMainnet = env.cluster !== "mainnet-beta";
  const secsToCheck = useSecondsLeft(fw?.next.rebalanceCheckAt ?? null);
  const hot = secsToCheck != null && secsToCheck >= 0 && secsToCheck < 60;

  const notes: Note[] = [
    { label: "NAV per unit = sum of vault balances × keeper prices ÷ index supply. Read from the fund account", address: fund?.fundPda },
    { label: "Units outstanding. Index mint supply, 6 decimals", address: fund?.indexMint ?? env.indexMint, kind: "token" },
    { label: "AUM = vault balances × keeper prices across all vault token accounts, listed on Verify", source: "keeper snapshot, 12 vaults on /verify" },
    { label: "Constituents = active asset slots in the fund account", address: fund?.fundPda },
  ];
  notes[2] = { ...notes[2], source: fund ? `keeper snapshot, ${int(fund.assetCount)} vaults on /verify` : "keeper snapshot, vaults on /verify" };

  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" className="sr-only">
        FIX6900 Solana Memecoin Equal Weight Index
      </h1>
      <div className="quote-band micro">
        <span>
          FIX6900 Solana Memecoin Equal Weight Index
          <span className="qb-lvl"> · Level{offMainnet ? ` · ${env.cluster === "devnet" ? "Devnet" : env.cluster}` : ""}
          {demo ? " · Sample data" : ""}</span>
        </span>
        <span>
          <span className="qb-m" aria-hidden>
            Level{offMainnet ? ` · ${env.cluster === "devnet" ? "Devnet" : env.cluster}` : ""} ·{" "}
          </span>
          Base 1000.00
        </span>
      </div>

      <Level value={fund?.indexLevel} base={1000} />

      <div className="under">
        <div className="chg">
          <Flash value={fund?.indexLevel}>
            <Delta value={change.pct} arrow className="chg-v" />
          </Flash>
          <span className="faint">
            {change.pct != null ? "24h" : change.spanH != null ? `24h · history starts ${Math.max(1, Math.round(change.spanH))}h ago` : fund ? "24h · no history yet" : "24h"}
          </span>
        </div>
        <div className="cta">
          <Link href="/buy" className="btn btn-primary btn-lg">
            Buy $FIX6900
          </Link>
          <Link href="/verify" className="btn btn-secondary btn-lg">
            Verify holdings
          </Link>
        </div>
      </div>

      <dl className="kf-strip">
        <div className="kf">
          <dt className="micro muted">NAV per unit</dt>
          <dd>
            <Flash value={fund?.navPerUnitUsd}>
              <Figure className="kf-v" value={fund?.navPerUnitUsd} format={(n) => money(n, 4)} />
            </Flash>
            {fund && <Fn n={1} note={notes[0]} />}
          </dd>
          <dd className="faint">{clock ? `as of ${clock}` : "loading"}</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">Market price</dt>
          <dd>
            <Figure className="kf-v" value={fund?.marketPriceUsd} format={(n) => money(n, 4)} />
          </dd>
          <dd className="faint">{fund ? (fund.marketPriceUsd == null ? "No market price yet" : `premium ${bpsToPct(fund.premiumBps, 2, true)} · as of ${clock}`) : "loading"}</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">Supply</dt>
          <dd>
            <Figure className="kf-v" value={supply} format={(n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
            {fund && <Fn n={2} note={notes[1]} />}
          </dd>
          <dd className="faint">{clock ? `units · as of ${clock}` : "units"}</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">AUM</dt>
          <dd>
            <Figure className="kf-v" value={fund?.navUsd} format={(n) => money(n, 2)} />
            {fund && <Fn n={3} note={notes[2]} />}
          </dd>
          <dd className="faint">{clock ? `vaults · as of ${clock}` : "vaults"}</dd>
        </div>
      </dl>

      <div className="peg-block">
        <div className="micro muted peg-title">Peg needle · market premium to NAV</div>
        <Needle premiumBps={fund?.premiumBps} />
      </div>

      <dl className="stat-strip" aria-label="Fund statistics">
        <div className="st">
          <dt className="micro muted">Constituents</dt>
          <dd>
            <Figure className="st-v" value={fund ? Number(fund.assetCount) : null} format={(n) => String(Math.round(n))} />
            {fund && <Fn n={4} note={notes[3]} />}
          </dd>
          <dd className="faint">
            <Link href="/verify#vaults" className="lnk">
              vault table
            </Link>
          </dd>
        </div>
        <div className="st">
          <dt className="micro muted">Next drift check</dt>
          <dd>
            <span className={`st-v${hot ? " is-hot" : ""}`}>
              <Countdown to={fw?.next.rebalanceCheckAt} compact emptyText="—" />
            </span>
          </dd>
          <dd className="faint">{fw?.next.scheduledRebalanceAt ? `scheduled rebalance ${dateOnly(fw.next.scheduledRebalanceAt).replace(/ /g, " ")}` : fw ? "no rebalance scheduled" : "loading"}</dd>
        </div>
        <div className="st">
          <dt className="micro muted">Epoch</dt>
          <dd>
            <Figure className="st-v" value={fund ? Number(fund.epoch) : null} format={(n) => String(Math.round(n))} />
          </dd>
          <dd className="faint">increments on every fill</dd>
        </div>
        <div className="st">
          <dt className="micro muted">Open auctions</dt>
          <dd>
            <Figure className="st-v" value={fund ? Number(fund.openAuctions) : null} format={(n) => String(Math.round(n))} />
          </dd>
          <dd className="faint">
            <Link href="/auctions" className="lnk">
              auctions
            </Link>
          </dd>
        </div>
        <div className="st">
          <dt className="micro muted">Fees</dt>
          <dd>
            <span className="st-v sm">{fund ? `${(Number(fund.fees.mintBps) / 100).toFixed(2)} / ${(Number(fund.fees.redeemBps) / 100).toFixed(2)} / ${(Number(fund.fees.mgmtBps) / 100).toFixed(2)}%` : "—"}</span>
          </dd>
          <dd className="faint">create / redeem / mgmt p.a.</dd>
        </div>
      </dl>

      <Notes notes={notes} asOf={clock ?? undefined} />
    </section>
  );
}
