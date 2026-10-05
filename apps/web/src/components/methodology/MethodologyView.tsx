"use client";

import { useMemo } from "react";
import { useAnnouncements, useMethodology } from "@/lib/api";
import { bpsToPct, compact, dateOnly, dateTime } from "@/lib/format";
import { cn, truncateMiddle } from "@/lib/utils";
import { Card, CardHeader } from "../ui/Card";
import { Countdown } from "../ui/Countdown";
import { Skeleton } from "../ui/Skeleton";

type Cfg = Record<string, unknown>;
const get = (o: Cfg | undefined, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Cfg)[k] : undefined), o);
const n = (v: unknown, d: number): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : d);
const s = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

export function MethodologyView() {
  const { data, isLoading } = useMethodology();
  const { data: ann } = useAnnouncements();
  const cfg = data?.config;

  const minAge = n(get(cfg, "eligibility.minAgeDays"), 14);
  const minFdv = n(get(cfg, "eligibility.minFdvUsd"), 2_000_000);
  const minVol = n(get(cfg, "eligibility.minVolume24hUsd"), 250_000);
  const minVol7 = n(get(cfg, "eligibility.minVolume7dAvgUsd"), 100_000);
  const impact = n(get(cfg, "eligibility.maxPriceImpactPctFor10k"), 2);
  const count = n(get(cfg, "selection.count"), 40);
  const buffer = n(get(cfg, "selection.bufferRank"), 50);
  const scheme = s(get(cfg, "weighting.scheme"), "equal");
  const capBps = n(get(cfg, "weighting.capBps"), 1200);
  const floorBps = n(get(cfg, "weighting.floorBps"), 50);
  const interval = n(get(cfg, "rebalance.intervalDays"), 7);
  const band = n(get(cfg, "rebalance.driftBandBps"), 250);
  const maxTrade = n(get(cfg, "rebalance.maxTradePctOfDailyVolume"), 5);
  const annAhead = n(get(cfg, "reconstitution.announceHoursAhead"), 48);

  const selected = useMemo(() => (data?.lastRun?.selected ?? []).map((x) => (typeof x === "string" ? { mint: x, symbol: undefined as string | undefined, marketCapUsd: undefined as number | undefined } : x)), [data]);
  const eligible = useMemo(() => (data?.lastRun?.eligible ?? []).map((x) => (typeof x === "string" ? { mint: x, symbol: undefined as string | undefined, marketCapUsd: undefined as number | undefined } : x)), [data]);
  const weights = useMemo(() => {
    const w = data?.lastRun?.weights ?? [];
    const m = new Map<string, number>();
    w.forEach((x, i) => {
      if (typeof x === "number") {
        const sel = selected[i];
        if (sel) m.set(sel.mint, x > 1 ? x : Math.round(x * 10_000));
      } else m.set(x.mint, x.weightBps);
    });
    return m;
  }, [data, selected]);
  const selectedSet = useMemo(() => new Set(selected.map((x) => x.mint)), [selected]);
  const eligibleSorted = useMemo(() => eligible.slice().sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0)), [eligible]);

  return (
    <div className="wrap page">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        {/* Main document */}
        <article className="min-w-0 max-w-3xl">
          <div className="eyebrow mb-3">Index methodology · v1</div>
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">FI6900 Solana Memecoin Equal Weight Index</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
            The FI6900 Index measures the performance of the {count} largest eligible memecoins on Solana, held at equal weight. Every constituent must be deep enough to be bought and sold in size, and the fund that tracks it holds the exact basket on-chain. Parameters below are read live from the keeper configuration.
          </p>

          <Section id="eligibility" n="1" title="Eligibility">
            <p>A token is eligible for inclusion if, at the reconstitution snapshot, all of the following hold:</p>
            <Rules
              rules={[
                { k: "Immutability", v: "Mint authority and freeze authority are both revoked." },
                { k: "Age", v: `At least ${minAge} days since first trade.` },
                { k: "Size", v: `Fully diluted market capitalisation ≥ ${"$" + compact(minFdv, 0)}.` },
                { k: "Liquidity (volume)", v: `24h volume ≥ ${"$" + compact(minVol, 0)} and 7-day average ≥ ${"$" + compact(minVol7, 0)} per day.` },
                { k: "Liquidity (depth)", v: `A Jupiter quote to sell $10,000 shows price impact ≤ ${impact}%.` },
                { k: "Asset type", v: "Not a stablecoin, liquid staking token or wrapped asset." },
                { k: "Manual exclusion", v: "Not on the committee exclusion list (confirmed exploits or rugs only)." },
              ]}
            />
          </Section>

          <Section id="selection" n="2" title="Selection">
            <p>
              Eligible tokens are ranked by market capitalisation. The top <Num>{count}</Num> form the index. To limit turnover, an <strong className="font-medium text-text">incumbent buffer</strong> applies: a current constituent keeps its seat as long as it remains ranked <Num>{buffer}</Num> or better, while a non-constituent must rank inside the top <Num>{count}</Num> to be added.
            </p>
          </Section>

          <Section id="weighting" n="3" title="Weighting">
            <p>
              The index uses the <strong className="font-medium text-text">{scheme === "equal" ? "equal weight" : scheme === "sqrt-cap" ? "square-root market cap" : "capped market cap"}</strong> scheme.
              {scheme === "equal" && (
                <>
                  {" "}
                  Each constituent has a target weight of 1/N = <Num>{bpsToPct(Math.floor(10_000 / count), 2)}</Num>. Raw market-cap weighting of memecoins concentrates most of the fund in two names; equal weight diversifies and systematically sells winners to buy losers at each rebalance.
                </>
              )}
              {scheme === "sqrt-cap" && (
                <>
                  {" "}
                  Weights are proportional to the square root of market cap, capped at <Num>{bpsToPct(capBps, 0)}</Num> and floored at <Num>{bpsToPct(floorBps, 1)}</Num>, with excess redistributed pro-rata.
                </>
              )}
              {scheme === "capped-cap" && (
                <>
                  {" "}
                  Weights are proportional to market cap, capped at <Num>{bpsToPct(capBps, 0)}</Num>, with excess redistributed pro-rata.
                </>
              )}
            </p>
            <p>
              Target weights are stored on-chain per asset (<code className="font-mono text-text">target_weight_bps</code>) and are informational for mint/redeem, which always use the actual vault composition. Auctions enforce them.
            </p>
          </Section>

          <Section id="rebalancing" n="4" title="Rebalancing">
            <Rules
              rules={[
                { k: "Scheduled", v: `Every ${interval} days the vault is brought back to target weights.` },
                { k: "Drift trigger", v: `Between schedules, an auction opens whenever any constituent drifts more than ${bpsToPct(band, 1)} (absolute) from target.` },
                { k: "Mechanism", v: "Permissionless Dutch auctions: the sold asset's price decays linearly from a premium to a discount over a fixed slot window; anyone may fill. No price oracle is used." },
                { k: "Liquidity safety valve", v: `No single auction sells more than ${maxTrade}% of the asset's 24h volume. The remainder is queued to the next cycle.` },
                { k: "Index continuity", v: "On every fill the divisor is reset so the index level is continuous across the trade." },
              ]}
            />
          </Section>

          <Section id="reconstitution" n="5" title="Reconstitution">
            <p>
              Constituent changes take effect on the <strong className="font-medium text-text">1st of each month at 00:00 UTC</strong>, based on a snapshot taken at the time of the announcement. Preliminary changes are published <Num>{annAhead}h</Num> ahead on this page. Removed assets are flagged <code className="font-mono text-text">Removing</code> on-chain: their weight goes to zero, they stop being required for creation, and their vault is sold down through auctions before the asset account is closed.
            </p>
          </Section>

          <Section id="level" n="6" title="Index level and NAV">
            <pre className="overflow-x-auto rounded-lg bg-surface p-5 font-mono text-xs leading-relaxed text-text/90 hairline">{`level_t   = Σ_i price_i,t × effective_balance_i,t / divisor_t
divisor_0 = Σ price × balance / 1000           # base level 1000 at inception
NAV/unit  = Σ price_i × effective_balance_i / index supply

effective_balance = vault.amount − pending_deposits − pending_withdrawals`}</pre>
            <p>Prices are Jupiter mid quotes. Pending deposits from unfinalised mint sessions and reserved redemption entitlements are excluded from NAV so creations and redemptions never dilute existing holders.</p>
          </Section>

          <Section id="governance" n="7" title="Governance and changes">
            <p>
              Parameter changes (thresholds, cadence, fees) are made by the fund authority (a multisig in production) and announced here with at least {annAhead}h notice. Account layouts and API shapes are specified in the public <code className="font-mono text-text">ARCHITECTURE.md</code>. This methodology is versioned; material changes increment the version.
            </p>
          </Section>
        </article>

        {/* Sidebar */}
        <aside className="flex flex-col gap-4 lg:self-start">
          <Card>
            <CardHeader eyebrow="Next reconstitution" title={data?.nextReconstitution ? dateOnly(data.nextReconstitution) : <Skeleton className="h-4 w-24" />} />
            <div className="p-5">
              <div className="num text-2xl font-medium tracking-[-0.02em] sm:text-3xl">
                <Countdown to={data?.nextReconstitution} />
              </div>
              <div className="mt-1.5 text-xs text-muted">effective 00:00 UTC · announced {annAhead}h ahead</div>
            </div>
          </Card>

          <Card>
            <CardHeader eyebrow="Last run" title={data?.lastRun ? dateTime(data.lastRun.ts) : isLoading ? <Skeleton className="h-4 w-32" /> : "No run recorded"} />
            {data?.lastRun && (
              <>
                <div className="grid grid-cols-3 gap-px border-b border-line bg-line text-center">
                  <Mini label="Eligible" value={eligible.length} />
                  <Mini label="Selected" value={selected.length} />
                  <Mini label="Target wt" value={bpsToPct(selected.length ? Math.floor(10_000 / selected.length) : 0, 2)} />
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {eligibleSorted.map((e, i) => {
                        const inIdx = selectedSet.has(e.mint);
                        return (
                          <tr key={e.mint} className={cn("border-b border-line last:border-0", !inIdx && "text-muted")}>
                            <td className="h-9 pl-5 pr-2 font-mono text-muted">{i + 1}</td>
                            <td className="h-9 px-2 font-semibold">{e.symbol ?? truncateMiddle(e.mint)}</td>
                            <td className="h-9 px-2 text-right font-mono text-muted">{e.marketCapUsd != null ? "$" + compact(e.marketCapUsd, 1) : "—"}</td>
                            <td className="h-9 px-2 text-right font-mono">{inIdx ? bpsToPct(weights.get(e.mint) ?? 0, 2) : ""}</td>
                            <td className={cn("h-9 pl-2 pr-5 text-right font-mono", inIdx ? "text-text" : "text-dim")}>{inIdx ? "in" : "out"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHeader eyebrow="Announcements" title="Notices" />
            <ul className="divide-y divide-line">
              {(ann ?? []).map((a) => (
                <li key={a.ts + a.title} className="p-5">
                  <div className="mb-1 font-mono text-[11px] text-muted">{dateTime(a.ts)}</div>
                  <div className="text-sm font-semibold">{a.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{a.body}</p>
                </li>
              ))}
              {ann && ann.length === 0 && <li className="p-5 text-xs text-muted">No announcements.</li>}
              {!ann && (
                <li className="space-y-2 p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                </li>
              )}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-20 sm:mt-14">
      <h2 className="flex items-baseline gap-3 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
        <span className="font-mono text-xs text-muted">{n}.</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted sm:text-base">{children}</div>
    </section>
  );
}

function Rules({ rules }: { rules: { k: string; v: string }[] }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-lg bg-surface hairline">
      {rules.map((r) => (
        <div key={r.k} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
          <dt className="font-medium text-text">{r.k}</dt>
          <dd className="text-muted">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="num font-mono text-text">{children}</span>;
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface px-3 py-3">
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 font-mono text-base font-medium">{value}</div>
    </div>
  );
}
