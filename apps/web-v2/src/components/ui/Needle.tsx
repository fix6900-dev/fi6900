"use client";

import { motion } from "framer-motion";
import { readSpring, useInViewOnce } from "@/lib/motion";

const RANGE = 300; // basis points either side of NAV
const BAND = 50; // arb band, basis points
const pos = (bps: number) => Math.min(100, Math.max(0, ((bps + RANGE) / (RANGE * 2)) * 100));

/**
 * The Peg Needle. Scale from -3% to +3% of NAV. The +/-0.5% arb band is pastel blue, the rest pastel
 * orange. The 2px ink needle shows the market premium and springs on update.
 * With no market price the needle is hidden and the scale fills from the centre outward.
 */
export function Needle({ premiumBps, mini, caption = true }: { premiumBps: number | null | undefined; mini?: boolean; caption?: boolean }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const has = premiumBps != null && Number.isFinite(premiumBps);
  const spring = readSpring();
  const outside = has && Math.abs(premiumBps!) > BAND;
  return (
    <div ref={ref} className={`peg${mini ? " peg-mini" : ""}`}>
      <div className="peg-ticks micro" aria-hidden>
        <span style={{ left: "0%" }}>−3%</span>
        <span style={{ left: `${pos(-BAND)}%` }}>−0.5%</span>
        <span style={{ left: `${pos(BAND)}%` }}>+0.5%</span>
        <span style={{ left: "100%" }}>+3%</span>
      </div>
      <div
        className="peg-scale"
        role="img"
        aria-label={has ? `Market price is ${premiumBps! > 0 ? "+" : ""}${(premiumBps! / 100).toFixed(2)}% against NAV. The arbitrage band is plus or minus 0.5%.` : "No market price yet. Peg needle unavailable."}
      >
        <motion.div className="peg-fill" initial={{ scaleX: 0 }} animate={{ scaleX: seen ? 1 : 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
        <div className="peg-band" style={{ left: `${pos(-BAND)}%`, width: `${pos(BAND) - pos(-BAND)}%` }} />
        {has && <motion.div className="peg-needle" initial={{ left: "50%" }} animate={{ left: seen ? `${pos(premiumBps!)}%` : "50%" }} transition={spring} />}
      </div>
      {caption && (
        <p className="faint peg-cap">
          {has ? (
            <>
              Market price is {premiumBps! > 0 ? "+" : ""}
              {(premiumBps! / 100).toFixed(2)}% against NAV{outside ? ", outside the 0.5% arbitrage band." : ", inside the 0.5% arbitrage band."}
            </>
          ) : (
            <>No market price yet. Units are created in-kind only.</>
          )}
        </p>
      )}
    </div>
  );
}
