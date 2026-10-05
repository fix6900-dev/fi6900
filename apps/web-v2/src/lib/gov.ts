"use client";

/**
 * Holder governance client (docs/governance.md). Reads go through the keeper envelope + zod like everything
 * else; writes are signed with the connected wallet's `signMessage` over the canonical messages below, which
 * mirror apps/keeper/src/governance/voting.ts byte for byte:
 *
 *   propose:  `FIX6900 governance: propose <sha256 hex of canonical JSON {kind, payload, title, description, proposer}>`
 *   vote:     `FIX6900 governance: vote <for|against|abstain> on proposal <id> (snapshot slot <slot>)`
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import type { z } from "zod";
import { env } from "./env";
import { base58Encode } from "./burnerWallet";
import { isDemo } from "./api";
import { EnvelopeSchema, GovEligibilitySchema, GovProposalSchema, GovProposalsSchema, type GovChoice, type GovEligibility, type GovKind, type GovProposal } from "./schemas";
import { mockGovEligibility, mockGovProposal, mockGovProposals } from "./govMock";

/* ------------------------------------------------------------------ */
/* Canonical messages                                                   */
/* ------------------------------------------------------------------ */

export const GOV_MESSAGE_PREFIX = "FIX6900 governance: ";

export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonical JSON: non-finite number");
    return JSON.stringify(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON: unsupported type ${typeof v}`);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ProposalDraft {
  kind: GovKind;
  payload: Record<string, unknown>;
  title: string;
  description: string;
  proposer: string;
}

export async function proposeMessage(d: ProposalDraft): Promise<string> {
  const body = canonicalJson({ kind: d.kind, payload: d.payload, title: d.title, description: d.description, proposer: d.proposer });
  return `${GOV_MESSAGE_PREFIX}propose ${await sha256Hex(body)}`;
}

export function voteMessage(choice: GovChoice, proposalId: number | string, snapshotSlot: string | number): string {
  return `${GOV_MESSAGE_PREFIX}vote ${choice} on proposal ${proposalId} (snapshot slot ${snapshotSlot})`;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */

export class GovError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function govFetch<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, { ...init, signal: ctrl.signal, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) }, cache: "no-store" });
  } catch (e) {
    const err = e as Error;
    throw new GovError(err.name === "AbortError" ? "timed out waiting for the keeper" : `network error: ${err.message}`, 0);
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
  if (!res.ok || (env_.success && !env_.data.ok)) throw new GovError(env_.success && !env_.data.ok ? env_.data.error : `HTTP ${res.status}`, res.status);
  const payload = env_.success && env_.data.ok ? env_.data.data : json;
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new GovError(`Bad shape for ${path}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, res.status);
  return parsed.data;
}

/** Reads fall back to demo fixtures when the keeper is unreachable (same rule as lib/api.ts). */
async function govGet<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: () => T): Promise<T> {
  if (isDemo()) return fallback();
  try {
    return await govFetch(path, schema);
  } catch (e) {
    const err = e as GovError;
    if (err.status === 0) return fallback();
    throw err;
  }
}

export const govApi = {
  proposals: (status?: string, wallet?: string | null) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (wallet) q.set("wallet", wallet);
    const qs = q.toString();
    return govGet(`/v1/governance/proposals${qs ? `?${qs}` : ""}`, GovProposalsSchema, () => mockGovProposals().filter((p) => !status || p.status === status));
  },
  proposal: (id: number | string, wallet?: string | null) => govGet(`/v1/governance/proposals/${encodeURIComponent(String(id))}${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`, GovProposalSchema, () => mockGovProposal(id)),
  eligibility: (wallet: string) => govGet(`/v1/governance/eligibility?wallet=${encodeURIComponent(wallet)}`, GovEligibilitySchema, () => mockGovEligibility(wallet)),
  vote: (id: number | string, body: { wallet: string; choice: GovChoice; message: string; signature: string }) =>
    govFetch(`/v1/governance/proposals/${encodeURIComponent(String(id))}/vote`, GovProposalSchema, { method: "POST", body: JSON.stringify(body) }),
  propose: (body: ProposalDraft & { message: string; signature: string }) => govFetch("/v1/governance/proposals", GovProposalSchema, { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: number | string, token: string, note?: string) =>
    govFetch(`/v1/admin/governance/proposals/${encodeURIComponent(String(id))}/cancel`, GovProposalSchema, { method: "POST", body: JSON.stringify(note ? { note } : {}), headers: { authorization: `Bearer ${token}` } }),
};

/* ------------------------------------------------------------------ */
/* Hooks                                                                */
/* ------------------------------------------------------------------ */

export const govQk = {
  proposals: (status: string, wallet: string) => ["gov", "proposals", status, wallet] as const,
  proposal: (id: string, wallet: string) => ["gov", "proposal", id, wallet] as const,
  eligibility: (wallet: string) => ["gov", "eligibility", wallet] as const,
};

type Opts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export function useGovProposals(status?: string, wallet?: string | null, opts?: Opts<GovProposal[]>) {
  return useQuery({ queryKey: govQk.proposals(status ?? "all", wallet ?? ""), queryFn: () => govApi.proposals(status, wallet), staleTime: 10_000, refetchInterval: 20_000, ...opts });
}
export function useGovProposal(id: string | number | null, wallet?: string | null, opts?: Opts<GovProposal>) {
  return useQuery({ queryKey: govQk.proposal(String(id ?? ""), wallet ?? ""), queryFn: () => govApi.proposal(id!, wallet), enabled: id != null && id !== "", staleTime: 5_000, refetchInterval: 15_000, ...opts });
}
export function useGovEligibility(wallet: string | null | undefined, opts?: Opts<GovEligibility>) {
  return useQuery({ queryKey: govQk.eligibility(wallet ?? ""), queryFn: () => govApi.eligibility(wallet!), enabled: !!wallet, staleTime: 30_000, ...opts });
}

/** The connected wallet's base58 address, or null. */
export function useWalletAddress(): string | null {
  const { publicKey } = useWallet();
  return publicKey?.toBase58() ?? null;
}

function encodeSig(sig: Uint8Array): string {
  return base58Encode(sig);
}

/**
 * Vote: signs the canonical message with the connected wallet (wallet-adapter `signMessage`) and posts it.
 * The wallet never signs a transaction; nothing is sent on-chain.
 */
export function useGovVote(proposal: GovProposal | undefined) {
  const qc = useQueryClient();
  const { publicKey, signMessage } = useWallet();
  return useMutation<GovProposal, GovError, GovChoice>({
    mutationFn: async (choice) => {
      if (!proposal) throw new GovError("proposal not loaded");
      if (!publicKey) throw new GovError("connect a wallet to vote");
      if (!signMessage) throw new GovError("this wallet cannot sign messages; use Phantom, Solflare or Backpack");
      if (isDemo()) throw new GovError("keeper unreachable; voting is unavailable in demo mode");
      const message = voteMessage(choice, proposal.id, proposal.snapshotSlot);
      const sig = await signMessage(new TextEncoder().encode(message));
      return govApi.vote(proposal.id, { wallet: publicKey.toBase58(), choice, message, signature: encodeSig(sig) });
    },
    onSuccess: (data) => {
      qc.setQueryData(govQk.proposal(String(data.id), publicKey?.toBase58() ?? ""), data);
      void qc.invalidateQueries({ queryKey: ["gov"] });
    },
  });
}

export type ProposeInput = { kind: GovKind; payload: Record<string, unknown>; title: string; description: string };

/** New proposal: signs `propose <sha256>` with the connected wallet and posts the draft. */
export function useGovPropose() {
  const qc = useQueryClient();
  const { publicKey, signMessage } = useWallet();
  return useMutation<GovProposal, GovError, ProposeInput>({
    mutationFn: async (input) => {
      if (!publicKey) throw new GovError("connect a wallet to propose");
      if (!signMessage) throw new GovError("this wallet cannot sign messages; use Phantom, Solflare or Backpack");
      if (isDemo()) throw new GovError("keeper unreachable; proposals are unavailable in demo mode");
      const draft: ProposalDraft = { ...input, proposer: publicKey.toBase58() };
      const message = await proposeMessage(draft);
      const sig = await signMessage(new TextEncoder().encode(message));
      return govApi.propose({ ...draft, message, signature: encodeSig(sig) });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["gov"] }),
  });
}

/** Admin cancel (ADMIN_TOKEN bearer). */
export function useGovCancel(getToken: () => string | null) {
  const qc = useQueryClient();
  return useMutation<GovProposal, GovError, { id: number | string; note?: string }>({
    mutationFn: ({ id, note }) => {
      const t = getToken()?.trim();
      if (!t) throw new GovError("admin token required", 401);
      return govApi.cancel(id, t, note);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["gov"] }),
  });
}
