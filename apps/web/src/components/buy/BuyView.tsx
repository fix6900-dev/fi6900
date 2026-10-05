"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFund } from "@/lib/api";
import { env } from "@/lib/env";
import { bpsToPct, usd } from "@/lib/format";
import { solscanToken } from "@/lib/solscan";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Card, CardHeader, PageHeader } from "../ui/Card";
import { NumberTicker } from "../ui/NumberTicker";
import { PremiumBadge } from "../ui/PremiumBadge";
import { Skeleton } from "../ui/Skeleton";

declare global {
  interface Window {
    Jupiter?: {
      init: (opts: Record<string, unknown>) => void;
      resume?: () => void;
      close?: () => void;
      syncProps?: (p: Record<string, unknown>) => void;
      _instance?: unknown;
    };
  }
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

function JupiterTerminal({ outputMint }: { outputMint: string }) {
  const wallet = useWallet();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const inited = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
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
          formProps: {
            fixedOutputMint: true,
            initialInputMint: SOL_MINT,
            initialOutputMint: outputMint,
            swapMode: "ExactIn",
          },
          containerStyles: { borderRadius: "8px", background: "#111317" },
          containerClassName: "fi-jup",
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

  // Pass wallet through when connected (passthrough wallet)
  useEffect(() => {
    if (state !== "ready" || !window.Jupiter?.syncProps) return;
    window.Jupiter.syncProps({ passthroughWalletContextState: wallet });
  }, [wallet, state]);

  return (
    <div className="relative min-h-[560px]">
      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-xs text-muted">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
            Loading Jupiter Terminal
          </div>
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-sm space-y-3 text-sm text-muted">
            <p>Jupiter Terminal could not be loaded.</p>
            <Button href={`https://jup.ag/swap/SOL-${outputMint}`} variant="primary">
              Open on jup.ag <ExternalLink size={14} />
            </Button>
          </div>
        </div>
      )}
      <div id="jupiter-terminal" className="h-full w-full" />
    </div>
  );
}

export function BuyView() {
  const { data: fund } = useFund();
  const outputMint = env.indexMint || fund?.indexMint || "";
  const premium = fund?.premiumBps ?? null;
  const warn = premium != null && premium > 150;

  return (
    <div className="wrap page">
      <PageHeader
        eyebrow="Buy"
        title="Buy $FI6900 on the open market."
        desc={
          <>
            Swap SOL for index units via Jupiter. If the market trades well above NAV,{" "}
            <Link href="/create" className="text-text underline decoration-line underline-offset-2 hover:text-accent">
              in-kind creation
            </Link>{" "}
            is cheaper.
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader
            eyebrow="Jupiter Terminal"
            title={
              <span className="inline-flex items-center gap-2">
                SOL <ArrowRight size={14} className="text-muted" /> $FI6900
              </span>
            }
            right={outputMint ? <Address value={outputMint} kind="token" head={5} tail={5} /> : <span className="text-xs text-muted">Mint not configured</span>}
          />
          <div className="p-2 sm:p-5">
            {outputMint ? (
              <JupiterTerminal outputMint={outputMint} />
            ) : (
              <div className="grid min-h-[400px] place-items-center text-center text-sm text-muted">
                Set <span className="mx-1 font-mono text-text">NEXT_PUBLIC_INDEX_MINT</span> to enable the swap widget.
              </div>
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader eyebrow="Pricing" title="NAV vs market" right={fund ? <PremiumBadge bps={fund.premiumBps} size="sm" /> : null} />
            <dl className="divide-y divide-line px-5">
              <Row k="NAV per unit" v={fund ? <NumberTicker value={fund.navPerUnitUsd} format={(n) => usd(n, { precise: true })} reserve="$0.0000" /> : <Skeleton className="h-4 w-20" />} />
              <Row k="Market price" v={fund ? <NumberTicker value={fund.marketPriceUsd ?? null} format={(n) => usd(n, { precise: true })} reserve="$0.0000" /> : <Skeleton className="h-4 w-20" />} />
              <Row
                k="Premium / discount"
                v={
                  fund ? (
                    <span className={warn ? "text-amber" : undefined}>
                      {premium != null && premium > 0 ? "+" : ""}
                      {bpsToPct(premium, 2)}
                    </span>
                  ) : (
                    <Skeleton className="h-4 w-16" />
                  )
                }
              />
              <Row k="Creation fee" v={fund ? bpsToPct(fund.fees.mintBps, 2) : "—"} />
              <Row k="Redemption fee" v={fund ? bpsToPct(fund.fees.redeemBps, 2) : "—"} />
            </dl>
          </Card>

          {warn && (
            <div role="alert" className="flex gap-3 rounded-lg bg-amber-dim p-5 text-[13px] leading-relaxed text-amber">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Market price is {bpsToPct(premium, 2)} above NAV.</div>
                <p className="mt-1 text-amber/80">Creating units in-kind costs the basket plus a {fund ? bpsToPct(fund.fees.mintBps, 2) : "0.50%"} fee, which is cheaper.</p>
                <Link href="/create" className="mt-2 inline-flex items-center gap-1 font-medium text-amber hover:underline">
                  Create in-kind instead <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          )}

          <Card className="p-5 text-[13px] leading-relaxed text-muted">
            <div className="eyebrow mb-2">What you are buying</div>
            <p>
              One unit is a pro-rata claim on the vault: 40 memecoins at equal weight. Redeem it at any time for the underlying tokens on the{" "}
              <Link href="/create" className="text-text hover:text-accent">
                AP console
              </Link>
              , or sell it back on Jupiter.
            </p>
            {outputMint && (
              <a href={solscanToken(outputMint)} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-1 text-text hover:text-accent">
                Index mint on Solscan <ExternalLink size={12} />
              </a>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-[13px]">
      <dt className="text-muted">{k}</dt>
      <dd className="num font-mono font-medium">{v}</dd>
    </div>
  );
}
