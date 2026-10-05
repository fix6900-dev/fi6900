"use client";

import Link from "next/link";
import { useState } from "react";
import { useGovCancel, useGovProposals } from "@/lib/gov";
import { bpsToPct, dateTime, relTime } from "@/lib/format";
import type { GovProposal } from "@/lib/schemas";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { SkeletonRows } from "../ui/Skeleton";
import { EmptyRow, Table, Td, Th, THead } from "../ui/Table";
import { KIND_LABEL, StatusChip, units } from "../governance/GovBits";
import { TextInput, Warn } from "./controls";

/** Holder-governance proposals with a per-row cancel (open or passed only). Reads are public; cancel needs ADMIN_TOKEN. */
export function GovProposalsPanel({ getToken, canMutate }: { getToken: () => string | null; canMutate: boolean }) {
  const { data, isLoading, error, dataUpdatedAt } = useGovProposals();
  const cancel = useGovCancel(getToken);
  const [confirm, setConfirm] = useState<{ id: number; note: string } | null>(null);

  return (
    <Card>
      <CardHeader
        eyebrow="Holder governance"
        title="Token-holder proposals"
        right={
          <span className="font-mono text-[11px] tabular-nums text-dim">
            {data ? `${data.length} total · ${dataUpdatedAt ? relTime(dataUpdatedAt) : ""}` : ""} ·{" "}
            <Link href="/governance" className="lnk">
              public page
            </Link>
          </span>
        }
      />
      {error && <div className="px-5 py-3 text-xs text-neg">{(error as Error).message}</div>}
      {cancel.error && (
        <div className="px-5 pt-3">
          <Warn>{cancel.error.message}</Warn>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>Proposal</Th>
              <Th>Status</Th>
              <Th align="right">For / Against</Th>
              <Th align="right">Quorum</Th>
              <Th align="right">Ends</Th>
              <Th>On-chain</Th>
              <Th align="right">Cancel</Th>
            </tr>
          </THead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">
            {isLoading && !data && <SkeletonRows rows={2} cols={7} />}
            {data && data.length === 0 && <EmptyRow colSpan={7}>No holder proposals yet.</EmptyRow>}
            {data?.map((p) => (
              <Row
                key={p.id}
                p={p}
                canMutate={canMutate}
                confirming={confirm?.id === p.id ? confirm : null}
                onConfirm={(c) => setConfirm(c)}
                onCancel={(note) => cancel.mutate({ id: p.id, note }, { onSuccess: () => setConfirm(null) })}
                busy={cancel.isPending}
              />
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}

function Row({ p, canMutate, confirming, onConfirm, onCancel, busy }: { p: GovProposal; canMutate: boolean; confirming: { id: number; note: string } | null; onConfirm: (c: { id: number; note: string } | null) => void; onCancel: (note?: string) => void; busy: boolean }) {
  const cancellable = p.status === "open" || p.status === "passed";
  return (
    <tr className="gov-admin-row">
      <Td className="whitespace-normal">
        <Link href={`/governance/${p.id}`} className="lnk">
          #{p.id} {p.title}
        </Link>
        <div className="text-[11px] text-dim">
          {KIND_LABEL[p.kind]} · {p.summary} · by {p.proposer === "admin" ? "committee" : <Address value={p.proposer} copy={false} />}
        </div>
      </Td>
      <Td>
        <StatusChip status={p.status} />
      </Td>
      <Td align="right" mono>
        {bpsToPct(p.tally.forBps, 1)} / {bpsToPct(p.tally.againstBps, 1)}
        <div className="text-[11px] text-dim">{p.tally.voters} voters</div>
      </Td>
      <Td align="right" mono>
        {bpsToPct(p.tally.participationBps, 2)}
        <div className="text-[11px] text-dim">
          {p.tally.quorumReached ? "met" : "need"} {bpsToPct(p.quorumBps, 2)} · {units(p.snapshotSupply)} supply
        </div>
      </Td>
      <Td align="right" mono className="text-muted">
        {dateTime(p.endTs)}
      </Td>
      <Td>{p.queuedActionPda ? <Address value={p.queuedActionPda} /> : p.queuedSig ? <Address value={p.queuedSig} kind="tx" /> : <span className="font-mono text-xs text-dim">—</span>}</Td>
      <Td align="right">
        {!cancellable ? (
          <span className="font-mono text-xs text-dim">—</span>
        ) : confirming ? (
          <div className="flex flex-col items-end gap-2">
            <TextInput value={confirming.note} onChange={(e) => onConfirm({ id: p.id, note: e.target.value })} placeholder="note (optional)" mono={false} className="w-44" />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" disabled={!canMutate || busy} onClick={() => onCancel(confirming.note || undefined)}>
                {busy ? "Cancelling…" : "Confirm cancel"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onConfirm(null)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" disabled={!canMutate} onClick={() => onConfirm({ id: p.id, note: "" })} title={canMutate ? "Cancel this proposal" : "Enter the admin token to cancel"}>
            Cancel
          </Button>
        )}
      </Td>
    </tr>
  );
}
