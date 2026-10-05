"use client";

import { ArrowUpRight } from "lucide-react";
import { useVerify } from "@/lib/api";
import { solscanAccount } from "@/lib/solscan";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";

export function VerifyStrip() {
  const { data } = useVerify();
  const vaults = data?.vaults ?? [];
  const match = data ? data.mintAuthority === data.fundPda : null;
  const ownersOk = data ? vaults.every((v) => v.owner === data.fundPda) : null;

  const rows: { k: string; v: React.ReactNode }[] = [
    { k: "Mint authority", v: data ? <Address value={data.mintAuthority} head={6} tail={6} /> : "—" },
    { k: "Fund PDA", v: data ? <Address value={data.fundPda} head={6} tail={6} /> : "—" },
    { k: "Authority = PDA", v: match == null ? "—" : match ? "match" : <span className="text-neg">mismatch</span> },
    { k: "Vault accounts", v: data ? `${vaults.length} · ${ownersOk ? "all owned by PDA" : "owner mismatch"}` : "—" },
  ];

  return (
    <section className="border-t border-line bg-surface/40">
      <div className="wrap section">
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <div className="eyebrow mb-3">Transparency</div>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">Don&apos;t trust it. Verify it.</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              The index mint&apos;s authority is the fund program PDA, so nobody can print units without delivering the basket. Every constituent sits in a PDA-owned token account you can read with the Solana CLI.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button href="/verify" variant="primary">
                Verify every vault <ArrowUpRight size={14} />
              </Button>
              {data && <Button href={solscanAccount(data.fundPda)}>Fund PDA on Solscan</Button>}
            </div>
          </div>
          <dl className="divide-y divide-line rounded-lg bg-surface hairline">
            {rows.map((r) => (
              <div key={r.k} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                <dt className="text-muted">{r.k}</dt>
                <dd className="num font-mono">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
