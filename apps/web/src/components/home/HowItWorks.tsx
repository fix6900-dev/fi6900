import Link from "next/link";
import { SectionHeader } from "../ui/Card";

const STEPS = [
  {
    n: "01",
    title: "Methodology",
    body: "Eligible memecoins (revoked authorities, 14 days old, $2M FDV, real volume and depth) are ranked by market cap. The top 40 are held at equal weight and brought back to target weekly through Dutch auctions.",
    href: "/methodology",
    cta: "Read the rules",
  },
  {
    n: "02",
    title: "In-kind creation and redemption",
    body: "Anyone can deliver the basket to the vault and mint units, or burn units and withdraw their pro-rata slice of every constituent. Units are claims on the vault, not an IOU.",
    href: "/create",
    cta: "Open the AP console",
  },
  {
    n: "03",
    title: "Arbitrage keeps the peg",
    body: "Above NAV, arbitrageurs create units and sell them. Below NAV, they buy units and redeem. The keeper runs this loop; so can you.",
    href: "/buy",
    cta: "See premium / discount",
  },
];

export function HowItWorks() {
  return (
    <section className="wrap section pt-0">
      <SectionHeader eyebrow="How it works" title="Three mechanisms. The same three SPY uses." desc="A methodology, an in-kind creation and redemption facility, and the arbitrage that follows. FI6900 implements all three in one Solana program." />
      <div className="grid gap-px overflow-hidden rounded-lg bg-line hairline lg:grid-cols-[1.1fr_1fr]">
        {/* The diagram needs ~560px to keep its labels legible; below md the steps carry the explanation. */}
        <div className="hidden bg-surface p-6 md:block">
          <Diagram />
        </div>
        <ol className="grid divide-y divide-line bg-surface">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-5 p-6">
              <span className="num mt-0.5 font-mono text-xs text-muted">{s.n}</span>
              <div>
                <h3 className="text-base font-semibold tracking-[-0.01em]">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
                <Link href={s.href} className="mt-3 inline-block text-[13px] font-medium text-text hover:text-accent">
                  {s.cta} →
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Vault in the middle, AP on the left, market on the right. Grid: boxes sit on
 * y=160..260, loops on y=70 / y=350. One accent path (units leaving the vault).
 */
function Diagram() {
  const t = "#E8EAED";
  const m = "#8B919A";
  const acc = "#B6FF3B";
  const mono = "var(--font-mono)";
  const disp = "var(--font-display)";
  return (
    <svg viewBox="0 0 560 420" className="h-auto w-full" role="img" aria-label="Diagram of in-kind creation, redemption and arbitrage">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={m} />
        </marker>
        <marker id="arr-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={acc} />
        </marker>
      </defs>

      {/* Vault */}
      <rect x="200" y="160" width="160" height="100" rx="8" fill="#16191E" stroke="rgba(255,255,255,0.12)" />
      <text x="280" y="202" textAnchor="middle" fill={t} fontSize="14" fontWeight="600" fontFamily={disp}>
        Fund vault
      </text>
      <text x="280" y="222" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        40 PDA-owned accounts
      </text>
      <text x="280" y="240" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        equal weight
      </text>

      {/* AP */}
      <rect x="20" y="170" width="120" height="80" rx="8" fill="#111317" stroke="rgba(255,255,255,0.12)" />
      <text x="80" y="206" textAnchor="middle" fill={t} fontSize="14" fontWeight="600" fontFamily={disp}>
        Participant
      </text>
      <text x="80" y="226" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        anyone
      </text>

      {/* Market */}
      <rect x="420" y="170" width="120" height="80" rx="8" fill="#111317" stroke="rgba(255,255,255,0.12)" />
      <text x="480" y="206" textAnchor="middle" fill={t} fontSize="14" fontWeight="600" fontFamily={disp}>
        Market
      </text>
      <text x="480" y="226" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        price ≈ NAV
      </text>

      {/* AP ⇄ vault */}
      <path d="M140 196 L200 196" fill="none" stroke={m} strokeWidth="1.25" markerEnd="url(#arr)" />
      <text x="170" y="188" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        basket
      </text>
      <path d="M200 224 L140 224" fill="none" stroke={acc} strokeWidth="1.25" markerEnd="url(#arr-acc)" />
      <text x="170" y="242" textAnchor="middle" fill={acc} fontSize="11" fontFamily={mono}>
        units
      </text>

      {/* Arbitrage loops */}
      <path d="M80 170 C 80 70, 480 70, 480 170" fill="none" stroke={m} strokeWidth="1.25" markerEnd="url(#arr)" />
      <rect x="186" y="78" width="188" height="22" rx="4" fill="#0A0B0D" />
      <text x="280" y="93" textAnchor="middle" fill={t} fontSize="11" fontFamily={mono}>
        price &gt; NAV → create, sell
      </text>
      <path d="M480 250 C 480 350, 80 350, 80 250" fill="none" stroke={m} strokeWidth="1.25" markerEnd="url(#arr)" />
      <rect x="186" y="320" width="188" height="22" rx="4" fill="#0A0B0D" />
      <text x="280" y="335" textAnchor="middle" fill={t} fontSize="11" fontFamily={mono}>
        price &lt; NAV → buy, redeem
      </text>

      {/* Rebalance */}
      <path d="M280 396 L280 262" fill="none" stroke={m} strokeWidth="1.25" markerEnd="url(#arr)" strokeDasharray="3 3" />
      <text x="280" y="412" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono}>
        Dutch auctions rebalance the vault
      </text>
      <text x="280" y="40" textAnchor="middle" fill={m} fontSize="11" fontFamily={mono} letterSpacing="1.5">
        ARBITRAGE
      </text>
    </svg>
  );
}
