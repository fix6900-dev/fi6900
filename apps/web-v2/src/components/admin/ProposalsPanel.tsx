"use client";

import { useMemo, useState } from "react";
import { useProposals, type useAdminMutations } from "@/lib/api";
import { dateTime, relTime } from "@/lib/format";
import type { Proposal, ProposalStatus } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { SkeletonRows } from "../ui/Skeleton";
import { EmptyRow, Table, Td, Th, THead } from "../ui/Table";
import { Field, TextInput, Toggle, Warn } from "./controls";
import { MetricReasons } from "./MetricReasons";
import type { LogEntry } from "./ResultLog";

type Mutations = ReturnType<typeof useAdminMutations>;
const ORDER: ProposalStatus[] = ["proposed", "approved", "queued", "executed", "rejected"];

export function ProposalsPanel({ m, canMutate, onLog }: { m: Mutations; canMutate: boolean; onLog: (e: LogEntry) => void }) {
  const { data, isLoading, error, dataUpdatedAt } = useProposals();
  const groups = useMemo(() => {
    const g = new Map<ProposalStatus, Proposal[]>(ORDER.map((s) => [s, []]));
    for (const p of data ?? []) g.get(p.status)?.push(p);
    return g;
  }, [data]);
  const [open, setOpen] = useState<{ mint: string; mode: "approve" | "reject" } | null>(null);
  const proposed = groups.get("proposed") ?? [];

  return (
    <Card>
      <CardHeader
        eyebrow="Index committee"
        title="Proposals"
        right={<span className="font-mono text-[11px] tabular-nums text-dim">{data ? `${data.length} total · ${dataUpdatedAt ? relTime(dataUpdatedAt) : ""}` : ""}</span>}
      />
      {error && <div className="px-5 py-3 text-xs text-neg">{(error as Error).message}</div>}

      {/* Proposed: actionable */}
      <div className="px-5 pb-2 pt-4">
        <div className="micro text-muted">Proposed · {proposed.length}</div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>Asset</Th>
              <Th>Action</Th>
              <Th>Reasons</Th>
              <Th align="right">Weight</Th>
              <Th align="right">Proposed</Th>
              <Th align="right">Decide</Th>
            </tr>
          </THead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">
            {isLoading && !data && <SkeletonRows rows={2} cols={6} />}
            {data && proposed.length === 0 && <EmptyRow colSpan={6}>Nothing awaiting a decision. The daily methodology run files add/remove proposals here.</EmptyRow>}
            {proposed.map((p) => {
              const isOpen = open?.mint === p.mint;
              return (
                <ProposedRow
                  key={p.id}
                  p={p}
                  m={m}
                  canMutate={canMutate}
                  mode={isOpen ? open!.mode : null}
                  onMode={(mode) => setOpen(mode ? { mint: p.mint, mode } : null)}
                  onLog={(e) => {
                    onLog(e);
                    if (!e.error) setOpen(null);
                  }}
                />
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Decided / queued / executed: read-only */}
      {ORDER.filter((s) => s !== "proposed").map((s) => {
        const rows = groups.get(s) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={s} className="border-t border-line">
            <div className="px-5 pb-2 pt-4">
              <div className="micro text-muted">
                {s} · {rows.length}
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Asset</Th>
                    <Th>Action</Th>
                    <Th>Reasons</Th>
                    <Th align="right">Weight</Th>
                    <Th align="right">{s === "rejected" ? "Rejected" : s === "approved" ? "Approved" : s === "queued" ? "Queued" : "Executed"}</Th>
                    <Th>{s === "rejected" ? "Note" : "On-chain"}</Th>
                  </tr>
                </THead>
                <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <AssetCell p={p} />
                      <Td>
                        <ActionText action={p.action} />
                      </Td>
                      <Td className="whitespace-normal">
                        <MetricReasons reason={p.reason} />
                      </Td>
                      <Td align="right" mono>
                        {p.weightBps != null ? `${p.weightBps} bps` : "—"}
                      </Td>
                      <Td align="right" mono className="text-muted">
                        {dateTime((s === "executed" && p.executedTs) || (s === "queued" && p.queuedTs) || p.decidedTs || p.proposedTs)}
                      </Td>
                      <Td className="whitespace-normal">
                        {s === "rejected" ? (
                          <span className="text-xs text-muted">{p.note ?? "—"}</span>
                        ) : (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs">
                            {p.actionPda && (
                              <span>
                                <span className="text-muted">action </span>
                                <Address value={p.actionPda} copy={false} />
                              </span>
                            )}
                            {p.queuedSig && (
                              <span>
                                <span className="text-muted">sig </span>
                                <Address value={p.queuedSig} kind="tx" copy={false} />
                              </span>
                            )}
                            {!p.actionPda && !p.queuedSig && <span className="text-dim">{s === "approved" ? "awaiting window" : "—"}</span>}
                            {p.note && <span className="text-muted">{p.note}</span>}
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function AssetCell({ p }: { p: Proposal }) {
  return (
    <Td>
      <div className="text-[13px] font-medium">{p.symbol ?? <span className="text-dim">unknown</span>}</div>
      <div className="text-[11px]">
        <Address value={p.mint} kind="token" />
      </div>
    </Td>
  );
}

function ActionText({ action }: { action: "add" | "remove" }) {
  return <span className={cn("font-mono text-xs", action === "add" ? "text-accent" : "text-neg")}>{action}</span>;
}

function ProposedRow({
  p,
  m,
  canMutate,
  mode,
  onMode,
  onLog,
}: {
  p: Proposal;
  m: Mutations;
  canMutate: boolean;
  mode: "approve" | "reject" | null;
  onMode: (mode: "approve" | "reject" | null) => void;
  onLog: (e: LogEntry) => void;
}) {
  const [weight, setWeight] = useState<string>(p.weightBps != null ? String(p.weightBps) : "");
  const [immediate, setImmediate] = useState(false);
  const [note, setNote] = useState("");
  const busy = (m.approve.isPending && m.approve.variables?.mint === p.mint) || (m.reject.isPending && m.reject.variables?.mint === p.mint);
  const weightNum = weight.trim() === "" ? undefined : Number(weight);
  const weightBad = weightNum !== undefined && (!Number.isInteger(weightNum) || weightNum < 0 || weightNum > 10_000);
  const label = `${p.symbol ?? p.mint.slice(0, 6)} ${p.action}`;

  const doApprove = () =>
    m.approve.mutate(
      { mint: p.mint, weightBps: p.action === "add" ? weightNum : undefined, immediate },
      {
        onSuccess: (result) => onLog({ ts: Date.now(), title: `approve ${label}${immediate ? " (immediate)" : ""}`, result }),
        onError: (error) => onLog({ ts: Date.now(), title: `approve ${label}${immediate ? " (immediate)" : ""}`, error }),
      },
    );
  const doReject = () =>
    m.reject.mutate(
      { mint: p.mint, note: note.trim() || undefined },
      {
        onSuccess: (result) => onLog({ ts: Date.now(), title: `reject ${label}`, result }),
        onError: (error) => onLog({ ts: Date.now(), title: `reject ${label}`, error }),
      },
    );

  return (
    <>
      <tr className={cn(mode && "bg-panel-2/40")}>
        <AssetCell p={p} />
        <Td>
          <ActionText action={p.action} />
        </Td>
        <Td className="whitespace-normal">
          <MetricReasons reason={p.reason} />
        </Td>
        <Td align="right" mono>
          {p.weightBps != null ? `${p.weightBps} bps` : "—"}
        </Td>
        <Td align="right" mono className="text-muted">
          <span title={dateTime(p.proposedTs)}>{relTime(p.proposedTs)}</span>
        </Td>
        <Td align="right">
          <div className="inline-flex gap-1.5">
            <Button size="sm" variant={mode === "approve" ? "primary" : "secondary"} disabled={!canMutate || busy} onClick={() => onMode(mode === "approve" ? null : "approve")}>
              Approve
            </Button>
            <Button size="sm" variant={mode === "reject" ? "danger" : "ghost"} disabled={!canMutate || busy} onClick={() => onMode(mode === "reject" ? null : "reject")}>
              Reject
            </Button>
          </div>
        </Td>
      </tr>
      {mode && (
        <tr className="bg-panel-2/40">
          <td colSpan={6} className="px-3 pb-4 pt-1">
            {mode === "approve" ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!weightBad) doApprove();
                }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  {p.action === "add" && (
                    <Field label="Weight bps (optional)" hint="Blank = methodology weight (equal weight recomputes 1/N on queue)." className="sm:w-56">
                      <TextInput inputMode="numeric" placeholder={p.weightBps != null ? String(p.weightBps) : "e.g. 250"} value={weight} onChange={(e) => setWeight(e.target.value)} aria-invalid={weightBad} />
                    </Field>
                  )}
                  <Toggle checked={immediate} onChange={setImmediate} label="Queue immediately" tone="neg" />
                  <div className="flex gap-2 sm:ml-auto">
                    <Button type="submit" size="sm" variant={immediate ? "danger" : "primary"} disabled={busy || weightBad}>
                      {busy ? "Sending…" : immediate ? "Approve + queue now" : "Approve"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onMode(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
                {weightBad && <div className="text-xs text-neg">Weight must be an integer between 0 and 10000.</div>}
                {immediate && (
                  <Warn>
                    Immediate bypasses the 48 h public announcement: the add/remove and the re-weighting actions are queued on-chain right now and only the program timelock stands between queue and execute. Use for emergencies (confirmed exploit / rug) only.
                  </Warn>
                )}
              </form>
            ) : (
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  doReject();
                }}
              >
                <Field label="Note (optional)" hint="Stored with the proposal. The same proposal is suppressed for the reject cooldown." className="flex-1">
                  <TextInput mono={false} placeholder="why" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="danger" disabled={busy}>
                    {busy ? "Sending…" : "Reject"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onMode(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
