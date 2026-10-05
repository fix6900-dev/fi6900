"use client";

import { useEffect, useState } from "react";
import { useDemoMode } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { env } from "@/lib/env";
import { solscanAccount } from "@/lib/solscan";
import { useNow } from "../ui/Countdown";

const STALE_MS = 90_000;
type Theme = "paper" | "ink";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("paper");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "ink" ? "ink" : "paper");
    read();
    // Several toggles can be mounted (masthead, mobile menu). They all follow the document attribute.
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    if (t === "ink") document.documentElement.dataset.theme = "ink";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("fi6900.theme", t);
    } catch {
      /* storage blocked: the choice lasts for this page view only */
    }
  };
  return (
    <div className="theme" role="group" aria-label="Theme">
      {(["paper", "ink"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => apply(t)} className="theme-btn">
          {t === "paper" ? "Paper" : "Ink"}
        </button>
      ))}
    </div>
  );
}

export function Masthead() {
  const asOf = useAsOf();
  const { demo } = useDemoMode();
  const now = useNow(5000);
  const offMainnet = env.cluster !== "mainnet-beta";
  const stale = demo || (asOf != null && now != null && now - asOf > STALE_MS);
  const label = demo ? (
    "sample data"
  ) : asOf == null ? (
    "connecting"
  ) : stale ? (
    `stale · last ${utcClock(asOf)} UTC`
  ) : (
    <>
      <span className="mh-asof">as of </span>
      {utcClock(asOf)} UTC
    </>
  );
  const clusterName = env.cluster === "mainnet-beta" ? "Mainnet" : env.cluster === "devnet" ? "Devnet" : env.cluster === "testnet" ? "Testnet" : "Localnet";

  return (
    <div className="masthead">
      <div className="page masthead-in micro">
        <div className="mh-l">
          {offMainnet && <span className="chip chip-pending">{clusterName}</span>}
          <span className="live" role="status">
            <span className={`dot${stale ? " is-stale" : ""}`} aria-hidden />
            <span>{label}</span>
          </span>
        </div>
        <div className="mh-r">
          <ThemeToggle />
          <a className="lnk" href={solscanAccount(env.programId)} target="_blank" rel="noreferrer noopener">
            <span className="mh-prog-l" aria-hidden>Program ↗</span>
            <span className="mh-prog-s" aria-hidden>↗</span>
            <span className="sr-only">Program on Solscan</span>
          </a>
        </div>
      </div>
    </div>
  );
}
