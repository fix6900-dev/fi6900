"use client";

import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { z } from "zod";
import { env } from "./env";
import * as mock from "./mock";
import {
  AirdropsSchema, AnnouncementsSchema, AuctionsSchema, EnvelopeSchema, FlywheelEventsSchema, FlywheelSchema, FundSchema, HistorySchema, HoldingsSchema, MethodologySchema, QuoteCreateSchema, QuoteRedeemSchema, VerifySchema,
  type Airdrop, type Announcement, type Auction, type Flywheel, type FlywheelEvent, type Fund, type HistoryPoint, type HistoryRange, type Holding, type Methodology, type QuoteCreate, type QuoteRedeem, type Verify,
} from "./schemas";

/* ------------------------------------------------------------------ */
/* Demo-mode store: flips on when the API is unreachable.              */
/* ------------------------------------------------------------------ */

type DemoState = { demo: boolean; checked: boolean; lastError: string | null };
let demoState: DemoState = { demo: false, checked: false, lastError: null };
const listeners = new Set<() => void>();

function setDemo(next: Partial<DemoState>) {
  demoState = { ...demoState, ...next };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const SERVER_SNAPSHOT: DemoState = { demo: false, checked: false, lastError: null };
export function useDemoMode(): DemoState {
  return useSyncExternalStore(subscribe, () => demoState, () => SERVER_SNAPSHOT);
}
export function isDemo() {
  return demoState.demo;
}

/* ------------------------------------------------------------------ */
/* Fetch with envelope + zod + mock fallback                           */
/* ------------------------------------------------------------------ */

/** UI units (e.g. 100) -> raw index units with 6 decimals, as a decimal string for the query string. */
function toRawUnits(units: number): string {
  return BigInt(Math.round(units * 1e6)).toString();
}

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function rawGet<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.apiUrl}${path}`, { signal: ctrl.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    const json = await res.json();
    const env_ = EnvelopeSchema.safeParse(json);
    const payload = env_.success ? (env_.data.ok ? env_.data.data : null) : json;
    if (env_.success && !env_.data.ok) throw new ApiError(env_.data.error);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ApiError(`Bad shape for ${path}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch from the keeper; on a network-level failure switch to demo fixtures. */
async function get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: () => T): Promise<T> {
  // Once we know the API is down, don't hammer it on every query; re-probe lazily via ping().
  if (demoState.demo) return fallback();
  try {
    const data = await rawGet(path, schema);
    if (!demoState.checked) setDemo({ checked: true });
    return data;
  } catch (e) {
    const err = e as Error & { status?: number };
    // Shape errors / 5xx from a live API are real errors and should surface; connection failures → demo.
    const isNetwork = err.name === "AbortError" || err.name === "TypeError" || /fetch|network|ECONN/i.test(err.message);
    if (isNetwork) {
      setDemo({ demo: true, checked: true, lastError: err.message });
      return fallback();
    }
    throw err;
  }
}

/** Periodically re-probe the API when in demo mode so we recover automatically. */
export async function ping(): Promise<boolean> {
  try {
    await rawGet("/v1/fund", FundSchema, 2500);
    if (demoState.demo) setDemo({ demo: false, lastError: null });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Typed fetchers (ARCHITECTURE §5)                                     */
/* ------------------------------------------------------------------ */

export const api = {
  fund: () => get("/v1/fund", FundSchema, () => mock.mockFund()),
  holdings: () => get("/v1/holdings", HoldingsSchema, () => mock.mockHoldings()),
  history: (range: HistoryRange) => get(`/v1/history?range=${range}`, HistorySchema, () => mock.mockHistory(range)),
  auctions: (status: "open" | "all" = "all") =>
    get(`/v1/auctions?status=${status}`, AuctionsSchema, () => mock.mockAuctions().filter((a) => status === "all" || a.status === "open")),
  flywheel: () => get("/v1/flywheel", FlywheelSchema, () => mock.mockFlywheel()),
  flywheelEvents: (limit = 50, cursor?: string) =>
    get(`/v1/flywheel/events?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, FlywheelEventsSchema, () => mock.mockEvents(limit)),
  airdrops: (wallet: string) => get(`/v1/airdrops/${encodeURIComponent(wallet)}`, AirdropsSchema, () => mock.mockAirdrops(wallet)),
  methodology: () => get("/v1/methodology", MethodologySchema, () => mock.mockMethodology()),
  announcements: () => get("/v1/announcements", AnnouncementsSchema, () => mock.mockAnnouncements()),
  verify: () => get("/v1/verify", VerifySchema, () => mock.mockVerify()),
  // The keeper takes raw units (6 decimals); the UI works in whole units.
  quoteCreate: (units: number) => get(`/v1/quote/create?units=${toRawUnits(units)}`, QuoteCreateSchema, () => mock.mockQuoteCreate(units)),
  quoteRedeem: (units: number) => get(`/v1/quote/redeem?units=${toRawUnits(units)}`, QuoteRedeemSchema, () => mock.mockQuoteRedeem(units)),
};

/* ------------------------------------------------------------------ */
/* Query keys + hooks                                                   */
/* ------------------------------------------------------------------ */

export const qk = {
  fund: ["fund"] as const,
  holdings: ["holdings"] as const,
  history: (r: HistoryRange) => ["history", r] as const,
  auctions: (s: "open" | "all") => ["auctions", s] as const,
  flywheel: ["flywheel"] as const,
  events: (limit: number) => ["flywheel-events", limit] as const,
  airdrops: (w: string) => ["airdrops", w] as const,
  methodology: ["methodology"] as const,
  announcements: ["announcements"] as const,
  verify: ["verify"] as const,
  quoteCreate: (u: number) => ["quote", "create", u] as const,
  quoteRedeem: (u: number) => ["quote", "redeem", u] as const,
};

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export function useFund(opts?: Opts<Fund>) {
  return useQuery({ queryKey: qk.fund, queryFn: api.fund, staleTime: 10_000, refetchInterval: 15_000, ...opts });
}
export function useHoldings(opts?: Opts<Holding[]>) {
  return useQuery({ queryKey: qk.holdings, queryFn: api.holdings, staleTime: 10_000, refetchInterval: 20_000, ...opts });
}
export function useHistory(range: HistoryRange, opts?: Opts<HistoryPoint[]>) {
  return useQuery({ queryKey: qk.history(range), queryFn: () => api.history(range), staleTime: 60_000, ...opts });
}
export function useAuctions(status: "open" | "all" = "all", opts?: Opts<Auction[]>) {
  return useQuery({ queryKey: qk.auctions(status), queryFn: () => api.auctions(status), staleTime: 5_000, refetchInterval: 10_000, ...opts });
}
export function useFlywheel(opts?: Opts<Flywheel>) {
  return useQuery({ queryKey: qk.flywheel, queryFn: api.flywheel, staleTime: 15_000, refetchInterval: 30_000, ...opts });
}
export function useFlywheelEvents(limit = 50, opts?: Opts<FlywheelEvent[]>) {
  return useQuery({ queryKey: qk.events(limit), queryFn: () => api.flywheelEvents(limit), staleTime: 15_000, refetchInterval: 30_000, ...opts });
}
export function useAirdrops(wallet: string | null, opts?: Opts<Airdrop[]>) {
  return useQuery({ queryKey: qk.airdrops(wallet ?? ""), queryFn: () => api.airdrops(wallet!), enabled: !!wallet && wallet.length >= 32, staleTime: 30_000, ...opts });
}
export function useMethodology(opts?: Opts<Methodology>) {
  return useQuery({ queryKey: qk.methodology, queryFn: api.methodology, staleTime: 5 * 60_000, ...opts });
}
export function useAnnouncements(opts?: Opts<Announcement[]>) {
  return useQuery({ queryKey: qk.announcements, queryFn: api.announcements, staleTime: 5 * 60_000, ...opts });
}
export function useVerify(opts?: Opts<Verify>) {
  return useQuery({ queryKey: qk.verify, queryFn: api.verify, staleTime: 60_000, ...opts });
}
export function useQuoteCreate(units: number, opts?: Opts<QuoteCreate>) {
  return useQuery({ queryKey: qk.quoteCreate(units), queryFn: () => api.quoteCreate(units), enabled: units > 0, staleTime: 10_000, ...opts });
}
export function useQuoteRedeem(units: number, opts?: Opts<QuoteRedeem>) {
  return useQuery({ queryKey: qk.quoteRedeem(units), queryFn: () => api.quoteRedeem(units), enabled: units > 0, staleTime: 10_000, ...opts });
}

/** Helper to look up a holding by mint from the cache (used by auctions / create). */
export function useHoldingLookup() {
  const qc = useQueryClient();
  const { data } = useHoldings();
  return (mint: string): Holding | undefined => (data ?? qc.getQueryData<Holding[]>(qk.holdings))?.find((h) => h.mint === mint);
}

/* ------------------------------------------------------------------ */
/* Governance / index committee (/admin)                                */
/* ------------------------------------------------------------------ */

import { useMutation } from "@tanstack/react-query";
import { mockGovernance, mockProposals } from "@/components/admin/mock";
import {
  AdminProposalResultSchema, AdminRejectResultSchema, GovernanceSchema, ProposalsSchema,
  type AdminProposalResult, type Governance, type Proposal, type ProposalStatus,
} from "./schemas";

export const governanceApi = {
  governance: () => get("/v1/governance", GovernanceSchema, () => mockGovernance()),
  proposals: (status?: ProposalStatus) =>
    get(`/v1/proposals${status ? `?status=${status}` : ""}`, ProposalsSchema, () => mockProposals().filter((p) => !status || p.status === status)),
};

export const governanceQk = {
  governance: ["governance"] as const,
  proposals: (s: ProposalStatus | "all") => ["proposals", s] as const,
};

export function useGovernance(opts?: Opts<Governance>) {
  return useQuery({ queryKey: governanceQk.governance, queryFn: governanceApi.governance, staleTime: 10_000, refetchInterval: 15_000, ...opts });
}
export function useProposals(status?: ProposalStatus, opts?: Opts<Proposal[]>) {
  return useQuery({ queryKey: governanceQk.proposals(status ?? "all"), queryFn: () => governanceApi.proposals(status), staleTime: 10_000, refetchInterval: 20_000, ...opts });
}

/** Admin API failure. `status` 401 = token rejected, 403 = ADMIN_TOKEN unset on the keeper, 503 = mock mode, 400 = validation. */
export class AdminError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** POST to /v1/admin/*. The token is passed per call, only ever placed in the Authorization header, and never logged. */
async function adminPost<T>(path: string, token: string, body: Record<string, unknown>, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  if (demoState.demo) throw new AdminError("keeper unreachable — admin actions are unavailable in demo mode", 0);
  // Immediate approvals send on-chain transactions and can take tens of seconds; cap at 2 minutes so a stuck request cannot hang the UI.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = e as Error;
    throw new AdminError(err.name === "AbortError" ? "timed out after 120 s waiting for the keeper; check /v1/proposals for the outcome" : `network error: ${err.message}`, 0);
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  const env_ = EnvelopeSchema.safeParse(json);
  if (!res.ok || (env_.success && !env_.data.ok)) {
    const msg = env_.success && !env_.data.ok ? env_.data.error : `HTTP ${res.status}`;
    throw new AdminError(msg, res.status);
  }
  const payload = env_.success && env_.data.ok ? env_.data.data : json;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AdminError(`Bad shape for ${path}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, res.status);
  return parsed.data;
}

export type ApproveInput = { mint: string; weightBps?: number; immediate?: boolean };
export type RejectInput = { mint: string; note?: string };
export type AssetInput = { mint: string; action?: "add" | "remove"; weightBps?: number; immediate?: boolean; force?: boolean };

/**
 * Mutations against POST /v1/admin/*. `getToken` is read at call time so the token never lives in a
 * query key or closure that could be serialised. Every success invalidates proposals + governance.
 */
export function useAdminMutations(getToken: () => string | null) {
  const qc = useQueryClient();
  const token = () => {
    const t = getToken()?.trim();
    if (!t) throw new AdminError("admin token required", 401);
    return t;
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["proposals"] });
    void qc.invalidateQueries({ queryKey: governanceQk.governance });
  };
  const approve = useMutation<AdminProposalResult, AdminError, ApproveInput>({
    mutationFn: ({ mint, weightBps, immediate }) =>
      adminPost(`/v1/admin/proposals/${encodeURIComponent(mint)}/approve`, token(), { ...(weightBps != null ? { weightBps } : {}), immediate: immediate === true }, AdminProposalResultSchema),
    onSuccess: refresh,
  });
  const reject = useMutation<AdminProposalResult, AdminError, RejectInput>({
    mutationFn: ({ mint, note }) => adminPost(`/v1/admin/proposals/${encodeURIComponent(mint)}/reject`, token(), note ? { note } : {}, AdminRejectResultSchema),
    onSuccess: refresh,
  });
  const asset = useMutation<AdminProposalResult, AdminError, AssetInput>({
    mutationFn: ({ mint, action, weightBps, immediate, force }) =>
      adminPost("/v1/admin/assets", token(), { mint, action: action ?? "add", ...(weightBps != null ? { weightBps } : {}), immediate: immediate === true, force: force === true }, AdminProposalResultSchema),
    onSuccess: refresh,
  });
  return { approve, reject, asset, refresh };
}
