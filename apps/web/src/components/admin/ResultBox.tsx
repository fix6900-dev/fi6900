"use client";

import type { AdminError } from "@/lib/api";
import type { AdminProposalResult } from "@/lib/schemas";
import { dateTime } from "@/lib/format";
import { Address } from "../ui/Address";
import { Warn } from "./controls";

/** Outcome of an admin mutation: the proposal's new state, and anything that was queued on-chain. */
export function ResultBox({ result, error, title }: { result?: AdminProposalResult | null; error?: AdminError | null; title?: string }) {
  if (error) {
    return (
      <Warn>
        {title && <span className="mr-2 text-[11px] uppercase tracking-wide opacity-80">{title}</span>}
        {error.status ? <span className="font-mono">{error.status} </span> : null}
        {error.message}
      </Warn>
    );
  }
  if (!result) return null;
  const p = result.proposal;
  const q = result.queued;
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2 text-xs hairline">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {title && <span className="eyebrow">{title}</span>}
        <span className="font-mono">
          {p.symbol ?? "—"} <span className="text-muted">{p.action}</span> → <span className={p.status === "rejected" ? "text-neg" : "text-accent"}>{p.status}</span>
        </span>
        <Address value={p.mint} kind="token" copy={false} />
        {p.weightBps != null && <span className="font-mono text-muted">weight {p.weightBps} bps</span>}
        {p.decidedTs && <span className="font-mono text-dim">{dateTime(p.decidedTs)}</span>}
        {p.note && <span className="text-muted">&ldquo;{p.note}&rdquo;</span>}
      </div>
      {(p.actionPda || p.queuedSig) && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono">
          {p.actionPda && (
            <span>
              <span className="text-muted">action </span>
              <Address value={p.actionPda} />
            </span>
          )}
          {p.queuedSig && (
            <span>
              <span className="text-muted">sig </span>
              <Address value={p.queuedSig} kind="tx" />
            </span>
          )}
        </div>
      )}
      {q && (
        <div className="mt-1.5 flex flex-col gap-0.5 font-mono">
          {q.queued.map((x) => (
            <div key={x.pda} className="flex flex-wrap gap-x-3">
              <span className="text-accent">queued {x.action}</span>
              <Address value={x.mint} kind="token" copy={false} />
              <span>
                <span className="text-muted">pda </span>
                <Address value={x.pda} copy={false} />
              </span>
              <span>
                <span className="text-muted">sig </span>
                <Address value={x.sig} kind="tx" copy={false} />
              </span>
            </div>
          ))}
          {q.weightActions.map((x) => (
            <div key={x.pda} className="flex flex-wrap gap-x-3">
              <span className="text-muted">set_target_weight</span>
              <Address value={x.mint} kind="token" copy={false} />
              <span>{x.targetWeightBps} bps</span>
              <span>
                <span className="text-muted">pda </span>
                <Address value={x.pda} copy={false} />
              </span>
            </div>
          ))}
          {q.skipped.length > 0 && <div className="text-amber">skipped: {q.skipped.join(", ")}</div>}
          {q.queued.length === 0 && q.weightActions.length === 0 && <div className="text-dim">nothing queued</div>}
        </div>
      )}
      {!q && p.status === "approved" && <div className="mt-1 text-dim">Approved. It will be announced and queued at the next reconstitution window.</div>}
    </div>
  );
}
