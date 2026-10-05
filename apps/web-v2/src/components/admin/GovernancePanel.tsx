"use client";

import { useGovernance } from "@/lib/api";
import { bpsToPct, int } from "@/lib/format";
import type { PendingAction } from "@/lib/schemas";
import { Address } from "../ui/Address";
import { Card, CardHeader } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { EmptyRow, Table, Td, Th, THead } from "../ui/Table";
import { KV, approxDuration, slotsToMs } from "./controls";

export function GovernancePanel() {
  const { data, isLoading, error } = useGovernance();
  const timelockSlots = data ? Number(data.timelockSlots) : 0;
  const addr = (v: string | null | undefined, kind: "account" | "tx" = "account") => (v ? <Address value={v} kind={kind} full /> : <span className="font-mono text-xs text-dim">—</span>);
  const loading = isLoading && !data;
  const sk = <Skeleton className="h-3.5 w-64" />;

  return (
    <Card>
      <CardHeader eyebrow="On-chain" title="Governance" right={data && <span className="font-mono text-[11px] tabular-nums text-dim">slot {int(Number(data.currentSlot))}</span>} />
      {error && <div className="px-5 py-3 text-xs text-neg">{(error as Error).message}</div>}
      <dl className="divide-y divide-line">
        <KV
          k="Timelock"
          v={
            loading ? sk : data ? (
              <span className="font-mono tabular-nums">
                {int(timelockSlots)} slots <span className="text-muted">≈ {timelockSlots === 0 ? "none" : approxDuration(slotsToMs(timelockSlots))}</span>
              </span>
            ) : (
              "—"
            )
          }
          note={data && timelockSlots === 0 ? "Timelock is 0: queued actions are executable at once. Expected on localnet only." : "Every authority action except set_paused waits this long between queue and execute."}
        />
        <KV k="Fund authority" v={loading ? sk : addr(data?.fundAuthority)} note={data?.pendingAuthority ? <>Transfer pending to <Address value={data.pendingAuthority} /></> : undefined} />
        <KV k="Rebalancer" v={loading ? sk : addr(data?.rebalancer)} />
        <KV k="Fee recipient" v={loading ? sk : addr(data?.feeRecipient)} />
        <KV
          k="Max auction discount"
          v={
            loading ? sk : data ? (
              <span className="font-mono tabular-nums">
                {bpsToPct(data.maxAuctionDiscountBps, 2)} <span className="text-muted">({data.maxAuctionDiscountBps} bps)</span>
              </span>
            ) : (
              "—"
            )
          }
        />
        {data?.maxRefMoveBps != null && (
          <KV
            k="Ref-price move policy"
            v={
              <span className="font-mono tabular-nums">
                {bpsToPct(data.maxRefMoveBps, 2)} per {int(Number(data.refMovePeriodSlots ?? 0))} slots <span className="text-muted">≈ {approxDuration(slotsToMs(data.refMovePeriodSlots ?? 0))}</span>
              </span>
            }
          />
        )}
        <KV
          k="Upgrade authority"
          v={
            loading ? sk : data ? (
              data.upgradeAuthority ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-amber">held</span>
                  {addr(data.upgradeAuthority)}
                </span>
              ) : (
                <span className="font-mono text-xs text-accent">burned · program is immutable</span>
              )
            ) : (
              "—"
            )
          }
          note={data?.programDataAddress ? <>ProgramData <Address value={data.programDataAddress} /></> : undefined}
        />
        {data?.reconstitutionMode && <KV k="Reconstitution mode" v={<span className="font-mono text-xs">{data.reconstitutionMode}</span>} />}
      </dl>
      <div className="border-t border-line">
        <div className="flex flex-col gap-1 px-5 pb-2 pt-4 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="micro text-muted">Pending actions{data ? ` · ${data.pending.length}` : ""}</div>
          <div className="text-[11px] text-dim">Execution is permissionless: anyone may call execute_action once the ETA slot passes.</div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <tr>
                <Th>Kind</Th>
                <Th>Payload</Th>
                <Th align="right">ETA slot</Th>
                <Th align="right">Remaining</Th>
                <Th>Proposer</Th>
                <Th>Queued</Th>
              </tr>
            </THead>
            <tbody className="[&_tr]:border-b [&_tr]:border-line [&_tr:last-child]:border-0">
              {loading && (
                <tr>
                  <Td colSpan={6}>
                    <Skeleton className="h-3.5 w-80" />
                  </Td>
                </tr>
              )}
              {data && data.pending.length === 0 && <EmptyRow colSpan={6}>No actions queued.</EmptyRow>}
              {data?.pending.map((p) => <PendingRow key={p.pda} p={p} currentSlot={Number(data.currentSlot)} />)}
            </tbody>
          </Table>
        </div>
      </div>
    </Card>
  );
}

function PendingRow({ p, currentSlot }: { p: PendingAction; currentSlot: number }) {
  const eta = Number(p.etaSlot);
  const remainingSlots = eta - currentSlot;
  const due = p.due ?? remainingSlots <= 0;
  return (
    <tr>
      <Td>
        <div className="font-mono text-xs">{p.kindName}</div>
        <div className="text-[11px] text-dim">
          <Address value={p.pda} copy={false} /> · nonce {p.nonce}
        </div>
      </Td>
      <Td className="whitespace-normal">
        <PayloadSummary payload={p.payload} />
      </Td>
      <Td align="right" mono>
        {int(eta)}
      </Td>
      <Td align="right" mono>
        {due ? (
          <span className="text-accent">due</span>
        ) : (
          <span>
            {int(remainingSlots)} <span className="text-muted">≈ {approxDuration(slotsToMs(remainingSlots))}</span>
          </span>
        )}
      </Td>
      <Td>
        <Address value={p.proposer} />
      </Td>
      <Td>{p.queuedSig ? <Address value={p.queuedSig} kind="tx" /> : <span className="font-mono text-xs text-dim">slot {int(Number(p.queuedSlot))}</span>}</Td>
    </tr>
  );
}

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Flat `k=v` rendering of a describePayload() record; base58 values become links. */
export function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  if (entries.length === 0) return <span className="font-mono text-xs text-dim">—</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs">
      {entries.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
          <span className="text-muted">{k}=</span>
          {typeof v === "string" && ADDRESS_RE.test(v) ? <Address value={v} kind={k === "mint" ? "token" : "account"} copy={false} /> : <span className="text-ink">{Array.isArray(v) ? v.join(",") : String(v)}</span>}
        </span>
      ))}
    </div>
  );
}
