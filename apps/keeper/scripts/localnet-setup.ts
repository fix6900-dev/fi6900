#!/usr/bin/env tsx
/**
 * Backwards-compatible entry: `pnpm e2e:setup` == `fund-setup.ts --cluster localnet`.
 * See scripts/fund-setup.ts for the cluster-aware implementation (localnet / devnet).
 */
if (!process.argv.includes('--cluster')) process.argv.push('--cluster', process.env.CLUSTER ?? 'localnet');
await import('./fund-setup.ts');
