"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useState } from "react";
import { useDemoMode } from "@/lib/api";
import { useGovProposal, useGovVote, useWalletAddress, voteMessage } from "@/lib/gov";
import { bpsToPct, dateTime, relTime } from "@/lib/format";
import type { GovChoice } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { Countdown } from "../ui/Countdown";
import { Notes } from "../ui/Fn";
import { Skeleton } from "../ui/Skeleton";
import { KIND_LABEL, PayloadSummary, QuorumMeter, SidePanel, StatusChip, TallyBar, units } from "../governance/GovBits";

const CHOICES: { value: GovChoice; label: string }[] = [
  { value: "for", label: "For" },
  { value: "against", label: "Against" },
  { value: "abstain", label: "Abstain" },
];

export function GovProposalView({ id }: { id: string }) {
  const wallet = useWalletAddress();
  const { signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const { demo } = useDemoMode();
  const { data: p, isLoading, error } = useGovProposal(id, wallet);
  const vote = useGovVote(p);
  const [pending, setPending] = useState<GovChoice | null>(null);

  const cast = async (choice: GovChoice) => {
    if (!wallet) return setVisible(true);
    setPending(choice);
    try {
      await vote.mutateAsync(choice);
    } catch {
      /* surfaced below */
    } finally {
      setPending(null);
    }
  };

  if (error && !p) {
    return (
      <div className="page pagebody">
        <PageHeader eyebrow="Holder governance" title={`Proposal #${id}`} desc={(error as Error).message} />
        <p>
          <Link href="/governance" className="lnk">
            ← All proposals
          </Link>
        </p>
      </div>
    );
  }

  const myWeight = p?.myWeight != null ? Number(p.myWeight) : null;
  const canVote = p?.status === "open" && (p.timeLeftSec ?? 0) > 0;
  const weightNote = !wallet ? "Connect a wallet to vote. Weight is the wallet's balance at the snapshot slot." : myWeight == null ? "" : myWeight > 0 ? `Your weight: ${units(p?.myWeight)} units at snapshot slot ${Number(p?.snapshotSlot).toLocaleString("en-US")}.` : `This wallet held no $FIX6900 at snapshot slot ${Number(p?.snapshotSlot).toLocaleString("en-US")}, so it cannot vote on this proposal.`;

  return (
    <div className="page pagebody">
      <PageHeader
        eyebrow={p ? `Proposal #${p.id} · ${KIND_LABEL[p.kind]}` : "Holder governance"}
        title={p ? p.title : isLoading ? "Loading…" : `Proposal #${id}`}
        desc={p ? <PayloadSummary p={p} /> : undefined}
        right={p ? <StatusChip status={p.status} className="chip-lg" /> : undefined}
      />
      <p className="faint">
        <Link href="/governance" className="lnk">
          ← All proposals
        </Link>
      </p>

      <div className="split split-gov">
        <section className="split-main" aria-label="Proposal">
          {!p && isLoading && (
            <div className="panel-b">
              <Skeleton className="w-28" />
            </div>
          )}
          {p && (
            <>
              <div className="panel-b">
                <div className="micro muted">Tally · weight of votes cast</div>
                <TallyBar t={p.tally} />
                <QuorumMeter t={p.tally} quorumBps={p.quorumBps} supply={p.snapshotSupply} />
              </div>

              <div className="panel-b" aria-label="Vote">
                <div className="micro muted">{canVote ? "Cast or change your vote" : "Voting closed"}</div>
                <div className="gov-votebtns">
                  {CHOICES.map((c) => {
                    const mine = p.myVote?.choice === c.value;
                    return (
                      <Button key={c.value} variant={mine ? "primary" : "secondary"} disabled={!canVote || vote.isPending || demo || (wallet != null && myWeight === 0)} aria-pressed={mine} onClick={() => void cast(c.value)} className={cn("gov-votebtn", mine && "is-mine")}>
                        {pending === c.value ? "Signing…" : mine ? `✓ ${c.label}` : c.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="faint">{weightNote}</p>
                {wallet && !signMessage && <p className="field-err">This wallet does not support message signing. Use Phantom, Solflare or Backpack.</p>}
                {demo && <p className="field-err">Keeper unreachable: voting is unavailable in demo mode.</p>}
                {vote.error && <p className="field-err">{vote.error.message}</p>}
                {vote.isSuccess && p.myVote && <p className="faint">Vote recorded: {p.myVote.choice} with {units(p.myVote.weight)} units at {dateTime(p.myVote.ts)}. Re-voting replaces it.</p>}
                <details className="gov-msg">
                  <summary className="micro muted">What you sign</summary>
                  <pre className="code code-block">{voteMessage("for", p.id, p.snapshotSlot).replace("vote for", "vote <for|against|abstain>")}</pre>
                  <p className="faint">A plain message signed with your wallet key (ed25519). No transaction, no fee, no approval of any program. The keeper verifies the signature and weighs the vote by your snapshot balance.</p>
                </details>
              </div>

              <div className="panel-b">
                <div className="micro muted">Description</div>
                {p.description ? <p className="prose">{p.description}</p> : <p className="faint">No description.</p>}
              </div>

              {(p.status === "queued" || p.status === "executed" || p.status === "passed" || p.status === "failed" || p.status === "cancelled") && (
                <div className="panel-b">
                  <div className="micro muted">Result</div>
                  <dl className="kvl">
                    <div>
                      <dt>Outcome</dt>
                      <dd className="m">{String(p.result?.reason ?? p.result?.note ?? p.status)}</dd>
                    </div>
                    {p.result?.effective != null && (
                      <div>
                        <dt>In force</dt>
                        <dd className="m">
                          {String((p.result.effective as { key: string }).key)} = {String((p.result.effective as { value: number }).value)}
                        </dd>
                      </div>
                    )}
                    {p.queuedActionPda && (
                      <div>
                        <dt>On-chain action</dt>
                        <dd>
                          <Address value={p.queuedActionPda} />
                        </dd>
                      </div>
                    )}
                    {p.queuedSig && (
                      <div>
                        <dt>Queue transaction</dt>
                        <dd>
                          <Address value={p.queuedSig} kind="tx" />
                        </dd>
                      </div>
                    )}
                    {p.result?.reconProposalId != null && (
                      <div>
                        <dt>Reconstitution proposal</dt>
                        <dd className="m">
                          #{String(p.result.reconProposalId)} ·{" "}
                          <Link href="/admin" className="lnk">
                            committee console
                          </Link>
                        </dd>
                      </div>
                    )}
                    {typeof p.result?.lastError === "string" && (
                      <div>
                        <dt>Last error</dt>
                        <dd className="m">{p.result.lastError}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <div className="panel-b">
                <div className="micro muted">Votes · {p.tally.voters.toLocaleString("en-US")}</div>
                {p.votes && p.votes.length > 0 ? (
                  <div className="tw tw-flat">
                    <table className="t gov-votes">
                      <thead>
                        <tr>
                          <th className="micro">Wallet</th>
                          <th className="micro">Choice</th>
                          <th className="micro r">Weight</th>
                          <th className="micro r hide-sm">Share</th>
                          <th className="micro r">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.votes.map((v) => (
                          <tr key={v.wallet} className={cn(v.wallet === wallet && "is-mine")}>
                            <td>
                              <Address value={v.wallet} copy={false} />
                              {v.wallet === wallet ? <span className="faint"> (you)</span> : null}
                            </td>
                            <td className="m">{v.choice}</td>
                            <td className="m r">{units(v.weight)}</td>
                            <td className="m r hide-sm">{bpsToPct(Number(p.tally.participation) > 0 ? (Number(v.weight) / Number(p.tally.participation)) * 10_000 : 0, 1)}</td>
                            <td className="m r muted" title={dateTime(v.ts)}>
                              {relTime(v.ts)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint">No votes yet.</p>
                )}
              </div>
              <Notes
                notes={[
                  { label: `Snapshot of every $FIX6900 holder at slot ${Number(p.snapshotSlot).toLocaleString("en-US")}; ${p.snapshotHolders.toLocaleString("en-US")} wallets, ${units(p.snapshotSupply)} circulating`, source: "keeper holder snapshot (Helius DAS / gPA), exclusions applied" },
                  { label: "Vote weights are the snapshot balances; signatures verified by the keeper", source: "keeper governance ledger" },
                  ...(p.queuedActionPda ? [{ label: "Timelocked PendingAction created for this proposal", address: p.queuedActionPda }] : []),
                ]}
              />
            </>
          )}
        </section>

        <aside className="split-side stack" aria-label="Proposal facts">
          {p && (
            <>
              <SidePanel label={p.status === "open" ? "Time left" : "Voting ended"}>
                <div className="side-v m">{p.status === "open" ? <Countdown to={p.endTs} /> : dateTime(p.endTs)}</div>
                <div className="faint">
                  {dateTime(p.startTs)} → {dateTime(p.endTs)}
                </div>
              </SidePanel>
              <SidePanel label="Snapshot">
                <dl className="kvl">
                  <div>
                    <dt>Slot</dt>
                    <dd className="m">{Number(p.snapshotSlot).toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt>Circulating</dt>
                    <dd className="m">{units(p.snapshotSupply)}</dd>
                  </div>
                  <div>
                    <dt>Holders</dt>
                    <dd className="m">{p.snapshotHolders.toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt>Quorum</dt>
                    <dd className="m">
                      {bpsToPct(p.quorumBps, 2)} = {units(p.tally.quorumUnits)}
                    </dd>
                  </div>
                </dl>
              </SidePanel>
              <SidePanel label="Proposer">
                <div className="side-v">{p.proposer === "admin" ? <span className="m">index committee</span> : <Address value={p.proposer} />}</div>
                <div className="faint">opened {dateTime(p.createdTs)}</div>
              </SidePanel>
              <SidePanel label="Binding path">
                <p className="faint">
                  {p.kind === "set_param"
                    ? "If it passes, the keeper writes the value into its configuration store at once; the methodology, rebalancer and flywheel read it from there."
                    : "If it passes, the keeper files an approved reconstitution proposal and queues it as a timelocked on-chain action (48 h on mainnet); anyone may execute it after the ETA."}
                </p>
              </SidePanel>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
