"use client";

import type { Flywheel } from "@/lib/schemas";
import { compact, num } from "@/lib/format";

const TEXT = "#E8EAED";
const MUTED = "#8B919A";
const ACCENT = "#B6FF3B";

/**
 * Sankey-style fee flow. Two sources on the left, four destinations on the right.
 * Band widths scale with live SOL amounts. Muted palette, one accent path (airdrop).
 * Below `sm` the SVG would scale its labels under 11px, so a list renders instead.
 */
export function FeeFlowDiagram({ data, compactMode = false }: { data?: Flywheel; compactMode?: boolean }) {
  const claimed = data?.creatorFeesClaimedSol ?? 0;
  const lp = data?.lpAddedSol ?? claimed * 0.5;
  const airdropSol = Math.max(0, claimed - lp);
  const buyback = data?.buybackSol ?? 0;
  const treasury = data?.treasurySol ?? 0;
  const feeTotal = buyback + treasury || 1;

  const dests = [
    { title: "50% → FI6900/SOL LP", sub: "Meteora", val: `${num(lp, 2)} SOL`, accent: false },
    { title: "50% → create + airdrop", sub: `${compact(data?.airdroppedUnits ?? 0)} units · ${(data?.airdropRounds ?? 0).toLocaleString()} rounds`, val: `${num(airdropSol, 2)} SOL`, accent: true },
    { title: "75% → buy and burn $FI", sub: `${compact(data?.burnedCoin ?? 0)} $FI burned`, val: `${num(buyback, 2)} SOL`, accent: false },
    { title: "25% → treasury", sub: "operations", val: `${num(treasury, 2)} SOL`, accent: false },
  ];

  // --- geometry (grid: labels right-aligned at x0-16, left-aligned at x1+16) ---
  const W = 760;
  const H = compactMode ? 340 : 400;
  const x0 = 200;
  const x1 = 500;
  const maxBand = 60;
  const scale = claimed > 0 ? maxBand / claimed : 0;
  const bandLp = Math.max(6, lp * scale);
  const bandAir = Math.max(6, airdropSol * scale);
  const srcY = 64;
  const lpY = 40;
  // Each destination label block is ~52px tall; keep at least that much pitch.
  const LABEL = 56;
  const airY = lpY + Math.max(bandLp, 0) + LABEL;

  const feeScale = 36 / feeTotal;
  const bandBuy = Math.max(5, buyback * feeScale);
  const bandTre = Math.max(4, treasury * feeScale);
  const feeY = compactMode ? 228 : 268;
  const buyY = feeY - 8;
  const treY = buyY + Math.max(bandBuy, 0) + LABEL;

  const band = (y0: number, h0: number, y1: number, h1: number) => {
    const cx = (x0 + x1) / 2;
    return `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1 + h1} C${cx},${y1 + h1} ${cx},${y0 + h0} ${x0},${y0 + h0} Z`;
  };

  const mono = "var(--font-mono)";
  const disp = "var(--font-display)";

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-auto w-full sm:block" role="img" aria-label="Fee flow from $FI creator fees and index fees to liquidity, airdrops, buybacks and treasury">
        {/* bands */}
        <path d={band(srcY, bandLp, lpY, bandLp)} fill="rgba(232,234,237,0.10)" />
        <path d={band(srcY + bandLp, bandAir, airY, bandAir)} fill="rgba(182,255,59,0.22)" />
        <path d={band(feeY, bandBuy, buyY, bandBuy)} fill="rgba(232,234,237,0.10)" />
        <path d={band(feeY + bandBuy, bandTre, treY, bandTre)} fill="rgba(232,234,237,0.06)" />

        {/* source: creator fees */}
        <rect x={x0 - 6} y={srcY} width="6" height={bandLp + bandAir} fill={TEXT} />
        <text x={x0 - 16} y={srcY + 14} textAnchor="end" fill={TEXT} fontSize="14" fontWeight="600" fontFamily={disp}>
          $FI creator fees
        </text>
        <text x={x0 - 16} y={srcY + 32} textAnchor="end" fill={MUTED} fontSize="12" fontFamily={mono}>
          pump.fun · PumpSwap
        </text>
        <text x={x0 - 16} y={srcY + 50} textAnchor="end" fill={TEXT} fontSize="12" fontFamily={mono}>
          {num(claimed, 2)} SOL
        </text>

        {/* source: index fees */}
        <rect x={x0 - 6} y={feeY} width="6" height={bandBuy + bandTre} fill={MUTED} />
        <text x={x0 - 16} y={feeY + 12} textAnchor="end" fill={TEXT} fontSize="14" fontWeight="600" fontFamily={disp}>
          Index fees
        </text>
        <text x={x0 - 16} y={feeY + 30} textAnchor="end" fill={MUTED} fontSize="12" fontFamily={mono}>
          mint · redeem · 1% mgmt
        </text>
        <text x={x0 - 16} y={feeY + 48} textAnchor="end" fill={TEXT} fontSize="12" fontFamily={mono}>
          {num(buyback + treasury, 2)} SOL
        </text>

        {/* destinations */}
        <Dest x={x1} y={lpY} h={bandLp} {...dests[0]} />
        <Dest x={x1} y={airY} h={bandAir} {...dests[1]} />
        <Dest x={x1} y={buyY} h={bandBuy} {...dests[2]} />
        <Dest x={x1} y={treY} h={bandTre} {...dests[3]} />

        <text x={(x0 + x1) / 2} y={H - 10} textAnchor="middle" fill={MUTED} fontSize="11" fontFamily={mono} letterSpacing="1.5">
          COIN FUNDS THE INDEX · INDEX BURNS THE COIN
        </text>
      </svg>

      {/* Mobile: the same information as a list. */}
      <dl className="divide-y divide-line sm:hidden">
        <Group title="$FI creator fees" sub={`${num(claimed, 2)} SOL · pump.fun · PumpSwap`} items={dests.slice(0, 2)} />
        <Group title="Index fees" sub={`${num(buyback + treasury, 2)} SOL · mint · redeem · 1% mgmt`} items={dests.slice(2)} />
      </dl>
    </>
  );
}

function Dest({ x, y, h, title, sub, val, accent }: { x: number; y: number; h: number; title: string; sub: string; val: string; accent: boolean }) {
  const color = accent ? ACCENT : MUTED;
  return (
    <g>
      <rect x={x} y={y} width="6" height={h} fill={color} />
      <text x={x + 16} y={y + 13} fill={TEXT} fontSize="14" fontWeight="600" fontFamily="var(--font-display)">
        {title}
      </text>
      <text x={x + 16} y={y + 31} fill={MUTED} fontSize="12" fontFamily="var(--font-mono)">
        {sub}
      </text>
      <text x={x + 16} y={y + 49} fill={accent ? ACCENT : TEXT} fontSize="12" fontFamily="var(--font-mono)">
        {val}
      </text>
    </g>
  );
}

function Group({ title, sub, items }: { title: string; sub: string; items: { title: string; sub: string; val: string; accent: boolean }[] }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <dt className="text-sm font-semibold">{title}</dt>
      <dd className="mt-0.5 font-mono text-xs text-muted">{sub}</dd>
      <ul className="mt-3 space-y-2.5">
        {items.map((d) => (
          <li key={d.title} className="flex items-start justify-between gap-4 text-xs">
            <div className="min-w-0">
              <div className="text-text">{d.title}</div>
              <div className="font-mono text-muted">{d.sub}</div>
            </div>
            <span className={`shrink-0 font-mono ${d.accent ? "text-accent" : "text-text"}`}>{d.val}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
