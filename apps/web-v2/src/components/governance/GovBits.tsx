"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";
import { SPRING, useInViewOnce } from "@/lib/motion";
import { bpsToPct, compact, dateTime } from "@/lib/format";
import type { GovKind, GovProposal, GovStatus, GovTally } from "@/lib/schemas";
import { cn, truncateMiddle } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Badge } from "../ui/Badge";
import { Countdown } from "../ui/Countdown";

/** Raw $FIX6900 units (6 dp) -> compact UI number. */
export function units(raw: string | number | null | undefined, digits = 2): string {
  if (raw == null) return "—";
  const n = Number(raw) / 1e6;
  if (!Number.isFinite(n)) return "—";
  return compact(n, digits);
}

export const KIND_LABEL: Record<GovKind, string> = { add_asset: "Add constituent", remove_asset: "Remove constituent", set_param: "Parameter" };

const STATUS_TONE: Record<GovStatus, "verified" | "pending" | "down" | "outline"> = { open: "pending", passed: "verified", queued: "verified", executed: "verified", failed: "down", cancelled: "outline" };
const STATUS_TEXT: Record<GovStatus, string> = { open: "Open", passed: "Passed", queued: "Queued on-chain", executed: "Executed", failed: "Failed", cancelled: "Cancelled" };

export function StatusChip({ status, className }: { status: GovStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {status === "executed" || status === "queued" ? "✓ " : ""}
      {STATUS_TEXT[status]}
    </Badge>
  );
}

/** For / against / abstain as one stacked bar of the participating weight; grows on first view. */
export function TallyBar({ t, compactLabels }: { t: GovTally; compactLabels?: boolean }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const spring = SPRING;
  const part = Number(t.participation);
  const seg = (bps: number) => (part > 0 ? Math.max(0, Math.min(100, bps / 100)) : 0);
  return (
    <div ref={ref} className="gov-tally" aria-label={`For ${bpsToPct(t.forBps, 1)}, against ${bpsToPct(t.againstBps, 1)}, abstain ${bpsToPct(t.abstainBps, 1)} of votes cast`}>
      <div className="gov-bar" role="img" aria-hidden>
        {part === 0 ? (
          <span className="gov-bar-empty" />
        ) : (
          <>
            <motion.span className="gov-bar-for" initial={{ width: 0 }} animate={{ width: seen ? `${seg(t.forBps)}%` : 0 }} transition={spring} />
            <motion.span className="gov-bar-abstain" initial={{ width: 0 }} animate={{ width: seen ? `${seg(t.abstainBps)}%` : 0 }} transition={spring} />
            <motion.span className="gov-bar-against" initial={{ width: 0 }} animate={{ width: seen ? `${seg(t.againstBps)}%` : 0 }} transition={spring} />
          </>
        )}
      </div>
      <div className="gov-legend m">
        <span>
          <i className="gov-sw gov-sw-for" aria-hidden /> For {bpsToPct(t.forBps, 1)}
          {!compactLabels && <span className="faint"> · {units(t.for)}</span>}
        </span>
        <span>
          <i className="gov-sw gov-sw-against" aria-hidden /> Against {bpsToPct(t.againstBps, 1)}
          {!compactLabels && <span className="faint"> · {units(t.against)}</span>}
        </span>
        <span>
          <i className="gov-sw gov-sw-abstain" aria-hidden /> Abstain {bpsToPct(t.abstainBps, 1)}
          {!compactLabels && <span className="faint"> · {units(t.abstain)}</span>}
        </span>
      </div>
    </div>
  );
}

/** Participation against the quorum: a ruled meter with an ink tick at the quorum. */
export function QuorumMeter({ t, quorumBps, supply }: { t: GovTally; quorumBps: number; supply: string }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const spring = SPRING;
  const partPct = Math.min(100, t.participationBps / 100);
  // Scale: the quorum sits at 50% of the track so progress toward it is legible; past it the track continues to 2x quorum.
  const scaleMax = Math.max(quorumBps * 2, 1);
  const fill = Math.min(100, (t.participationBps / scaleMax) * 100);
  const tick = Math.min(100, (quorumBps / scaleMax) * 100);
  return (
    <div ref={ref} className="gov-quorum" aria-label={`Participation ${bpsToPct(t.participationBps, 2)} of snapshot supply; quorum ${bpsToPct(quorumBps, 2)}`}>
      <div className="gov-meter" role="img" aria-hidden>
        <motion.span className={cn("gov-meter-fill", t.quorumReached && "is-met")} initial={{ width: 0 }} animate={{ width: seen ? `${fill}%` : 0 }} transition={spring} />
        <span className="gov-meter-tick" style={{ left: `${tick}%` }} />
      </div>
      <div className="gov-legend m">
        <span>
          Quorum {t.quorumReached ? "reached" : "not yet"} · {partPct.toFixed(2)}% of {units(supply)} voted
        </span>
        <span className="faint">
          need {bpsToPct(quorumBps, 2)} = {units(t.quorumUnits)} units
        </span>
      </div>
    </div>
  );
}

export function PayloadSummary({ p }: { p: GovProposal }) {
  if (p.kind === "set_param") {
    return (
      <span className="m">
        {String(p.payload.key)} <span className="muted">=</span> {String(p.payload.value)}
      </span>
    );
  }
  const mint = String(p.payload.mint ?? "");
  const sym = typeof p.payload.symbol === "string" && p.payload.symbol ? p.payload.symbol : truncateMiddle(mint);
  return (
    <span className="m">
      {p.kind === "add_asset" ? "Add" : "Remove"} <b>{sym}</b> · <Address value={mint} kind="token" copy={false} />
      {p.payload.weightBps != null ? <span className="muted"> · {String(p.payload.weightBps)} bps</span> : null}
      {p.payload.allowTransferFee === true ? <span className="muted"> · transfer-fee override</span> : null}
    </span>
  );
}

/** One list row: title, chips, summary, bars, meta. */
export function ProposalRow({ p }: { p: GovProposal }) {
  return (
    <article className="gov-row">
      <div className="gov-row-head">
        <div className="min-w-0">
          <div className="gov-row-kicker micro muted">
            #{p.id} · {KIND_LABEL[p.kind]}
          </div>
          <h3 className="h3 gov-row-title">
            <Link href={`/governance/${p.id}`} className="lnk-plain">
              {p.title}
            </Link>
          </h3>
          <div className="gov-row-sum">
            <PayloadSummary p={p} />
          </div>
        </div>
        <StatusChip status={p.status} />
      </div>
      <div className="gov-row-bars">
        <TallyBar t={p.tally} compactLabels />
        <QuorumMeter t={p.tally} quorumBps={p.quorumBps} supply={p.snapshotSupply} />
      </div>
      <dl className="gov-row-meta m">
        <div>
          <dt className="micro muted">{p.status === "open" ? "Time left" : "Closed"}</dt>
          <dd>{p.status === "open" ? <Countdown to={p.endTs} /> : dateTime(p.endTs)}</dd>
        </div>
        <div>
          <dt className="micro muted">Snapshot slot</dt>
          <dd>{Number(p.snapshotSlot).toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="micro muted">Voters</dt>
          <dd>{p.tally.voters.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="micro muted">Proposer</dt>
          <dd>{p.proposer === "admin" ? "index committee" : <Address value={p.proposer} copy={false} />}</dd>
        </div>
      </dl>
    </article>
  );
}

export function SidePanel({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className="sidepanel">
      <div className="micro muted">{label}</div>
      {children}
    </section>
  );
}
