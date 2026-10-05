"use client";

import { Check } from "lucide-react";
import { useMemo } from "react";
import { useHoldings, useVerify } from "@/lib/api";
import { env } from "@/lib/env";
import { tokens, usd } from "@/lib/format";
import { solscanAccount } from "@/lib/solscan";
import { cn } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Badge } from "../ui/Badge";
import { Card, CardHeader, PageHeader, SectionHeader } from "../ui/Card";
import { CopyButton } from "../ui/CopyButton";
import { Skeleton } from "../ui/Skeleton";
import { Table, TableWrap, Td, Th, THead } from "../ui/Table";
import { TokenLogo } from "../ui/TokenLogo";

export function VerifyView() {
  const { data, isLoading } = useVerify();
  const { data: holdings } = useHoldings();
  const byMint = useMemo(() => new Map((holdings ?? []).map((h) => [h.mint, h])), [holdings]);
  const programId = env.programId || data?.programId;
  const match = data ? data.mintAuthority === data.fundPda : null;
  const ownersOk = data ? data.vaults.every((v) => v.owner === data.fundPda) : null;

  const facts: { label: string; value?: string | null; kind?: "account" | "token"; highlight?: boolean; note?: string }[] = [
    { label: "Program id", value: programId, note: "The fi6900 Anchor program. All vault and mint authority derives from it." },
    { label: "Fund PDA", value: data?.fundPda, note: 'seeds = ["fund", index_mint]. Owns every vault token account.' },
    { label: "Index mint", value: data?.indexMint, kind: "token", note: "$FI6900 SPL mint, 6 decimals." },
    { label: "Mint authority", value: data?.mintAuthority, highlight: true, note: "Equals the fund PDA. Only finalize_mint, accrue_management_fee and bootstrap_mint can mint." },
    { label: "Lookup table", value: data?.lookupTable, note: "Address lookup table the SDK uses to batch deposits and withdrawals." },
    {
      label: "Upgrade authority",
      value: data ? (data.upgradeAuthority ?? "burned") : undefined,
      highlight: data ? !data.upgradeAuthority : false,
      note: data?.upgradeAuthority
        ? "This key can replace the program. Until it is burned or held by a timelocked multisig, every guarantee on this page depends on it."
        : "No key can change the program. The rules on this page are final.",
    },
  ];

  return (
    <div className="wrap page">
      <PageHeader
        eyebrow="Verify"
        title="Every number on this site resolves to an account you can read."
        desc="FI6900 has no custodian. The index mint can only be minted by the program, and only against a full basket deposit. Confirm it yourself with the Solana CLI."
      />

      {/* Proof row */}
      <div className={cn("mb-8 grid gap-px overflow-hidden rounded-lg bg-line hairline md:grid-cols-2", !data && "opacity-70")}>
        <ProofCell ok={match} title="Mint authority = Fund PDA" desc="Nobody can print units without delivering the basket." />
        <ProofCell ok={ownersOk} title={`All ${data?.vaults.length ?? "—"} vaults owned by the Fund PDA`} desc="Constituent tokens only move through program instructions." />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-8">
          <Card>
            <CardHeader eyebrow="Identifiers" title="Program and fund accounts" />
            <dl className="divide-y divide-line">
              {facts.map((f) => (
                <div key={f.label} className="grid gap-1 px-5 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-start">
                  <dt className="text-xs text-muted sm:pt-0.5">{f.label}</dt>
                  <dd className="min-w-0">
                    {isLoading && !data ? <Skeleton className="h-4 w-72" /> : f.value === "burned" ? <span className="font-mono text-xs text-accent">burned · program is immutable</span> : f.value ? <Address value={f.value} kind={f.kind ?? "account"} full /> : <span className="font-mono text-xs text-dim">not configured</span>}
                    {f.note && <div className="mt-1 text-xs leading-relaxed text-muted">{f.note}</div>}
                  </dd>
                </div>
              ))}
              <div className="grid gap-1 px-5 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                <dt className="text-xs text-muted sm:pt-0.5">IDL hash</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <span className="break-all font-mono text-xs">{data?.idlHash ?? <span className="text-dim">—</span>}</span>
                  {data?.idlHash && <CopyButton value={data.idlHash} />}
                </dd>
              </div>
            </dl>
          </Card>

          <section>
            <SectionHeader eyebrow="Vaults" title="Constituent vault accounts" desc="Each row is an associated token account owned by the fund PDA. Amount is the raw on-chain balance." />
            <TableWrap maxHeight="760px">
              <Table>
                <THead>
                  <tr>
                    <Th className="pl-4">Asset</Th>
                    <Th>Vault</Th>
                    <Th className="hidden lg:table-cell">Owner</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right" className="hidden pr-4 sm:table-cell">
                      Value
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {!data
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-line">
                          <td className="h-11 px-4">
                            <Skeleton className="h-3 w-20" />
                          </td>
                          <td className="h-11 px-3">
                            <Skeleton className="h-3 w-40" />
                          </td>
                          <td className="hidden h-11 px-3 lg:table-cell">
                            <Skeleton className="h-3 w-40" />
                          </td>
                          <td className="h-11 px-3">
                            <Skeleton className="h-3 w-16" />
                          </td>
                          <td className="hidden h-11 px-4 sm:table-cell">
                            <Skeleton className="h-3 w-16" />
                          </td>
                        </tr>
                      ))
                    : data.vaults.map((v) => {
                        const h = byMint.get(v.mint);
                        const dec = v.decimals ?? h?.decimals ?? 0;
                        const ok = v.owner === data.fundPda;
                        return (
                          <tr key={v.vault} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                            <td className="h-11 pl-4 pr-3">
                              <div className="flex items-center gap-2.5">
                                <TokenLogo symbol={v.symbol ?? h?.symbol ?? "?"} src={h?.logo} size={20} />
                                <span className="text-[13px] font-semibold">{v.symbol ?? h?.symbol ?? "—"}</span>
                                <Address value={v.mint} kind="token" head={4} tail={4} copy={false} className="hidden text-muted md:inline-flex" />
                              </div>
                            </td>
                            <td className="h-11 px-3">
                              <Address value={v.vault} head={6} tail={6} />
                            </td>
                            <td className="hidden h-11 px-3 lg:table-cell">
                              <span className="inline-flex items-center gap-2">
                                <Address value={v.owner} head={6} tail={6} copy={false} className={cn(ok && "text-muted")} />
                                {!ok && <Badge tone="neg">foreign</Badge>}
                              </span>
                            </td>
                            <Td align="right" mono>
                              {dec ? tokens(v.amount, dec, 2) : v.amount}
                            </Td>
                            <Td align="right" mono className="hidden pr-4 text-muted sm:table-cell">
                              {h ? usd(h.valueUsd) : "—"}
                            </Td>
                          </tr>
                        );
                      })}
                </tbody>
              </Table>
            </TableWrap>
          </section>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader eyebrow="Do it yourself" title="Verify with the Solana CLI" />
            <div className="space-y-6 p-5 text-[13px] leading-relaxed text-muted">
              <Step n={1} title="Confirm the mint authority is the fund PDA">
                <Code>{`spl-token display ${data?.indexMint ?? "<INDEX_MINT>"}\n# Mint authority: ${data?.fundPda ?? "<FUND_PDA>"}`}</Code>
                <p>If the mint authority were a wallet, units could be printed without backing. It is a program-derived address, so only the program can sign.</p>
              </Step>
              <Step n={2} title="Derive the PDA and check it matches">
                <Code>{`# seeds = ["fund", index_mint], program = ${programId ? programId.slice(0, 8) + "…" : "<PROGRAM_ID>"}\nnode -e 'const {PublicKey}=require("@solana/web3.js");\nconst [pda]=PublicKey.findProgramAddressSync([Buffer.from("fund"),new PublicKey("${data?.indexMint ?? "<INDEX_MINT>"}").toBuffer()],new PublicKey("${programId ?? "<PROGRAM_ID>"}"));console.log(pda.toBase58())'`}</Code>
              </Step>
              <Step n={3} title="Read a vault balance and its owner">
                <Code>{`spl-token account-info --address ${data?.vaults[0]?.vault ?? "<VAULT>"}\n# Owner: ${data?.fundPda ?? "<FUND_PDA>"}`}</Code>
                <p>Repeat for every vault in the table. The sum of balances × prices is the AUM on the home page.</p>
              </Step>
              <Step n={4} title="Check the program and IDL">
                <Code>{`anchor idl fetch ${programId ?? "<PROGRAM_ID>"} | sha256sum\n# compare to the IDL hash above\nsolana program show ${programId ?? "<PROGRAM_ID>"}`}</Code>
              </Step>
              <Step n={5} title="Watch the fund account live">
                <Code>{`solana account ${data?.fundPda ?? "<FUND_PDA>"} --output json`}</Code>
                <p>Fields: supply, epoch, open_auctions, fee bps and the active bitmap.</p>
              </Step>
              {data && (
                <a href={solscanAccount(data.fundPda)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-text hover:text-accent">
                  Open the fund PDA on Solscan ↗
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProofCell({ ok, title, desc }: { ok: boolean | null; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 bg-surface p-5">
      <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full", ok === null ? "bg-surface-3 text-dim" : ok ? "bg-accent text-bg" : "bg-neg text-bg")}>
        {ok === null ? <span className="h-1.5 w-1.5 rounded-full bg-dim" /> : ok ? <Check size={12} strokeWidth={3} /> : "!"}
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{desc}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-text">
        <span className="font-mono text-xs text-muted">{String(n).padStart(2, "0")}</span>
        <span className="font-semibold">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-bg p-3 pr-10 font-mono text-xs leading-relaxed text-text/90 hairline">
        <code>{children}</code>
      </pre>
      <CopyButton value={children.replace(/^#.*$/gm, "").trim()} className="absolute right-2 top-2" />
    </div>
  );
}
