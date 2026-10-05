"use client";

import { useVerify } from "@/lib/api";
import { env } from "@/lib/env";
import Link from "next/link";
import { Address } from "./ui/Address";
import { Wordmark } from "./TopBar";

const COLS = [
  {
    title: "Product",
    links: [
      { href: "/buy", label: "Buy $FI6900" },
      { href: "/create", label: "Create / Redeem" },
      { href: "/auctions", label: "Auctions" },
      { href: "/flywheel", label: "Flywheel" },
    ],
  },
  {
    title: "Transparency",
    links: [
      { href: "/verify", label: "Verify holdings" },
      { href: "/methodology", label: "Methodology" },
    ],
  },
];

export function Footer() {
  const { data } = useVerify();
  const programId = env.programId || data?.programId;
  return (
    <footer className="border-t border-line">
      <div className="wrap py-10 sm:py-12">
        <div className="grid gap-8 sm:grid-cols-[1.6fr_1fr_1fr]">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-4 text-sm leading-relaxed text-muted">An on-chain, equal-weight index of the 40 largest Solana memecoins. Every unit is redeemable in-kind for its slice of the vault.</p>
            <dl className="mt-5 space-y-1.5 text-xs">
              <div className="flex items-center gap-3">
                <dt className="w-20 text-muted">Program</dt>
                <dd>{programId ? <Address value={programId} head={6} tail={6} /> : <span className="font-mono text-dim">—</span>}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 text-muted">Index mint</dt>
                <dd>{data?.indexMint ? <Address value={data.indexMint} kind="token" head={6} tail={6} /> : <span className="font-mono text-dim">—</span>}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 text-muted">Cluster</dt>
                <dd className="font-mono">{env.cluster}</dd>
              </div>
            </dl>
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <div className="eyebrow mb-3">{c.title}</div>
              <ul className="space-y-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-muted hover:text-text">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-5 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <span>Experimental software. Memecoins are extremely volatile. Nothing here is investment advice.</span>
          <span className="font-mono">v0.1 · {new Date().getUTCFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
