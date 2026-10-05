import type { Governance, Proposal } from "@/lib/schemas";
import { mockGovSummary } from "@/lib/govMock";

/** Demo fixtures for /admin when the keeper is unreachable. Mutations are refused in demo mode. */

const AUTH = "5sg7DB4tgZiCZzHPzTt1c1zPtZYoo59wb8aNkGWnWm7G";

export function mockGovernance(now = Date.now()): Governance {
  const currentSlot = 312_450_000 + Math.floor((now / 400) % 100_000);
  return {
    timelockSlots: "432000",
    pending: [
      {
        pda: "A5YKcaFXBi3LVKNFj8C8juMMQqpDQVjr7LFMzUSn5VXa",
        nonce: "7",
        kind: 7,
        kindName: "add_asset",
        payload: { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hM", targetWeightBps: 250 },
        etaSlot: String(currentSlot + 250_000),
        queuedSlot: String(currentSlot - 182_000),
        proposer: AUTH,
        queuedSig: "3a7m4NMzDWpQLLfiVB3fEuY9r91wdvsX7iFCqJ5Qj1C1sAKmhe1FevhFaYKLnCeaRMfCgfQmCGLpP7B8kSxjxPon",
        due: false,
      },
    ],
    upgradeAuthority: null,
    programDataAddress: "8vSvZadx7aA8Zg5SVrs3ybqA7DJTLWG5qoB58P1bpUfp",
    fundAuthority: AUTH,
    pendingAuthority: null,
    rebalancer: AUTH,
    feeRecipient: AUTH,
    maxAuctionDiscountBps: 500,
    maxRefMoveBps: 2000,
    refMovePeriodSlots: "216000",
    reconstitutionMode: "manual",
    currentSlot: String(currentSlot),
    governance: mockGovSummary(),
  };
}

export function mockProposals(now = Date.now()): Proposal[] {
  const d = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
  return [
    {
      id: "12",
      mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hM",
      symbol: "POPCAT",
      action: "add",
      reason: { source: "methodology", rank: 31, marketCapUsd: 412_000_000, fdvUsd: 412_000_000, volume24hUsd: 38_500_000, avgVolume7dUsd: 29_100_000, sellImpactBps: 41, eligible: true, reasons: [], mintAuthority: null, freezeAuthority: null },
      status: "proposed",
      weightBps: 250,
      proposedTs: d(6),
      decidedTs: null,
      queuedTs: null,
      executedTs: null,
      actionPda: null,
      queuedSig: null,
      note: null,
    },
    {
      id: "11",
      mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5",
      symbol: "MEW",
      action: "remove",
      reason: { source: "methodology", rank: 54, marketCapUsd: 61_000_000, volume24hUsd: 2_100_000, avgVolume7dUsd: 1_900_000, sellImpactBps: 310, eligible: false, reasons: ["price_impact"], mintAuthority: null, freezeAuthority: null },
      status: "proposed",
      weightBps: null,
      proposedTs: d(6),
      decidedTs: null,
      queuedTs: null,
      executedTs: null,
      actionPda: null,
      queuedSig: null,
      note: null,
    },
    {
      id: "9",
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      action: "add",
      reason: { source: "manual", decimals: 5, mintAuthority: null, freezeAuthority: null, force: false },
      status: "queued",
      weightBps: 250,
      proposedTs: d(80),
      decidedTs: d(80),
      queuedTs: d(79),
      executedTs: null,
      actionPda: "A5YKcaFXBi3LVKNFj8C8juMMQqpDQVjr7LFMzUSn5VXa",
      queuedSig: "3a7m4NMzDWpQLLfiVB3fEuY9r91wdvsX7iFCqJ5Qj1C1sAKmhe1FevhFaYKLnCeaRMfCgfQmCGLpP7B8kSxjxPon",
      note: "manual add",
    },
    {
      id: "4",
      mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
      symbol: "BOME",
      action: "add",
      reason: { source: "methodology", rank: 38, marketCapUsd: 180_000_000, volume24hUsd: 12_000_000, sellImpactBps: 95, eligible: true, reasons: [] },
      status: "rejected",
      weightBps: null,
      proposedTs: d(700),
      decidedTs: d(690),
      queuedTs: null,
      executedTs: null,
      actionPda: null,
      queuedSig: null,
      note: "team wallet concentration; revisit next window",
    },
  ];
}
