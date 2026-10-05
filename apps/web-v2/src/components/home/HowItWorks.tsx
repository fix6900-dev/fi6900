"use client";

import { useFund, useHoldings } from "@/lib/api";
import { Needle } from "../ui/Needle";
import { SectionHead } from "../ui/SectionHead";

export function HowItWorks() {
  const { data: fund } = useFund();
  const { data: holdings } = useHoldings();
  const count = fund ? Number(fund.assetCount) : holdings?.length ?? null;
  // The program's asset table holds up to MAX_ASSETS slots. The selection target is a methodology rule, not a ceiling.
  const PROGRAM_MAX_ASSETS = 512;
  const eq = holdings && holdings[0] ? (holdings[0].targetWeightBps / 100).toFixed(2) : count ? (100 / count).toFixed(2) : null;

  return (
    <section className="sec" aria-labelledby="how-h">
      <SectionHead n={4} title={<span id="how-h">How it works</span>} />
      <ol className="how">
        <li className="how-row">
          <span className="how-n micro" aria-hidden>
            01
          </span>
          <div className="how-body">
            <h3 className="h3">Methodology</h3>
            <p className="prose">The universe is CoinGecko&apos;s Solana Meme Coins category. Coins that pass the on-chain screens are held at equal weight. Additions and removals are proposed by the rules, approved by an index committee and announced 48 hours ahead.</p>
          </div>
          <div className="how-fig m" aria-label="Constituent slots and equal weight">
            <span className="how-fig-k micro muted">Constituents</span>
            <span className="how-fig-v">{count != null ? `${count} constituent${count === 1 ? "" : "s"}` : "—"}</span>
            <span className="faint">{eq ? `equal weight ${eq}% · ${PROGRAM_MAX_ASSETS} slots max` : `${PROGRAM_MAX_ASSETS} slots max`}</span>
          </div>
        </li>
        <li className="how-row">
          <span className="how-n micro" aria-hidden>
            02
          </span>
          <div className="how-body">
            <h3 className="h3">Creation and redemption in‑kind</h3>
            <p className="prose">FI6900 is an index fund that works the way SPY works, on-chain. Deposit the basket and mint units. Burn units and withdraw your pro-rata slice of every coin. Units are redeemable in-kind for a pro-rata share of the vault.</p>
          </div>
          <div className="how-fig m" aria-label="Creation and redemption flow">
            <span className="how-fig-k micro muted">Flow</span>
            <span className="how-flow">
              <span>basket</span>
              <span aria-hidden>→</span>
              <span>deposit</span>
              <span aria-hidden>→</span>
              <span>units</span>
            </span>
            <span className="how-flow">
              <span>units</span>
              <span aria-hidden>→</span>
              <span>burn</span>
              <span aria-hidden>→</span>
              <span>basket</span>
            </span>
          </div>
        </li>
        <li className="how-row">
          <span className="how-n micro" aria-hidden>
            03
          </span>
          <div className="how-body">
            <h3 className="h3">Arbitrage keeps the peg</h3>
            <p className="prose">If the market price trades above NAV, creating units and selling them closes the gap. Below NAV, buying units and redeeming them does. Rebalancing runs through permissionless on-chain Dutch auctions with no price oracle.</p>
          </div>
          <div className="how-fig">
            <span className="how-fig-k micro muted">Illustration, not live data</span>
            <Needle mini premiumBps={120} caption={false} />
          </div>
        </li>
      </ol>
    </section>
  );
}
