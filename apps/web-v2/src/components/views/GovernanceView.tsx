"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useGovernance } from "@/lib/api";
import { useGovEligibility, useGovProposals, useWalletAddress } from "@/lib/gov";
import { bpsToPct, dateTime } from "@/lib/format";
import type { GovStatus } from "@/lib/schemas";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { Notes } from "../ui/Fn";
import { Skeleton } from "../ui/Skeleton";
import { Tabs } from "../ui/Tabs";
import { ProposalRow, SidePanel, units } from "../governance/GovBits";

type Filter = "all" | "open" | "closed";

export function GovernanceView() {
  const wallet = useWalletAddress();
  const { data, isLoading, error } = useGovProposals(undefined, wallet);
  const { data: gov } = useGovernance();
  const { data: elig } = useGovEligibility(wallet);
  const [filter, setFilter] = useState<Filter>("all");
  const summary = gov?.governance;

  const list = useMemo(() => {
    const rows = data ?? [];
    if (filter === "open") return rows.filter((p) => p.status === "open");
    if (filter === "closed") return rows.filter((p) => p.status !== "open");
    return rows;
  }, [data, filter]);
  const counts = summary?.counts;
  const closedCount = counts ? counts.passed + counts.failed + counts.queued + counts.executed + counts.cancelled : 0;
  const tabs: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "open", label: `Open${counts ? ` · ${counts.open}` : ""}` },
    { value: "closed", label: `Closed${counts ? ` · ${closedCount}` : ""}` },
  ];

  return (
    <div className="page pagebody">
      <PageHeader
        eyebrow="Holder governance · v1"
        title="Governance"
        desc="$FIX6900 holders vote on what the index holds and on a short list of keeper parameters. A vote is a signed message, not a transaction: it costs nothing. Weight is the wallet's balance at the proposal's snapshot slot. A passed proposal is binding: the keeper queues it through the on-chain timelock or applies the parameter."
        right={
          <Button variant="primary" href="/governance/new">
            New proposal
          </Button>
        }
      />

      <div className="split split-gov">
        <section className="split-main" aria-label="Proposals">
          <div className="panel-h">
            <Tabs value={filter} onChange={setFilter} items={tabs} size="sm" id="gov-filter" label="Filter proposals" />
            <span className="faint m">{data ? `${data.length} proposal${data.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          {error && <p className="field-err">{(error as Error).message}</p>}
          {isLoading && !data && (
            <div className="gov-row">
              <Skeleton className="w-28" />
            </div>
          )}
          {data && list.length === 0 && <p className="empty-note">{filter === "open" ? "No open proposals. Any holder above the proposal threshold can open one." : "No proposals yet."}</p>}
          <div className="gov-list">
            {list.map((p) => (
              <ProposalRow key={p.id} p={p} />
            ))}
          </div>
          <Notes
            notes={[
              { label: "Tallies are read from the keeper's vote ledger; every vote is an ed25519 signature the keeper verified", source: "keeper governance ledger" },
              { label: "Snapshot supply is circulating supply: total minus pools, PDAs, program accounts, the burn address and the denylist", source: "holder snapshot at the proposal's slot" },
            ]}
          />
        </section>

        <aside className="split-side stack" aria-label="Governance parameters">
          <SidePanel label="Your eligibility">
            {!wallet ? (
              <div className="faint">Connect a wallet to see your voting weight and whether you can propose.</div>
            ) : elig ? (
              <>
                <div className="side-v m">{units(elig.balance)} $FIX6900</div>
                <div className="faint">
                  {elig.eligible ? "Above" : "Below"} the proposal threshold of {units(elig.thresholdUnits)} ({bpsToPct(summary?.params.proposalThresholdBps ?? 50, 2)} of {units(elig.circulatingSupply)} circulating).
                  {elig.openProposals > 0 ? ` You have ${elig.openProposals} open proposal${elig.openProposals === 1 ? "" : "s"} (max ${elig.maxOpenPerWallet}).` : ""}
                </div>
              </>
            ) : (
              <div className="faint">Checking…</div>
            )}
          </SidePanel>
          <SidePanel label="Rules in force">
            <dl className="kvl">
              <div>
                <dt>Voting window</dt>
                <dd className="m">{summary ? `${summary.params.votingHours} h` : "—"}</dd>
              </div>
              <div>
                <dt>Quorum</dt>
                <dd className="m">{summary ? `${bpsToPct(summary.params.quorumBps, 2)} of circulating` : "—"}</dd>
              </div>
              <div>
                <dt>Passes when</dt>
                <dd className="m">quorum and for &gt; against</dd>
              </div>
              <div>
                <dt>Proposal threshold</dt>
                <dd className="m">{summary ? bpsToPct(summary.params.proposalThresholdBps, 2) : "—"}</dd>
              </div>
              <div>
                <dt>Open per wallet</dt>
                <dd className="m">{summary ? summary.params.maxOpenPerWallet : "—"}</dd>
              </div>
              <div>
                <dt>Binding path</dt>
                <dd className="m">timelock / keeper config</dd>
              </div>
            </dl>
            {summary?.params.devAcceptAnyBalance && <p className="faint">Dev mode: any wallet may vote with 1 unit (GOV_DEV_ACCEPT_ANY_BALANCE).</p>}
          </SidePanel>
          <SidePanel label="Votable parameters">
            <ul className="runlist">
              {(summary?.params.allowedParams ?? []).map((p) => (
                <li key={p.key}>
                  <b className="m">{p.key}</b>
                  <div className="faint">
                    {p.label}. Bounds {p.min.toLocaleString("en-US")}–{p.max.toLocaleString("en-US")} {p.unit}.
                    {summary?.overrides[p.key] != null ? <> In force by vote: <span className="m">{summary.overrides[p.key]}</span>.</> : null}
                  </div>
                </li>
              ))}
              <li>
                <b className="m">add_asset · remove_asset</b>
                <div className="faint">Always votable. Adds must pass the mint checks (exists, authorities revoked, no transfer hook).</div>
              </li>
            </ul>
          </SidePanel>
          <SidePanel label="Last snapshot">
            {summary?.lastSnapshot ? (
              <>
                <div className="side-v m">{units(summary.lastSnapshot.supply)} circulating</div>
                <div className="faint">
                  {summary.lastSnapshot.holders.toLocaleString("en-US")} holders at slot {Number(summary.lastSnapshot.slot).toLocaleString("en-US")} (proposal #{summary.lastSnapshot.proposalId})
                </div>
              </>
            ) : (
              <div className="faint">No snapshot yet.</div>
            )}
          </SidePanel>
          <p className="faint">
            Read the rules in{" "}
            <Link href="/methodology#governance" className="lnk">
              Methodology §9
            </Link>
            . Timelocked actions appear on{" "}
            <Link href="/admin" className="lnk">
              the committee console
            </Link>
            . {gov?.currentSlot ? <span className="m">slot {Number(gov.currentSlot).toLocaleString("en-US")}</span> : null}
            {data && data[0] ? <> · as of {dateTime(Date.now())}</> : null}
          </p>
        </aside>
      </div>
    </div>
  );
}

export const GOV_STATUS_ORDER: GovStatus[] = ["open", "passed", "queued", "executed", "failed", "cancelled"];
