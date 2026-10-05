/**
 * Governance-set configuration overrides. A passed `set_param` proposal writes `cfg.<key>` into the kv table;
 * the methodology, rebalancer, fee processor and flywheel consult these at the point of use so an override
 * takes effect without a restart and survives one. Env/defaults remain the fallback.
 */
import type { MethodologyConfig } from './methodology.config.js';
import type { Env } from './env.js';

export const CFG_PREFIX = 'cfg.';

/** Minimal kv reader so this module has no dependency on the full Repo. */
export interface KvReader {
  getKv(key: string): string | undefined;
}

export function readOverride(repo: KvReader | undefined, key: string): number | undefined {
  if (!repo) return undefined;
  const raw = repo.getKv(CFG_PREFIX + key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function listOverrides(repo: KvReader & { db?: unknown } | undefined, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = readOverride(repo, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Methodology config with the votable keys overridden from kv (eligibility.minVolume24hUsd, rebalance.driftRelativeBps). */
export function withConfigOverrides(cfg: MethodologyConfig, repo: KvReader | undefined): MethodologyConfig {
  const minVol = readOverride(repo, 'eligibility.minVolume24hUsd');
  const drift = readOverride(repo, 'rebalance.driftRelativeBps');
  if (minVol === undefined && drift === undefined) return cfg;
  return {
    ...cfg,
    eligibility: minVol !== undefined ? { ...cfg.eligibility, minVolume24hUsd: minVol } : cfg.eligibility,
    rebalance: drift !== undefined ? { ...cfg.rebalance, driftRelativeBps: drift } : cfg.rebalance,
  };
}

/** FEE_BURN_PCT in force (0..100). */
export function feeBurnPct(env: Pick<Env, 'FEE_BURN_PCT'>, repo: KvReader | undefined): number {
  const v = readOverride(repo, 'FEE_BURN_PCT');
  return v !== undefined ? Math.min(100, Math.max(0, Math.round(v))) : env.FEE_BURN_PCT;
}

/** Share of each claimed creator-fee amount that goes to the airdrop leg (bps; default 5000 = 50/50). */
export function airdropShareBps(repo: KvReader | undefined): number {
  const v = readOverride(repo, 'flywheel.airdropShareBps');
  return v !== undefined ? Math.min(10_000, Math.max(0, Math.round(v))) : 5000;
}
