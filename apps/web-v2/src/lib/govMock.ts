import type { GovEligibility, GovProposal, GovSummary } from "./schemas";

/** Demo fixtures for /governance when the keeper is unreachable. Writes are refused in demo mode. */

const U = 1_000_000; // raw units per $FIX6900 (6 dp)
const SUPPLY = 812_400_000 * U; // circulating snapshot

const w = (seed: string) => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let h = 2166136261;
  let out = "";
  for (let i = 0; i < 44; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619) >>> 0;
    out += A[h % A.length];
  }
  return out;
};

function tally(forU: number, againstU: number, abstainU: number, voters: number, quorumBps = 500): GovProposal["tally"] {
  const part = forU + againstU + abstainU;
  const q = Math.ceil((SUPPLY * quorumBps) / 10_000);
  const bps = (x: number, of: number) => (of > 0 ? Math.round((x * 10_000) / of) : 0);
  return {
    for: String(forU),
    against: String(againstU),
    abstain: String(abstainU),
    participation: String(part),
    voters,
    quorumUnits: String(q),
    quorumReached: part >= q && part > 0,
    majority: forU > againstU,
    passed: part >= q && forU > againstU,
    forBps: bps(forU, part),
    againstBps: bps(againstU, part),
    abstainBps: bps(abstainU, part),
    participationBps: bps(part, SUPPLY),
  };
}

export function mockGovProposals(now = Date.now()): GovProposal[] {
  const h = (n: number) => new Date(now + n * 3_600_000).toISOString();
  const base = { snapshotSupply: String(SUPPLY), snapshotHolders: 4_812, quorumBps: 500, result: null, queuedActionPda: null, queuedSig: null, myVote: null };
  return [
    {
      ...base,
      id: 4,
      kind: "set_param",
      payload: { key: "FEE_BURN_PCT", value: 90 },
      summary: "Set FEE_BURN_PCT = 90",
      title: "Burn 90% of ETF fees",
      description: "Raise the buyback-and-burn share of mint, redeem and management fees from 75% to 90%; the treasury keeps 10%.",
      proposer: w("prop4"),
      createdTs: h(-5),
      snapshotSlot: "312450118",
      startTs: h(-5),
      endTs: h(43),
      status: "open",
      timeLeftSec: 43 * 3600,
      tally: tally(21_400_000 * U, 6_100_000 * U, 0, 9),
    },
    {
      ...base,
      id: 3,
      kind: "add_asset",
      payload: { mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump", symbol: "GOAT", weightBps: 250 },
      summary: "Add GOAT · CzLS…pump · 250 bps",
      title: "Add GOAT to the index",
      description: "GOAT has cleared every eligibility rule for 30 days: authorities revoked, $412M market cap, $38M daily volume, 41 bps impact on a $10k sale. Proposed at the equal weight of 250 bps.",
      proposer: w("prop3"),
      createdTs: h(-20),
      snapshotSlot: "312312007",
      startTs: h(-20),
      endTs: h(28),
      status: "open",
      timeLeftSec: 28 * 3600,
      tally: tally(58_900_000 * U, 9_700_000 * U, 3_200_000 * U, 41),
    },
    {
      ...base,
      id: 2,
      kind: "set_param",
      payload: { key: "rebalance.driftRelativeBps", value: 4000 },
      summary: "Set rebalance.driftRelativeBps = 4000",
      title: "Tighten the drift band to 40%",
      description: "The 50% relative band let small names drift for days between weekly rebalances.",
      proposer: w("prop2"),
      createdTs: h(-80),
      snapshotSlot: "311780400",
      startTs: h(-80),
      endTs: h(-32),
      status: "executed",
      timeLeftSec: 0,
      tally: tally(71_300_000 * U, 12_050_000 * U, 1_000_000 * U, 63),
      result: { reason: "quorum reached and for > against", effective: { key: "rebalance.driftRelativeBps", value: 4000 } },
    },
    {
      ...base,
      id: 1,
      kind: "remove_asset",
      payload: { mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", symbol: "MEW" },
      summary: "Remove MEW · MEW1…cPP5",
      title: "Remove MEW from the index",
      description: "Volume has been below the 24h floor on 9 of the last 14 days.",
      proposer: w("prop1"),
      createdTs: h(-140),
      snapshotSlot: "311241900",
      startTs: h(-140),
      endTs: h(-92),
      status: "failed",
      timeLeftSec: 0,
      tally: tally(12_000_000 * U, 2_000_000 * U, 0, 7),
      result: { reason: "quorum not reached" },
    },
  ];
}

export function mockGovProposal(id: number | string, now = Date.now()): GovProposal {
  const p = mockGovProposals(now).find((x) => String(x.id) === String(id));
  if (!p) throw new Error(`proposal ${id} not found`);
  const votes: GovProposal["votes"] = Array.from({ length: Math.min(8, p.tally.voters) }, (_, i) => ({
    wallet: w(`voter${p.id}-${i}`),
    choice: i % 4 === 3 ? "against" : i === 5 ? "abstain" : "for",
    weight: String(Math.round((Number(p.tally.participation) / Math.max(1, p.tally.voters)) * (1.6 - i * 0.12))),
    ts: new Date(Date.parse(p.startTs) + (i + 1) * 1_800_000).toISOString(),
  }));
  return { ...p, votes };
}

export function mockGovSummary(): GovSummary {
  return {
    enabled: true,
    coinMint: "6nHAaiY8Lvwx5AAbVaxHAZgYkVJHv2cqrt6juHuJtVi5",
    counts: { open: 2, passed: 0, failed: 1, queued: 0, executed: 1, cancelled: 0 },
    params: {
      votingHours: 48,
      quorumBps: 500,
      proposalThresholdBps: 50,
      maxOpenPerWallet: 1,
      allowedParams: [
        { key: "eligibility.minVolume24hUsd", label: "Minimum 24h volume for eligibility", unit: "USD", min: 50_000, max: 2_000_000, integer: true, applies: "methodology eligibility (rule 2)" },
        { key: "rebalance.driftRelativeBps", label: "Relative drift band that opens an interim rebalance", unit: "bps", min: 1000, max: 10_000, integer: true, applies: "rebalancer drift check (rule 5)" },
        { key: "FEE_BURN_PCT", label: "Share of ETF fees used to buy back and burn $FIX6900", unit: "%", min: 0, max: 100, integer: true, applies: "fee processing (hourly)" },
        { key: "flywheel.airdropShareBps", label: "Share of claimed creator fees that goes to the airdrop leg", unit: "bps", min: 0, max: 10_000, integer: true, applies: "flywheel split (every DIST_INTERVAL)" },
      ],
    },
    overrides: { "rebalance.driftRelativeBps": 4000 },
    lastSnapshot: { proposalId: 4, slot: "312450118", supply: String(SUPPLY), holders: 4_812 },
  };
}

export function mockGovEligibility(wallet: string): GovEligibility {
  return { wallet, balance: "0", circulatingSupply: String(SUPPLY), thresholdUnits: String(Math.ceil(SUPPLY * 0.005)), eligible: false, openProposals: 0, maxOpenPerWallet: 1 };
}
