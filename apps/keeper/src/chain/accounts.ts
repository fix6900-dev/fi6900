/** Raw on-chain reads that do not need the program SDK: mint info, token balances. */
import { PublicKey, type Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { TtlCache } from '../util/cache.js';
import { withRetry } from '../util/retry.js';
import type { MintInfo } from './types.js';

export interface MintInfoSource {
  getMintInfo(mints: readonly string[]): Promise<Map<string, MintInfo>>;
}

export interface BalanceSource {
  getTokenBalance(owner: PublicKey, mint: PublicKey, tokenProgram?: PublicKey): Promise<bigint>;
  getSolBalance(owner: PublicKey): Promise<bigint>;
}

/** Decodes an SPL mint account (both Token and Token-2022 share the 82-byte base layout). */
export function decodeMint(mint: string, data: Buffer, owner: PublicKey): MintInfo {
  if (data.length < 82) throw new Error(`mint ${mint}: account too short`);
  const mintAuthOpt = data.readUInt32LE(0);
  const mintAuthority = mintAuthOpt === 1 ? new PublicKey(data.subarray(4, 36)).toBase58() : null;
  const supply = data.readBigUInt64LE(36);
  const decimals = data.readUInt8(44);
  const freezeOpt = data.readUInt32LE(46);
  const freezeAuthority = freezeOpt === 1 ? new PublicKey(data.subarray(50, 82)).toBase58() : null;
  const { transferFeeBps, transferFeeMaxFee, transferHookProgram } = decodeMintExtensions(data);
  return { mint, decimals, supply, mintAuthority, freezeAuthority, tokenProgram: owner.toBase58(), transferFeeBps, transferFeeMaxFee, transferHookProgram };
}

const ACCOUNT_TYPE_OFFSET = 165; // Token-2022: base mint (82) padded to the account layout, then account_type byte, then TLV
const EXT_TRANSFER_FEE_CONFIG = 1;
const EXT_TRANSFER_HOOK = 14;

/** Reads the Token-2022 TLV extension area. Plain SPL mints (82 bytes) have none. */
export function decodeMintExtensions(data: Buffer): { transferFeeBps: number; transferFeeMaxFee: bigint; transferHookProgram: string | null } {
  let transferFeeBps = 0;
  let transferFeeMaxFee = 0n;
  let transferHookProgram: string | null = null;
  if (data.length <= ACCOUNT_TYPE_OFFSET + 1) return { transferFeeBps, transferFeeMaxFee, transferHookProgram };
  let off = ACCOUNT_TYPE_OFFSET + 1;
  while (off + 4 <= data.length) {
    const type = data.readUInt16LE(off);
    const len = data.readUInt16LE(off + 2);
    const body = data.subarray(off + 4, off + 4 + len);
    if (type === EXT_TRANSFER_FEE_CONFIG && body.length >= 108) {
      // authority(32) withdraw_authority(32) withheld(8) older{epoch 8, max 8, bps 2} newer{epoch 8, max 8, bps 2}
      transferFeeBps = body.readUInt16LE(32 + 32 + 8 + 18 + 16);
      transferFeeMaxFee = body.readBigUInt64LE(32 + 32 + 8 + 18 + 8);
    } else if (type === EXT_TRANSFER_HOOK && body.length >= 64) {
      const program = new PublicKey(body.subarray(32, 64));
      if (!program.equals(PublicKey.default)) transferHookProgram = program.toBase58();
    }
    if (len === 0 && type === 0) break;
    off += 4 + len;
  }
  return { transferFeeBps, transferFeeMaxFee, transferHookProgram };
}

export class RpcMintInfoSource implements MintInfoSource {
  private readonly cache = new TtlCache<MintInfo>(10 * 60_000);

  constructor(private readonly connection: Connection) {}

  async getMintInfo(mints: readonly string[]): Promise<Map<string, MintInfo>> {
    const out = new Map<string, MintInfo>();
    const missing: string[] = [];
    for (const m of mints) {
      const hit = this.cache.get(m);
      if (hit) out.set(m, hit);
      else missing.push(m);
    }
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const infos = await withRetry(() => this.connection.getMultipleAccountsInfo(chunk.map((m) => new PublicKey(m))));
      infos.forEach((info, j) => {
        const mint = chunk[j];
        if (!mint || !info) return;
        try {
          const decoded = decodeMint(mint, info.data, info.owner);
          this.cache.set(mint, decoded);
          out.set(mint, decoded);
        } catch {
          /* not a mint */
        }
      });
    }
    return out;
  }
}

export class RpcBalanceSource implements BalanceSource {
  constructor(private readonly connection: Connection) {}

  async getTokenBalance(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    const info = await withRetry(() => this.connection.getAccountInfo(ata));
    if (!info || info.data.length < 72) return 0n;
    return info.data.readBigUInt64LE(64);
  }

  async getSolBalance(owner: PublicKey): Promise<bigint> {
    return BigInt(await withRetry(() => this.connection.getBalance(owner)));
  }
}

export function isTokenProgram(id: string): boolean {
  return id === TOKEN_PROGRAM_ID.toBase58() || id === TOKEN_2022_PROGRAM_ID.toBase58();
}

/** BPF upgradeable loader id. */
export const BPF_LOADER_UPGRADEABLE_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

/**
 * Decodes the upgradeable-loader `Program` -> `ProgramData` accounts:
 *   Program:     u32 enum tag (2) + programdata_address (32)
 *   ProgramData: u32 enum tag (3) + slot u64 + Option<Pubkey> upgrade_authority (1 + 32)
 * `upgradeAuthority` is null when the authority has been burned.
 */
export function decodeProgramDataAddress(programAccountData: Buffer): string | null {
  if (programAccountData.length < 36 || programAccountData.readUInt32LE(0) !== 2) return null;
  return new PublicKey(programAccountData.subarray(4, 36)).toBase58();
}

export function decodeUpgradeAuthority(programDataAccountData: Buffer): string | null {
  if (programDataAccountData.length < 13 || programDataAccountData.readUInt32LE(0) !== 3) return null;
  const hasAuthority = programDataAccountData.readUInt8(12) === 1;
  if (!hasAuthority || programDataAccountData.length < 45) return null;
  const key = new PublicKey(programDataAccountData.subarray(13, 45));
  // solana-test-validator --bpf-program writes Some(default pubkey); treat it like "none"
  return key.equals(PublicKey.default) ? null : key.toBase58();
}

export async function readProgramUpgradeInfo(connection: Connection, programId: PublicKey): Promise<{ programId: string; programDataAddress: string | null; upgradeAuthority: string | null }> {
  const program = await withRetry(() => connection.getAccountInfo(programId));
  if (!program || !program.owner.equals(BPF_LOADER_UPGRADEABLE_ID)) return { programId: programId.toBase58(), programDataAddress: null, upgradeAuthority: null };
  const programDataAddress = decodeProgramDataAddress(program.data);
  if (!programDataAddress) return { programId: programId.toBase58(), programDataAddress: null, upgradeAuthority: null };
  const pd = await withRetry(() => connection.getAccountInfo(new PublicKey(programDataAddress)));
  return { programId: programId.toBase58(), programDataAddress, upgradeAuthority: pd ? decodeUpgradeAuthority(pd.data) : null };
}
