"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFund } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { env } from "@/lib/env";
import { bpsToPct } from "@/lib/format";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Figure } from "../ui/Figure";
import { Notes } from "../ui/Fn";
import { Needle } from "../ui/Needle";
import { PageHeader } from "../ui/Card";

declare global {
  interface Window {
    Jupiter?: {
      init: (opts: Record<string, unknown>) => void;
      syncProps?: (p: Record<string, unknown>) => void;
    };
  }
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const money = (n: number) => "$" + n.toFixed(4);

function Fallback({ mint }: { mint: string }) {
  return (
    <div className="notice">
      <p className="prose">Jupiter routes mainnet only, so there is no swap widget on devnet. Units are created and redeemed in-kind: deposit the basket to mint units, or burn units to withdraw the basket.</p>
      <div className="cta">
        <Button href="/create" variant="primary">
          Create in-kind
        </Button>
        <Button href="/create?mode=redeem" variant="secondary">
          Redeem in-kind
        </Button>
      </div>
      {mint && (
        <p className="faint">
          Index mint: <Address value={mint} kind="token" head={6} tail={6} />
        </p>
      )}
    </div>
  );
}

function JupiterTerminal({ outputMint }: { outputMint: string }) {
  const wallet = useWallet();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const inited = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const init = () => {
      if (cancelled || inited.current || !window.Jupiter) return;
      inited.current = true;
      try {
        window.Jupiter.init({
          displayMode: "integrated",
          integratedTargetId: "jupiter-terminal",
          endpoint: env.rpcUrl,
          strictTokenList: false,
          defaultExplorer: "Solscan",
          // Both directions: $FI6900 is the initial output, but neither side is fixed, so the user can flip to sell units for SOL.
          formProps: { initialInputMint: SOL_MINT, initialOutputMint: outputMint, swapMode: "ExactIn" },
          containerStyles: { background: "transparent", borderRadius: "0" },
        });
        setState("ready");
      } catch {
        setState("error");
      }
    };
    if (window.Jupiter) init();
    else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-jup="1"]');
      const s = existing ?? document.createElement("script");
      if (!existing) {
        s.src = "https://terminal.jup.ag/main-v4.js";
        s.async = true;
        s.dataset.jup = "1";
        document.head.appendChild(s);
      }
      s.addEventListener("load", init);
      s.addEventListener("error", () => setState("error"));
    }
    return () => {
      cancelled = true;
    };
  }, [outputMint]);

  useEffect(() => {
    if (state !== "ready" || !window.Jupiter?.syncProps) return;
    window.Jupiter.syncProps({ passthroughWalletContextState: wallet });
  }, [wallet, state]);

  if (state === "error") return <Fallback mint={outputMint} />;
  return (
    <div className="jup">
      {state === "loading" && <p className="faint jup-msg">Loading Jupiter Terminal</p>}
      <div id="jupiter-terminal" />
    </div>
  );
}

export function BuyView() {
  const { data: fund } = useFund();
  const asOf = useAsOf();
  const clock = asOf ? `${utcClock(asOf)} UTC` : undefined;
  const outputMint = env.indexMint || fund?.indexMint || "";
  const premium = fund?.premiumBps ?? null;
  const warn = premium != null && premium > 150;
  const mainnet = env.cluster === "mainnet-beta";

  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Buy" title="Buy $FI6900." desc="Swap SOL for index units on Jupiter, or flip the pair to sell units back to SOL. If the market trades well above NAV, creating units in-kind is cheaper; well below, redeeming in-kind is." />

      <div className="split">
        <section className="split-main" aria-label="Swap">
          <div className="panel-h">
            <span className="micro muted">Jupiter Terminal · SOL ↔ $FI6900</span>
            {outputMint && <Address value={outputMint} kind="token" head={5} tail={5} />}
          </div>
          <div className="panel-b">
            {!outputMint ? <p className="prose">The index mint is not configured, so the swap widget is unavailable.</p> : mainnet ? <JupiterTerminal outputMint={outputMint} /> : <Fallback mint={outputMint} />}
          </div>
        </section>

        <aside className="split-side" aria-label="Pricing">
          <dl className="kf-list">
            <div className="kfl">
              <dt className="micro muted">NAV per unit</dt>
              <dd>
                <Figure className="kfl-v" value={fund?.navPerUnitUsd} format={money} />
              </dd>
              <dd className="faint">{clock ? `as of ${clock}` : "loading"}</dd>
            </div>
            <div className="kfl">
              <dt className="micro muted">Market price</dt>
              <dd>
                <Figure className="kfl-v" value={fund?.marketPriceUsd} format={money} />
              </dd>
              <dd className="faint">{fund && fund.marketPriceUsd == null ? "No market price yet" : "Jupiter route"}</dd>
            </div>
            <div className="kfl">
              <dt className="micro muted">Premium / discount</dt>
              <dd>
                <span className="kfl-v">{premium != null ? bpsToPct(premium, 2, true) : "—"}</span>
              </dd>
            </div>
            <div className="kfl">
              <dt className="micro muted">Fees</dt>
              <dd className="m">{fund ? `create ${bpsToPct(fund.fees.mintBps, 2)} · redeem ${bpsToPct(fund.fees.redeemBps, 2)} · management ${bpsToPct(fund.fees.mgmtBps, 2)} a year` : "—"}</dd>
            </div>
          </dl>
          <Needle premiumBps={premium} />
          {warn && (
            <div className="banner-inline" role="alert">
              <p>
                The market price is {bpsToPct(premium, 2)} above NAV. Creating units in-kind costs {fund ? bpsToPct(fund.fees.mintBps, 2) : "0.50%"}. Consider creating instead.{" "}
                <Link href="/create" className="lnk">
                  Create in-kind →
                </Link>
              </p>
            </div>
          )}
          <p className="prose-sm">One unit is a pro-rata claim on the vault, redeemable in-kind for the underlying coins. $FI6900 is not a promise of returns.</p>
        </aside>
      </div>
      <Notes notes={[{ label: "NAV per unit read from the fund account", address: fund?.fundPda }]} asOf={clock} />
    </div>
  );
}
