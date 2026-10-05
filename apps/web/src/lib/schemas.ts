import { z } from "zod";

/** Zod schemas mirroring ARCHITECTURE.md §5. Shapes are fixed by contract. */

const numish = z.union([z.number(), z.string()]).transform((v) => (typeof v === "string" ? Number(v) : v));
const strish = z.union([z.string(), z.number()]).transform((v) => String(v));

export const FundSchema = z.object({
  indexMint: z.string(),
  fundPda: z.string(),
  supply: strish, // raw, 6 decimals
  navUsd: numish,
  navPerUnitUsd: numish,
  indexLevel: numish,
  marketPriceUsd: numish.nullable().optional(),
  premiumBps: numish.nullable().optional(),
  fees: z.object({ mintBps: numish, redeemBps: numish, mgmtBps: numish }),
  assetCount: numish,
  epoch: numish,
  openAuctions: numish,
  paused: numish,
});
export type Fund = z.infer<typeof FundSchema>;

export const HoldingSchema = z.object({
  slot: numish,
  mint: z.string(),
  symbol: z.string(),
  name: z.string(),
  logo: z.string().nullable().optional(),
  decimals: numish,
  balance: strish,
  balanceUi: numish,
  priceUsd: numish,
  valueUsd: numish,
  weightBps: numish,
  targetWeightBps: numish,
  driftBps: numish,
  change24hPct: numish.nullable().optional(),
  marketCapUsd: numish.nullable().optional(),
  status: z.union([z.number(), z.string()]).transform((v) => (v === 1 || v === "1" || v === "Removing" || v === "removing" ? "removing" : "active")),
  vault: z.string(),
  verifyUrl: z.string().optional(),
});
export type Holding = z.infer<typeof HoldingSchema>;
export const HoldingsSchema = z.array(HoldingSchema);

export const HistoryPointSchema = z.object({
  t: z.union([z.string(), z.number()]).transform((v) => (typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime())),
  navPerUnitUsd: numish,
  indexLevel: numish,
  marketPriceUsd: numish.nullable().optional(),
  supply: strish.optional(),
  divisorReset: z.boolean().optional(),
});
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;
export const HistorySchema = z.array(HistoryPointSchema);
export type HistoryRange = "1d" | "7d" | "30d" | "all";

export const AuctionFillSchema = z.object({
  sig: z.string(),
  filler: z.string(),
  sellAmount: strish,
  buyAmount: strish,
  price: numish,
  slot: numish,
});
export type AuctionFill = z.infer<typeof AuctionFillSchema>;

const Q64 = 2 ** 64;
/** Q64.64 raw price (buy base units per sell base unit) → UI price (buy tokens per sell token). */
function q64ToUi(raw: string | number, sellDecimals: number, buyDecimals: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return (n / Q64) * 10 ** (sellDecimals - buyDecimals);
}
/** Heuristic: on-chain Q64.64 values are astronomically larger than any UI price. */
const looksQ64 = (v: string | number) => Number(v) > 1e12;

const RawAuctionSchema = z.object({
  pda: z.string(),
  sellMint: z.string(),
  buyMint: z.string(),
  sellRemaining: strish,
  sellTotal: strish,
  startPrice: numish,
  endPrice: numish,
  currentPrice: numish,
  startSlot: numish,
  endSlot: numish,
  status: z.union([z.number(), z.string()]).transform((v) => {
    const m: Record<string, "open" | "filled" | "cancelled" | "expired"> = { "0": "open", "1": "filled", "2": "cancelled", "3": "expired" };
    const s = String(v).toLowerCase();
    return m[s] ?? (s as "open" | "filled" | "cancelled" | "expired");
  }),
  fills: z.array(AuctionFillSchema).default([]),
  // optional enrichment the keeper may add
  sellSymbol: z.string().optional(),
  buySymbol: z.string().optional(),
  sellDecimals: numish.optional(),
  buyDecimals: numish.optional(),
  startPriceUi: numish.optional(),
  endPriceUi: numish.optional(),
  currentPriceUi: numish.optional(),
  jupiterMidPrice: numish.nullable().optional(),
  currentSlot: numish.optional(),
});

/** Normalises every price field to a UI price (buy tokens per sell token). */
export const AuctionSchema = RawAuctionSchema.transform((a) => {
  const sd = a.sellDecimals ?? 6;
  const bd = a.buyDecimals ?? 6;
  const ui = (raw: number, pre?: number) => (pre !== undefined ? pre : looksQ64(raw) ? q64ToUi(raw, sd, bd) : raw);
  return {
    ...a,
    startPrice: ui(a.startPrice, a.startPriceUi),
    endPrice: ui(a.endPrice, a.endPriceUi),
    currentPrice: ui(a.currentPrice, a.currentPriceUi),
    fills: a.fills.map((f) => ({ ...f, price: looksQ64(f.price) ? q64ToUi(f.price, sd, bd) : f.price })),
  };
});
export type Auction = z.infer<typeof AuctionSchema>;
export const AuctionsSchema = z.array(AuctionSchema);

export const FlywheelSchema = z.object({
  coinMint: z.string(),
  creatorFeesClaimedSol: numish,
  lpAddedSol: numish,
  airdroppedUnits: numish,
  airdropRounds: numish,
  buybackSol: numish,
  burnedCoin: numish,
  treasurySol: numish,
  next: z.object({
    airdropAt: z.string().nullable(),
    rebalanceCheckAt: z.string().nullable(),
    scheduledRebalanceAt: z.string().nullable().optional(),
  }),
});
export type Flywheel = z.infer<typeof FlywheelSchema>;

export const EventKind = z.enum(["claim", "buy_index", "add_lp", "airdrop", "buyback", "burn", "create", "redeem", "auction_start", "auction_fill", "fee_accrual"]);
export type EventKind = z.infer<typeof EventKind>;

export const FlywheelEventSchema = z.object({
  id: strish,
  kind: EventKind,
  ts: z.string(),
  sig: z.string().nullable(),
  amounts: z.record(z.union([z.number(), z.string()])).default({}),
  note: z.string().nullable().optional(),
});
export type FlywheelEvent = z.infer<typeof FlywheelEventSchema>;
export const FlywheelEventsSchema = z.array(FlywheelEventSchema);

export const AirdropSchema = z.object({ roundId: strish, ts: z.string(), units: numish, sig: z.string() });
export type Airdrop = z.infer<typeof AirdropSchema>;
export const AirdropsSchema = z.array(AirdropSchema);

export const MethodologySchema = z.object({
  config: z.record(z.unknown()),
  lastRun: z
    .object({
      ts: z.string(),
      eligible: z.array(z.union([z.string(), z.object({ mint: z.string(), symbol: z.string().optional(), marketCapUsd: numish.optional() })])),
      selected: z.array(z.union([z.string(), z.object({ mint: z.string(), symbol: z.string().optional(), marketCapUsd: numish.optional() })])),
      weights: z.array(z.union([z.number(), z.object({ mint: z.string(), symbol: z.string().optional(), weightBps: numish })])),
    })
    .nullable(),
  nextReconstitution: z.string().nullable(),
});
export type Methodology = z.infer<typeof MethodologySchema>;

export const AnnouncementSchema = z.object({ ts: z.string(), title: z.string(), body: z.string() });
export type Announcement = z.infer<typeof AnnouncementSchema>;
export const AnnouncementsSchema = z.array(AnnouncementSchema);

export const VerifySchema = z.object({
  fundPda: z.string(),
  indexMint: z.string(),
  mintAuthority: z.string(),
  vaults: z.array(z.object({ mint: z.string(), vault: z.string(), owner: z.string(), amount: strish, symbol: z.string().optional(), decimals: numish.optional() })),
  lookupTable: z.string().nullable(),
  programId: z.string(),
  idlHash: z.string().nullable(),
  // governance additions (ARCHITECTURE §5): BPF upgradeable loader ProgramData + upgrade authority (null once burned)
  programDataAddress: z.string().nullable().optional(),
  upgradeAuthority: z.string().nullable().optional(),
});
export type Verify = z.infer<typeof VerifySchema>;

export const QuoteCreateSchema = z.object({
  basket: z.array(z.object({ mint: z.string(), amount: strish, symbol: z.string().optional(), decimals: numish.optional() })),
  estCostSol: numish,
  estNavUsd: numish,
});
export type QuoteCreate = z.infer<typeof QuoteCreateSchema>;

export const QuoteRedeemSchema = z.object({
  basket: z.array(z.object({ mint: z.string(), amount: strish, symbol: z.string().optional(), decimals: numish.optional() })),
  estValueUsd: numish,
});
export type QuoteRedeem = z.infer<typeof QuoteRedeemSchema>;

export const EnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown(), asOf: z.string().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/* ------------------------------------------------------------------ */
/* Governance / index committee (ARCHITECTURE §5: /v1/governance,      */
/* /v1/proposals, POST /v1/admin/*)                                     */
/* ------------------------------------------------------------------ */

export const PendingActionSchema = z.object({
  pda: z.string(),
  nonce: strish,
  kind: numish,
  kindName: z.string(),
  payload: z.record(z.unknown()).default({}),
  etaSlot: strish,
  queuedSlot: strish,
  proposer: z.string(),
  queuedSig: z.string().nullable().optional(),
  due: z.boolean().optional(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const GovernanceSchema = z.object({
  timelockSlots: strish,
  pending: z.array(PendingActionSchema).default([]),
  upgradeAuthority: z.string().nullable(),
  programDataAddress: z.string().nullable().optional(),
  fundAuthority: z.string(),
  pendingAuthority: z.string().nullable().optional(),
  rebalancer: z.string(),
  feeRecipient: z.string(),
  maxAuctionDiscountBps: numish,
  maxRefMoveBps: numish.optional(),
  refMovePeriodSlots: strish.optional(),
  reconstitutionMode: z.enum(["manual", "auto"]).optional(),
  currentSlot: strish,
});
export type Governance = z.infer<typeof GovernanceSchema>;

export const ProposalStatus = z.enum(["proposed", "approved", "rejected", "queued", "executed"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const ProposalSchema = z.object({
  id: strish,
  mint: z.string(),
  symbol: z.string().nullable().optional(),
  action: z.enum(["add", "remove"]),
  reason: z.record(z.unknown()).default({}),
  status: ProposalStatus,
  weightBps: numish.nullable().optional(),
  proposedTs: z.string(),
  decidedTs: z.string().nullable().optional(),
  queuedTs: z.string().nullable().optional(),
  executedTs: z.string().nullable().optional(),
  actionPda: z.string().nullable().optional(),
  queuedSig: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export const ProposalsSchema = z.array(ProposalSchema);

/** Result of queueing approved proposals through the timelock (keeper governance/reconstitution.ts). */
export const QueueApprovedResultSchema = z.object({
  queued: z.array(z.object({ mint: z.string(), action: z.string(), pda: z.string(), sig: z.string() })).default([]),
  weightActions: z.array(z.object({ mint: z.string(), targetWeightBps: numish, pda: z.string(), sig: z.string().optional() })).default([]),
  skipped: z.array(z.string()).default([]),
});
export type QueueApprovedResult = z.infer<typeof QueueApprovedResultSchema>;

/** approve / add-asset / remove-asset return the proposal plus what was queued (null unless immediate). */
export const AdminProposalResultSchema = z.object({ proposal: ProposalSchema, queued: QueueApprovedResultSchema.nullable().optional() });
export type AdminProposalResult = z.infer<typeof AdminProposalResultSchema>;
/** reject returns the bare proposal; normalised to the same shape for the UI. */
export const AdminRejectResultSchema = ProposalSchema.transform((p): AdminProposalResult => ({ proposal: p, queued: null }));
