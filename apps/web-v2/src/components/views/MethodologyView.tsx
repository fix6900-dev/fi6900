"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useAnnouncements, useFund, useGovernance, useMethodology, useProposals } from "@/lib/api";
import { useGovProposals } from "@/lib/gov";
import { units } from "../governance/GovBits";
import { bpsToPct, compact, dateOnly, dateTime } from "@/lib/format";
import { truncateMiddle } from "@/lib/utils";
import { Countdown } from "../ui/Countdown";
import { PageHeader } from "../ui/Card";

type Cfg = Record<string, unknown>;
const get = (o: Cfg | undefined, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Cfg)[k] : undefined), o);
const n = (v: unknown, d: number): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : d);
const s = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

const TOC = [
  ["universe", "1", "Universe"],
  ["eligibility", "2", "Eligibility"],
  ["selection", "3", "Selection and buffer rule"],
  ["weighting", "4", "Weighting"],
  ["rebalance", "5", "Rebalance cadence and drift band"],
  ["reconstitution", "6", "Reconstitution schedule"],
  ["level", "7", "Index level formula"],
  ["committee", "8", "Committee process"],
  ["governance", "9", "Holder governance"],
] as const;

function Rule({ id, n: num, title, children, margin }: { id: string; n: string; title: string; children: ReactNode; margin?: [string, ReactNode][] }) {
  return (
    <section id={id} className="rule-sec" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h2">
        <span className="muted">§{num}</span> {title}
      </h2>
      <div className="rule-row">
        <div className="rule-prose">{children}</div>
        {margin && (
          <dl className="rule-margin" aria-label={`Live configuration for ${title}`}>
            <dt className="micro muted rule-mh">Live config</dt>
            {margin.map(([k, v]) => (
              <div key={k}>
                <dt className="micro muted">{k}</dt>
                <dd className="m">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

export function MethodologyView() {
  const { data, isLoading } = useMethodology();
  const { data: ann } = useAnnouncements();
  const { data: proposals } = useProposals();
  const { data: fund } = useFund();
  const { data: govInfo } = useGovernance();
  const { data: govProposals } = useGovProposals();
  const gov = govInfo?.governance;
  const govOpen = (govProposals ?? []).filter((p) => p.status === "open");
  const cfg = data?.config;
  // Live constituent count from the fund account; the selection target below is the rule's parameter.
  const held = fund ? Number(fund.assetCount) : null;

  const minAge = n(get(cfg, "eligibility.minAgeDays"), 14);
  const minFdv = n(get(cfg, "eligibility.minFdvUsd"), 2_000_000);
  const minVol = n(get(cfg, "eligibility.minVolume24hUsd"), 250_000);
  const minVol7 = n(get(cfg, "eligibility.minAvgVolume7dUsd"), 100_000);
  const quote = n(get(cfg, "eligibility.impactQuoteUsd"), 10_000);
  const impactBps = n(get(cfg, "eligibility.maxPriceImpactBps"), 200);
  const count = n(get(cfg, "selection.targetCount"), 0);
  const buffer = n(get(cfg, "selection.bufferRank"), 50);
  const scheme = s(get(cfg, "weighting.scheme"), "equal");
  const interval = n(get(cfg, "rebalance.intervalDays"), 7);
  const band = n(get(cfg, "rebalance.driftBandBps"), 125);
  const rel = n(get(cfg, "rebalance.driftRelativeBps"), 5000);
  const maxTrade = n(get(cfg, "rebalance.maxTradePctOfDailyVolume"), 5);
  const annAhead = n(get(cfg, "reconstitution.announceHoursAhead"), 48);
  const dom = n(get(cfg, "reconstitution.dayOfMonth"), 1);
  const hour = n(get(cfg, "reconstitution.hourUtc"), 0);
  const mode = s(get(cfg, "reconstitution.mode"), "manual");
  const cooldown = n(get(cfg, "reconstitution.rejectCooldownDays"), 90);
  const base = n(get(cfg, "baseLevel"), 1000);
  const version = s(get(cfg, "version"), isLoading ? "loading" : "unknown");
  const category = s(get(cfg, "universe.coingeckoCategory"), "solana-meme-coins");
  const candidates = n(get(cfg, "universe.maxCandidates"), 150);
  const startPrem = n(get(cfg, "rebalance.auction.startPremiumBps"), 300);
  const maxDisc = n(get(cfg, "rebalance.auction.maxDiscountBps"), 400);
  const slots = n(get(cfg, "rebalance.auction.durationSlots"), 150);

  const run = data?.lastRun;
  const selected = useMemo(() => (run?.selected ?? []).map((x) => (typeof x === "string" ? { mint: x, symbol: undefined as string | undefined } : x)), [run]);
  const eligible = useMemo(() => (run?.eligible ?? []).map((x) => (typeof x === "string" ? { mint: x, symbol: undefined as string | undefined, marketCapUsd: undefined as number | undefined } : { marketCapUsd: undefined as number | undefined, ...x })), [run]);
  const open = (proposals ?? []).filter((p) => p.status === "proposed");

  return (
    <div className="page pagebody">
      <PageHeader eyebrow={`Index methodology · version ${version}`} title="FIX6900 Solana Memecoin Equal Weight Index" desc={`The index measures ${held != null ? `the ${held} eligible` : "eligible"} Solana memecoins currently held at equal weight. The rulebook below is read live from the keeper configuration, so the numbers in the margin are the numbers in force.`} />

      <div className="doc">
        <nav className="toc" aria-label="Contents">
          <details className="toc-d" open>
            <summary className="micro">Contents</summary>
            <ol>
              {TOC.map(([id, num, label]) => (
                <li key={id}>
                  <a className="lnk" href={`#${id}`}>
                    §{num} {label}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        </nav>

        <article className="rulebook">
          <Rule id="universe" n="1" title="Universe" margin={[["source", "coingecko"], ["category", category], ["maxCandidates", String(candidates)]]}>
            <p>The universe is CoinGecko&apos;s &quot;Solana Meme Coins&quot; category ranked by market capitalisation, up to {candidates} candidates. Wrapped, bridged, staked and stable assets are excluded by tag and by symbol pattern.</p>
          </Rule>
          <Rule id="eligibility" n="2" title="Eligibility" margin={[["minAgeDays", String(minAge)], ["minFdvUsd", "$" + compact(minFdv, 0)], ["minVolume24hUsd", "$" + compact(minVol, 0)], ["minAvgVolume7dUsd", "$" + compact(minVol7, 0)], ["maxPriceImpactBps", `${impactBps} on $${quote.toLocaleString()}`]]}>
            <p>A coin is eligible at the snapshot only if all of the following hold. Mint and freeze authority are revoked and there is no transfer tax. It is at least {minAge} days old. Fully diluted value is at least ${compact(minFdv, 0)}. Trading volume is at least ${compact(minVol, 0)} over 24 hours and ${compact(minVol7, 0)} a day over seven days. A sale of ${quote.toLocaleString()} moves the price by no more than {bpsToPct(impactBps, 1)}.</p>
          </Rule>
          <Rule id="selection" n="3" title="Selection and buffer rule" margin={[["targetCount", String(count)], ["bufferRank", String(buffer)]]}>
            <p>Eligible coins are ranked by market capitalisation and the top {count} form the index. To limit turnover a buffer applies. A current constituent keeps its seat while it ranks {buffer} or better. A coin that is not a constituent must rank inside the top {count} to be added.</p>
          </Rule>
          <Rule id="weighting" n="4" title="Weighting" margin={[["scheme", scheme], ["target weight", `1 / N`]]}>
            <p>The index is {scheme === "equal" ? "equally weighted" : `weighted by the ${scheme} scheme`}. Each constituent has a target weight of 1 / N, so with N constituents each coin targets {(100 / Math.max(1, count)).toFixed(2)}% at the full {count} slots. Target weights are stored per asset in the fund account. Auctions enforce them.</p>
          </Rule>
          <Rule id="rebalance" n="5" title="Rebalance cadence and drift band" margin={[["intervalDays", String(interval)], ["driftBandBps", String(band)], ["driftRelativeBps", String(rel)], ["maxTradePctOfDailyVolume", `${maxTrade}%`], ["auction start premium", `${startPrem} bps`], ["auction max discount", `${maxDisc} bps`], ["auction duration", `${slots} slots`]]}>
            <p>Every {interval} days the vault is brought back to target weights. Between schedules a drift check runs and an auction opens when a coin drifts more than {bpsToPct(band, 2)} in absolute weight from target. Rebalancing uses permissionless Dutch auctions: the price of the coin being sold decays linearly from a premium to a discount over {slots} slots and anyone may fill. No price oracle is used. No single auction sells more than {maxTrade}% of a coin&apos;s daily volume.</p>
          </Rule>
          <Rule id="reconstitution" n="6" title="Reconstitution schedule" margin={[["day of month", String(dom)], ["hour (UTC)", String(hour).padStart(2, "0") + ":00"], ["announce ahead", `${annAhead} h`], ["mode", mode], ["reject cooldown", `${cooldown} days`]]}>
            <p>Constituent changes take effect on day {dom} of each month at {String(hour).padStart(2, "0")}:00 UTC. Proposed changes are announced {annAhead} hours ahead on this page. A removed coin is flagged on-chain, its target weight goes to zero and its vault is sold down through auctions.</p>
          </Rule>
          <Rule id="level" n="7" title="Index level formula" margin={[["base level", base.toFixed(2)]]}>
            <pre className="code code-block">{`Level_t = Σ(p_i,t × q_i,t) / Divisor_t\nDivisor_0 = Σ(p_i,0 × q_i,0) / ${base}\nNAV/unit = Σ(p_i × q_i) / index supply`}</pre>
            <p>The index starts at {base.toFixed(2)}. On every rebalance fill the divisor is adjusted so the level is continuous across the trade: a rebalance never causes a jump. Quantities exclude pending deposits and reserved redemptions, so creations and redemptions never dilute holders.</p>
          </Rule>
          <Rule id="committee" n="8" title="Committee process" margin={[["mode", mode], ["announce ahead", `${annAhead} h`]]}>
            <p>Additions and removals are proposed by the rules and approved by the index committee, monthly. Parameter changes are announced here with at least {annAhead} hours of notice. The methodology is versioned and material changes increment the version.</p>
          </Rule>
          <Rule
            id="governance"
            n="9"
            title="Holder governance"
            margin={[
              ["enabled", gov ? (gov.enabled ? "yes" : "no") : "—"],
              ["voting window", gov ? `${gov.params.votingHours} h` : "—"],
              ["quorum", gov ? `${gov.params.quorumBps} bps of circulating` : "—"],
              ["proposal threshold", gov ? `${gov.params.proposalThresholdBps} bps` : "—"],
              ["votable params", gov ? String(gov.params.allowedParams.length) : "—"],
              ["open proposals", gov ? String(gov.counts.open) : "—"],
            ]}
          >
            <p>
              Holders of $FIX6900 vote directly on constituent additions and removals and on a whitelisted set of keeper parameters (24h volume floor, drift band, fee burn share, flywheel split), each within fixed bounds. A vote is a signed message, not a transaction. Weight is the wallet&apos;s balance at the proposal&apos;s snapshot slot; pools, program accounts, the burn address and the denylist are excluded from the snapshot and from circulating supply. A proposal passes when participation reaches the quorum and votes for exceed votes against. Passed constituent changes are queued through the on-chain timelock exactly like committee approvals; passed parameters take effect in the keeper at once and are shown in the margin of the rule they modify. The committee may cancel a proposal before it is executed. The full rules, message formats and limits are in{" "}
              <a className="lnk" href="https://github.com/fix6900-dev/fi6900/blob/main/docs/governance.md" target="_blank" rel="noreferrer noopener">
                docs/governance.md ↗
              </a>
              .
            </p>
          </Rule>
        </article>

        <aside className="doc-side" aria-label="Index status">
          <section className="sidepanel">
            <div className="micro muted">Next reconstitution</div>
            <div className="side-v m">{data?.nextReconstitution ? <Countdown to={data.nextReconstitution} /> : isLoading ? "—" : "not scheduled"}</div>
            <div className="faint">{data?.nextReconstitution ? `${dateOnly(data.nextReconstitution)}, ${String(hour).padStart(2, "0")}:00 UTC` : ""}</div>
          </section>
          <section className="sidepanel">
            <div className="micro muted">Last run</div>
            {run ? (
              <>
                <div className="side-v m">{dateTime(run.ts)}</div>
                <div className="faint">
                  {eligible.length} eligible · {selected.length} selected
                </div>
                <ul className="runlist">
                  {eligible
                    .slice()
                    .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
                    .slice(0, 12)
                    .map((e, i) => (
                      <li key={e.mint}>
                        <span className="muted m">{i + 1}</span> <b>{e.symbol ?? truncateMiddle(e.mint)}</b> <span className="faint m">{e.marketCapUsd != null ? "$" + compact(e.marketCapUsd, 1) : ""}</span>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <div className="faint">{isLoading ? "loading" : "No run recorded yet."}</div>
            )}
          </section>
          <section className="sidepanel">
            <div className="micro muted">Current proposals</div>
            {open.length === 0 ? (
              <div className="faint">No open proposals</div>
            ) : (
              <ul className="runlist">
                {open.map((p) => (
                  <li key={p.id}>
                    <b>{p.symbol ?? truncateMiddle(p.mint)}</b> <span className="chip chip-outline">{p.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="sidepanel">
            <div className="micro muted">Holder governance</div>
            {gov ? (
              <>
                <div className="side-v m">
                  {gov.counts.open} open · {gov.counts.executed + gov.counts.queued} passed
                </div>
                <div className="faint">
                  {gov.lastSnapshot ? `${units(gov.lastSnapshot.supply)} circulating at the last snapshot · ` : ""}
                  {Object.keys(gov.overrides).length > 0 ? `${Object.keys(gov.overrides).length} parameter${Object.keys(gov.overrides).length === 1 ? "" : "s"} set by vote` : "no parameters overridden by vote"}
                </div>
                {govOpen.length > 0 && (
                  <ul className="runlist">
                    {govOpen.slice(0, 4).map((p) => (
                      <li key={p.id}>
                        <Link href={`/governance/${p.id}`} className="lnk">
                          #{p.id} {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="faint">
                  <Link href="/governance" className="lnk">
                    Vote or propose →
                  </Link>
                </p>
              </>
            ) : (
              <div className="faint">Not available on this keeper.</div>
            )}
          </section>
          <section className="sidepanel">
            <div className="micro muted">Notices</div>
            {ann && ann.length > 0 ? (
              <ul className="runlist">
                {ann.map((a) => (
                  <li key={a.ts + a.title}>
                    <div className="faint m">{dateTime(a.ts)}</div>
                    <b>{a.title}</b>
                    <p className="prose-sm">{a.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="faint">No announcements.</div>
            )}
          </section>
          <p className="faint">
            Source: keeper configuration. See{" "}
            <Link href="/verify" className="lnk">
              Verify
            </Link>{" "}
            to check the fund on-chain.
          </p>
        </aside>
      </div>
    </div>
  );
}
