/** Holder-governance tick (every GOV_JOB_SEC, default 60 s): close ended proposals, apply passed ones, reconcile queued ones. */
import type { HolderGovernance } from '../governance/holder-gov.js';

export const GOV_JOB_NAME = 'governance';
export const GOV_JOB_MS = 60_000;

export function govJob(gov: HolderGovernance): () => Promise<Record<string, unknown>> {
  return () => gov.tick();
}
