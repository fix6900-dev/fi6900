"use client";

import { useGovernance, useMethodology } from "@/lib/api";
import { dateTime, relTime } from "@/lib/format";
import { Card, CardHeader } from "../ui/Card";
import { Countdown } from "../ui/Countdown";
import { Skeleton } from "../ui/Skeleton";
import { KV } from "./controls";

type Cfg = Record<string, unknown>;
const get = (o: Cfg | undefined, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Cfg)[k] : undefined), o);

export function ReconstitutionStatus() {
  const { data, isLoading } = useMethodology();
  const { data: gov } = useGovernance();
  const cfg = data?.config;
  const mode = (typeof get(cfg, "reconstitution.mode") === "string" ? (get(cfg, "reconstitution.mode") as string) : null) ?? gov?.reconstitutionMode ?? null;
  const announce = get(cfg, "reconstitution.announceHoursAhead");
  const cooldown = get(cfg, "reconstitution.rejectCooldownDays");
  const version = get(cfg, "version");
  const loading = isLoading && !data;
  const sk = <Skeleton className="h-3.5 w-40" />;
  const next = data?.nextReconstitution ?? null;
  const announceAt = next && typeof announce === "number" ? new Date(new Date(next).getTime() - announce * 3_600_000).toISOString() : null;

  return (
    <Card>
      <CardHeader eyebrow="Schedule" title="Reconstitution" right={typeof version === "string" && <span className="font-mono text-[11px] text-dim">methodology v{version}</span>} />
      <dl className="divide-y divide-line">
        <KV
          k="Next window"
          v={loading ? sk : next ? <span className="font-mono tabular-nums">{dateTime(next)} <span className="text-muted">· in <Countdown to={next} compact /></span></span> : <span className="font-mono text-xs text-dim">—</span>}
          note={announceAt ? <>Approved proposals are announced {String(announce)} h ahead ({dateTime(announceAt)}) and queued on-chain at the window.</> : undefined}
        />
        {mode && <KV k="Mode" v={<span className="font-mono text-xs">{mode}</span>} note={mode === "manual" ? "Methodology output is filed as proposals for the committee; nothing changes on-chain without an approve." : "Methodology output is auto-approved and queued at the window."} />}
        <KV
          k="Last methodology run"
          v={loading ? sk : data?.lastRun ? <span className="font-mono tabular-nums">{dateTime(data.lastRun.ts)} <span className="text-muted">· {relTime(data.lastRun.ts)}</span></span> : <span className="font-mono text-xs text-dim">no run recorded</span>}
          note={data?.lastRun ? <>{data.lastRun.eligible.length} eligible · {data.lastRun.selected.length} selected</> : undefined}
        />
        {typeof cooldown === "number" && <KV k="Reject cooldown" v={<span className="font-mono tabular-nums">{cooldown} days</span>} note="A rejected proposal is not re-filed for this long." />}
      </dl>
    </Card>
  );
}
