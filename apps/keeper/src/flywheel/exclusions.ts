/**
 * Wallets that never count as "holders": LP pool vaults and other PDAs (off-curve owners), program / non-system
 * owned accounts (e.g. multisig-owned token accounts), the burn address, the denylist and our own wallets.
 * Shared by the airdrop runner (who gets paid) and holder governance (whose balance counts and what the
 * circulating supply is).
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import type { Env } from '../config/env.js';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
/** Conventional incinerator used by burn tooling; tokens parked here are not circulating. */
export const INCINERATOR = '1nc1nerator11111111111111111111111111111111';

export interface ExclusionDeps {
  connection: Pick<Connection, 'getMultipleAccountsInfo'>;
  env: Pick<Env, 'AIRDROP_DENYLIST' | 'TREASURY_WALLET'>;
  /** Extra wallets to exclude (keeper, dev wallet, fee recipient...). */
  own?: readonly string[];
}

export async function buildHolderExclusions(d: ExclusionDeps, owners: readonly string[]): Promise<Set<string>> {
  const ex = new Set<string>(d.env.AIRDROP_DENYLIST.split(',').map((s) => s.trim()).filter(Boolean));
  ex.add(INCINERATOR);
  for (const w of d.own ?? []) ex.add(w);
  if (d.env.TREASURY_WALLET) ex.add(d.env.TREASURY_WALLET);
  const candidates: PublicKey[] = [];
  for (const o of owners) {
    let pk: PublicKey;
    try {
      pk = new PublicKey(o);
    } catch {
      ex.add(o);
      continue;
    }
    if (!PublicKey.isOnCurve(pk.toBytes())) {
      ex.add(o); // PDA: pool vault authority, program-owned account, etc.
      continue;
    }
    candidates.push(pk);
  }
  // Owners that are themselves programs / non-system accounts (e.g. multisig-owned accounts) are excluded too.
  for (let k = 0; k < candidates.length; k += 100) {
    const chunk = candidates.slice(k, k + 100);
    const infos = await d.connection.getMultipleAccountsInfo(chunk).catch(() => []);
    infos.forEach((info, idx) => {
      const pk = chunk[idx];
      if (info && pk && (info.executable || !info.owner.equals(new PublicKey(SYSTEM_PROGRAM)))) ex.add(pk.toBase58());
    });
  }
  return ex;
}
