/**
 * Holder governance v1: pure rules. Token-weighted, signature-based (gasless) voting by $FIX6900 holders.
 *
 *   - A proposal snapshots every holder's balance when it opens (circulating supply = total - excluded wallets).
 *   - A vote is an ed25519 signature over a canonical message; weight = the wallet's snapshot balance.
 *   - Passed = quorum reached (for + against + abstain >= quorumBps of snapshot supply) AND for > against.
 *
 * Canonical messages (exact bytes the wallet signs, UTF-8):
 *   propose:  `FIX6900 governance: propose <sha256 hex of canonical JSON {kind, payload, title, description, proposer}>`
 *   vote:     `FIX6900 governance: vote <for|against|abstain> on proposal <id> (snapshot slot <slot>)`
 *
 * Canonical JSON = keys sorted recursively, no whitespace, strings/numbers/booleans/null only (bigint -> string).
 */
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { GovChoice, GovKind, GovTally } from '../db/gov-repo.js';

export const GOV_CHOICES: readonly GovChoice[] = ['for', 'against', 'abstain'];
export const GOV_KINDS: readonly GovKind[] = ['add_asset', 'remove_asset', 'set_param'];
export const MESSAGE_PREFIX = 'FIX6900 governance: ';

// ---------------------------------------------------------------------------
// Canonical JSON + messages
// ---------------------------------------------------------------------------

export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonical JSON: non-finite number');
    return JSON.stringify(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new Error(`canonical JSON: unsupported type ${typeof v}`);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface ProposalDraft {
  kind: GovKind;
  payload: Record<string, unknown>;
  title: string;
  description: string;
  proposer: string;
}

/** The exact message a proposer signs. */
export function proposeMessage(d: ProposalDraft): string {
  const body = canonicalJson({ kind: d.kind, payload: d.payload, title: d.title, description: d.description, proposer: d.proposer });
  return `${MESSAGE_PREFIX}propose ${sha256Hex(body)}`;
}

/** The exact message a voter signs. */
export function voteMessage(choice: GovChoice, proposalId: number, snapshotSlot: bigint | string | number): string {
  return `${MESSAGE_PREFIX}vote ${choice} on proposal ${proposalId} (snapshot slot ${snapshotSlot.toString()})`;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

export function isBase58Pubkey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

/** Decodes a signature given as base58 (wallet-adapter), base64, or hex. */
export function decodeSignature(sig: string): Uint8Array {
  const s = sig.trim();
  if (/^[0-9a-fA-F]{128}$/.test(s)) return Uint8Array.from(Buffer.from(s, 'hex'));
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s)) {
    const b = bs58.decode(s);
    if (b.length === 64) return b;
  }
  if (/^[A-Za-z0-9+/=]{86,90}$/.test(s)) {
    const b = Uint8Array.from(Buffer.from(s, 'base64'));
    if (b.length === 64) return b;
  }
  throw new Error('signature must be 64 bytes (base58, base64 or hex)');
}

/** ed25519 verification of `message` (UTF-8) by `wallet`. Never throws on malformed input: returns false. */
export function verifySignature(wallet: string, message: string, signature: string): boolean {
  try {
    const pk = new PublicKey(wallet).toBytes();
    const sig = decodeSignature(signature);
    return nacl.sign.detached.verify(Buffer.from(message, 'utf8'), sig, pk);
  } catch {
    return false;
  }
}

/** Sign with a raw 64-byte secret key (tests / scripts). Returns base58. */
export function signMessage(secretKey: Uint8Array, message: string): string {
  return bs58.encode(nacl.sign.detached(Buffer.from(message, 'utf8'), secretKey));
}

// ---------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------

export interface TallyOutcome {
  for: bigint;
  against: bigint;
  abstain: bigint;
  voters: number;
  participation: bigint;
  quorumUnits: bigint;
  quorumReached: boolean;
  majority: boolean;
  passed: boolean;
}

/** Quorum in raw units: ceil(supply * bps / 10_000). A zero supply can never reach quorum unless bps is 0. */
export function quorumUnits(snapshotSupply: bigint, quorumBps: number): bigint {
  if (quorumBps <= 0) return 0n;
  return (snapshotSupply * BigInt(quorumBps) + 9_999n) / 10_000n;
}

export function tallyOutcome(t: GovTally, snapshotSupply: bigint, quorumBps: number): TallyOutcome {
  const participation = t.for + t.against + t.abstain;
  const q = quorumUnits(snapshotSupply, quorumBps);
  // With a positive quorum, a zero-supply snapshot (q = 0) can never reach it; quorumBps = 0 disables the rule.
  const quorumReached = quorumBps <= 0 ? true : participation >= q && participation > 0n;
  const majority = t.for > t.against;
  return { ...t, participation, quorumUnits: q, quorumReached, majority, passed: quorumReached && majority };
}

// ---------------------------------------------------------------------------
// Votable parameters (whitelist with bounds)
// ---------------------------------------------------------------------------

export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  integer: boolean;
  /** Where the override is consumed. */
  applies: string;
}

export const PARAM_SPECS: readonly ParamSpec[] = [
  { key: 'eligibility.minVolume24hUsd', label: 'Minimum 24h volume for eligibility', unit: 'USD', min: 50_000, max: 2_000_000, integer: true, applies: 'methodology eligibility (rule 2)' },
  { key: 'rebalance.driftRelativeBps', label: 'Relative drift band that opens an interim rebalance', unit: 'bps', min: 1000, max: 10_000, integer: true, applies: 'rebalancer drift check (rule 5)' },
  { key: 'FEE_BURN_PCT', label: 'Share of ETF fees used to buy back and burn $FIX6900', unit: '%', min: 0, max: 100, integer: true, applies: 'fee processing (hourly)' },
  { key: 'flywheel.airdropShareBps', label: 'Share of claimed creator fees that goes to the airdrop leg', unit: 'bps', min: 0, max: 10_000, integer: true, applies: 'flywheel split (every DIST_INTERVAL)' },
];

export function paramSpec(key: string): ParamSpec | undefined {
  return PARAM_SPECS.find((p) => p.key === key);
}

export function allowedParams(allowedCsv: string): ParamSpec[] {
  const allow = new Set(
    allowedCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return PARAM_SPECS.filter((p) => allow.has(p.key));
}

/** Validates a set_param payload against the whitelist and bounds. Returns the normalised payload. */
export function validateParamPayload(payload: Record<string, unknown>, allowedCsv: string): { key: string; value: number } {
  const key = typeof payload.key === 'string' ? payload.key : '';
  const spec = allowedParams(allowedCsv).find((p) => p.key === key);
  if (!spec) throw new Error(`parameter ${key || '(missing)'} is not votable; allowed: ${allowedParams(allowedCsv).map((p) => p.key).join(', ') || 'none'}`);
  const raw = payload.value;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) throw new Error(`parameter ${key}: value must be a number`);
  if (spec.integer && !Number.isInteger(value)) throw new Error(`parameter ${key}: value must be an integer`);
  if (value < spec.min || value > spec.max) throw new Error(`parameter ${key}: value ${value} outside [${spec.min}..${spec.max}] ${spec.unit}`);
  return { key, value };
}

// ---------------------------------------------------------------------------
// Payload validation (shape only; chain checks live in the service)
// ---------------------------------------------------------------------------

export interface AssetPayload {
  mint: string;
  symbol?: string;
  weightBps?: number;
  allowTransferFee?: boolean;
}

export function validateAssetPayload(kind: 'add_asset' | 'remove_asset', payload: Record<string, unknown>): AssetPayload {
  if (!isBase58Pubkey(payload.mint)) throw new Error('payload.mint must be a base58 public key');
  const out: AssetPayload = { mint: payload.mint };
  if (payload.symbol !== undefined) {
    if (typeof payload.symbol !== 'string' || payload.symbol.length > 16) throw new Error('payload.symbol must be a string of at most 16 characters');
    out.symbol = payload.symbol;
  }
  if (kind === 'add_asset') {
    if (payload.weightBps !== undefined && payload.weightBps !== null) {
      const w = typeof payload.weightBps === 'number' ? payload.weightBps : Number(payload.weightBps);
      if (!Number.isInteger(w) || w < 1 || w > 10_000) throw new Error('payload.weightBps must be an integer in 1..10000');
      out.weightBps = w;
    }
    if (payload.allowTransferFee !== undefined) out.allowTransferFee = payload.allowTransferFee === true;
  }
  return out;
}

export function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length < 4 || title.length > 120) throw new Error('title must be 4..120 characters');
  return title.trim();
}

export function validateDescription(desc: unknown): string {
  if (desc === undefined || desc === null) return '';
  if (typeof desc !== 'string' || desc.length > 4000) throw new Error('description must be at most 4000 characters');
  return desc.trim();
}

/** Short human summary of a payload, e.g. "Add GOAT · CzLS…pump · 714 bps". */
export function describeGovPayload(kind: GovKind, payload: Record<string, unknown>): string {
  const short = (m: unknown): string => (typeof m === 'string' && m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : String(m ?? ''));
  if (kind === 'set_param') return `Set ${String(payload.key)} = ${String(payload.value)}`;
  const sym = typeof payload.symbol === 'string' && payload.symbol ? payload.symbol : short(payload.mint);
  const w = payload.weightBps != null ? ` · ${String(payload.weightBps)} bps` : '';
  return kind === 'add_asset' ? `Add ${sym} · ${short(payload.mint)}${w}` : `Remove ${sym} · ${short(payload.mint)}`;
}
