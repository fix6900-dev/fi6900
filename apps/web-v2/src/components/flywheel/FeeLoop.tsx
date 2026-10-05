"use client";

import { compact, num } from "@/lib/format";
import type { Flywheel, FlywheelEvent } from "@/lib/schemas";

export type EdgeId = "claim" | "lp" | "mint" | "air" | "fees" | "burn" | "ret";
export type Flows = Record<EdgeId, number>;

const DAY = 86_400_000;
const solOf = (e: FlywheelEvent) => {
  const v = Number((e.amounts as Record<string, unknown>).sol);
  return Number.isFinite(v) ? v : 0;
};

/** SOL moved over each edge in the last 24 hours, summed from the live event feed. */
export function flows24h(events: FlywheelEvent[] | undefined, now = Date.now()): Flows {
  const sum = (kind: FlywheelEvent["kind"]) => (events ?? []).filter((e) => e.kind === kind && now - new Date(e.ts).getTime() <= DAY).reduce((a, e) => a + solOf(e), 0);
  const claim = sum("claim");
  const lp = sum("add_lp");
  const mint = sum("buy_index");
  const air = sum("airdrop") || mint;
  const buyback = sum("buyback");
  return { claim, lp, mint, air, fees: buyback, burn: buyback, ret: buyback };
}

type N = { id: string; x: number; y: number; w: number; h: number; title: string; sub: string; value: string };
type E = { id: EdgeId; d: string };

function build(data: Flywheel | undefined) {
  const claimed = data?.creatorFeesClaimedSol ?? 0;
  const lp = data?.lpAddedSol ?? 0;
  const basket = Math.max(0, claimed - lp);
  const buyback = data?.buybackSol ?? 0;
  const treasury = data?.treasurySol ?? 0;
  const v = {
    A: `${num(claimed, 2)} SOL`,
    C: `${num(lp, 2)} SOL`,
    D: `${num(basket, 2)} SOL`,
    E: `${compact(data?.airdroppedUnits ?? 0, 2)} units · ${(data?.airdropRounds ?? 0).toLocaleString()} rounds`,
    F: `${num(buyback + treasury, 2)} SOL`,
    G: `${num(buyback, 2)} SOL`,
    H: `${compact(data?.burnedCoin ?? 0, 2)} $FIX6900 burned`,
  };
  const t = {
    A: ["$FIX6900 creator fees", "pump.fun and PumpSwap"],
    B: ["Keeper", "claims, splits, signs"],
    C: ["50% liquidity", "FIX6900 Index/SOL pool, permanent"],
    D: ["50% basket", "buy coins, mint units"],
    E: ["Airdrop", "to $FIX6900 holders every 15 min"],
    F: ["Index fees", "0.5% in, 0.5% out, 1% a year"],
    G: ["75% buyback", "buys $FIX6900 with fee SOL"],
    H: ["Burn $FIX6900", "supply reduced"],
  } as const;
  const node = (id: keyof typeof t, x: number, y: number, w: number, h: number, value = ""): N => ({ id, x, y, w, h, title: t[id][0], sub: t[id][1], value });

  const wide = {
    vb: [880, 372] as [number, number],
    nodes: [
      node("A", 0, 98, 220, 68, v.A),
      node("B", 280, 104, 190, 56),
      node("C", 580, 14, 270, 68, v.C),
      node("D", 580, 98, 270, 68, v.D),
      node("E", 580, 192, 270, 68, v.E),
      node("F", 580, 296, 270, 68, v.F),
      node("G", 280, 296, 190, 68, v.G),
      node("H", 0, 296, 220, 68, v.H),
    ],
    edges: [
      { id: "claim", d: "M220,132 H280" },
      { id: "lp", d: "M470,114 C525,114 525,48 580,48" },
      { id: "mint", d: "M470,132 H580" },
      { id: "air", d: "M715,166 V192" },
      { id: "fees", d: "M580,330 H470" },
      { id: "burn", d: "M280,330 H220" },
      { id: "ret", d: "M110,296 V166" },
    ] as E[],
  };
  const tall = {
    vb: [340, 768] as [number, number],
    nodes: [
      node("A", 20, 0, 300, 68, v.A),
      node("B", 20, 96, 300, 56),
      node("C", 20, 192, 300, 68, v.C),
      node("D", 20, 288, 300, 68, v.D),
      node("E", 20, 384, 300, 68, v.E),
      node("F", 20, 500, 300, 68, v.F),
      node("G", 20, 596, 300, 68, v.G),
      node("H", 20, 692, 300, 68, v.H),
    ],
    edges: [
      { id: "claim", d: "M170,68 V96" },
      { id: "lp", d: "M170,152 V192" },
      { id: "mint", d: "M320,124 H334 V322 H321" },
      { id: "air", d: "M170,356 V384" },
      { id: "fees", d: "M170,568 V596" },
      { id: "burn", d: "M170,664 V692" },
      { id: "ret", d: "M20,726 H8 V34 H19" },
    ] as E[],
  };
  // Mid: two columns at 1:1 scale for 640-1179px. The 50/50 split is drawn from the Keeper to both boxes; no arrow joins them.
  const mid = {
    vb: [756, 368] as [number, number],
    nodes: [
      node("A", 16, 0, 340, 68, v.A),
      node("B", 400, 6, 340, 56),
      node("C", 16, 100, 340, 68, v.C),
      node("D", 400, 100, 340, 68, v.D),
      node("E", 400, 200, 340, 68, v.E),
      node("H", 16, 300, 200, 68, v.H),
      node("G", 248, 300, 200, 68, v.G),
      node("F", 470, 300, 270, 68, v.F),
    ],
    edges: [
      { id: "claim", d: "M356,34 H400" },
      { id: "lp", d: "M570,62 V81 H186 V100" },
      { id: "mint", d: "M570,62 V100" },
      { id: "air", d: "M570,168 V200" },
      { id: "fees", d: "M470,334 H449" },
      { id: "burn", d: "M248,334 H217" },
      { id: "ret", d: "M16,334 H8 V34 H15" },
    ] as E[],
  };
  return { wide, tall, mid };
}

function Diagram({ layout, flows, cls }: { layout: ReturnType<typeof build>["wide"]; flows: Flows; cls: string }) {
  const [W, H] = layout.vb;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`loop ${cls}`} role="img" aria-label="Fee flow. $FIX6900 creator fees go to the keeper, which splits them between FIX6900 Index/SOL liquidity and a basket purchase that is airdropped to $FIX6900 holders. Index fees buy back and burn $FIX6900, which lowers $FIX6900 supply and feeds the creator fees again.">
      <defs>
        <marker id={`ak-${cls}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="mk-ink" />
        </marker>
        <marker id={`am-${cls}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="mk-mute" />
        </marker>
      </defs>
      {layout.edges.map((e) => {
        const f = flows[e.id];
        const live = f > 0;
        return <path key={e.id} d={e.d} className={live ? "edge" : "edge edge-zero"} fill="none" markerEnd={`url(#${live ? "ak" : "am"}-${cls})`} />;
      })}
      <g className="dots" aria-hidden>
        {layout.edges.map((e) => {
          const f = flows[e.id];
          if (!(f > 0)) return null;
          const dur = Math.min(8, Math.max(1.5, 10 / (1 + Math.log2(1 + f))));
          return [0, 1, 2].map((i) => (
            <circle key={`${e.id}-${i}`} r="3" className="dot-ink">
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={e.d} begin={`${-(dur * i) / 3}s`} />
            </circle>
          ));
        })}
      </g>
      {layout.nodes.map((n) => (
        <g key={n.id}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} className="node" />
          <text x={n.x + 12} y={n.y + 21} className="node-t">
            {n.title}
          </text>
          <text x={n.x + 12} y={n.y + 38} className="node-s">
            {n.sub}
          </text>
          {n.value && (
            <text x={n.x + 12} y={n.y + 54} className="node-v">
              {n.value}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** The fee loop. Ink dots travel along edges at a speed proportional to that edge's 24h SOL flow. */
export function FeeLoop({ data, flows }: { data?: Flywheel; flows: Flows }) {
  const { wide, tall, mid } = build(data);
  return (
    <figure className="loopfig">
      <Diagram layout={wide} flows={flows} cls="loop-wide" />
      <Diagram layout={mid} flows={flows} cls="loop-mid" />
      <Diagram layout={tall} flows={flows} cls="loop-tall" />
      <figcaption className="faint">Dots move at a speed proportional to each edge&apos;s SOL flow over the last 24 hours. Dashed edges had no flow in that window.</figcaption>
    </figure>
  );
}
