/**
 * Holder snapshots.
 *
 *   HeliusHolderSource  DAS `getTokenAccounts` (paginated by cursor, 1000/page). Needs HELIUS_API_KEY.
 *   GpaHolderSource     getProgramAccounts on the mint's token program with dataSlice {32,40} (owner + amount)
 *                       and memcmp(mint @ offset 0). Works for SPL Token (dataSize 165) and Token-2022
 *                       (variable size: no dataSize filter). pump.fun coins created in 2026 are Token-2022.
 *
 * Verified live 2026-10-03 (apps/keeper/test/live/holders.live.test.ts):
 *   - api.mainnet-beta.solana.com serves gPA with filters: ~17.5k token accounts / 5.9k holders in ~3 s.
 *     It has an IP data allowance: a gPA over a 1-2M-account mint (BONK) returned ~590 MB and then the
 *     RPC answered 413 "You have used your data allowance" for a while. Do not point this at huge mints.
 *   - solana-rpc.publicnode.com rejects gPA entirely ("Indexed requests require a personal token").
 *   - Helius DAS is the production path: constant memory, 1000 accounts per page, no allowance surprises.
 */
import { PublicKey, type Connection, type GetProgramAccountsFilter } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { fetchJson } from '../util/retry.js';
import { childLogger } from '../util/logger.js';
import type { HolderBalance, HolderSource } from './types.js';

const log = childLogger('sources.holders');

interface DasTokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: number | string;
  delegated_amount?: number;
  frozen?: boolean;
}

interface DasResponse {
  result?: { total: number; limit: number; cursor?: string; token_accounts: DasTokenAccount[] };
  error?: { message: string };
}

export class HeliusHolderSource implements HolderSource {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://mainnet.helius-rpc.com',
  ) {}

  async getHolders(mint: string): Promise<HolderBalance[]> {
    const url = `${this.endpoint}/?api-key=${this.apiKey}`;
    const out: HolderBalance[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const body = {
        jsonrpc: '2.0',
        id: `holders-${page}`,
        method: 'getTokenAccounts',
        params: { mint, limit: 1000, cursor, options: { showZeroBalance: false } },
      };
      const res = await fetchJson<DasResponse>(url, { method: 'POST', body, retries: 3, timeoutMs: 20_000 });
      if (res.error) throw new Error(`DAS getTokenAccounts: ${res.error.message}`);
      const accounts = res.result?.token_accounts ?? [];
      for (const a of accounts) {
        const amt = BigInt(typeof a.amount === 'number' ? Math.trunc(a.amount) : a.amount);
        if (amt > 0n) out.push({ owner: a.owner, tokenAccount: a.address, amount: amt });
      }
      cursor = res.result?.cursor;
      page++;
      if (page > 500) throw new Error('holder pagination runaway');
    } while (cursor);
    log.debug({ mint, accounts: out.length, pages: page }, 'DAS holders fetched');
    return mergeByOwner(out);
  }
}

/** Decodes gPA results sliced at {offset: 32, length: 40}: owner (32) + amount (8 LE). */
export function decodeSlicedTokenAccounts(accounts: readonly { pubkey: PublicKey; account: { data: Buffer } }[]): HolderBalance[] {
  const out: HolderBalance[] = [];
  for (const { pubkey, account } of accounts) {
    if (account.data.length < 40) continue;
    const owner = new PublicKey(account.data.subarray(0, 32)).toBase58();
    const amount = account.data.readBigUInt64LE(32);
    if (amount > 0n) out.push({ owner, tokenAccount: pubkey.toBase58(), amount });
  }
  return out;
}

export class GpaHolderSource implements HolderSource {
  constructor(
    private readonly connection: Connection,
    /** Force a token program; by default the mint account's owner decides. */
    private readonly tokenProgram?: PublicKey,
  ) {}

  async resolveProgram(mint: PublicKey): Promise<PublicKey> {
    if (this.tokenProgram) return this.tokenProgram;
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error(`mint ${mint.toBase58()} not found`);
    if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) return info.owner;
    throw new Error(`mint ${mint.toBase58()} is owned by ${info.owner.toBase58()}, not a token program`);
  }

  async getHolders(mint: string): Promise<HolderBalance[]> {
    const mintPk = new PublicKey(mint);
    const program = await this.resolveProgram(mintPk);
    const filters: GetProgramAccountsFilter[] = [{ memcmp: { offset: 0, bytes: mint } }];
    // Token-2022 accounts carry extensions after byte 165, so the fixed-size filter only applies to SPL Token.
    if (program.equals(TOKEN_PROGRAM_ID)) filters.unshift({ dataSize: 165 });
    const t0 = Date.now();
    const accounts = await this.connection.getProgramAccounts(program, { filters, dataSlice: { offset: 32, length: 40 } });
    const out = decodeSlicedTokenAccounts(accounts);
    log.debug({ mint, program: program.toBase58(), accounts: accounts.length, nonZero: out.length, ms: Date.now() - t0 }, 'gPA holders fetched');
    return mergeByOwner(out);
  }
}

/** Tries Helius first (if configured), then gPA. */
export class FallbackHolderSource implements HolderSource {
  constructor(private readonly sources: HolderSource[]) {}

  async getHolders(mint: string): Promise<HolderBalance[]> {
    let lastErr: unknown;
    for (const s of this.sources) {
      try {
        return await s.getHolders(mint);
      } catch (err) {
        lastErr = err;
        log.warn({ err: (err as Error).message, source: s.constructor.name }, 'holder source failed; trying next');
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('no holder source succeeded');
  }
}

/** One wallet can own several token accounts for the same mint; aggregate them. */
export function mergeByOwner(accounts: readonly HolderBalance[]): HolderBalance[] {
  const byOwner = new Map<string, HolderBalance>();
  for (const a of accounts) {
    const cur = byOwner.get(a.owner);
    if (cur) cur.amount += a.amount;
    else byOwner.set(a.owner, { ...a });
  }
  return [...byOwner.values()].sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
}
