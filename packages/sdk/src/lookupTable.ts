import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { readAssets, readFund } from "./accounts.js";
import { ALT_ADDRESSES_PER_EXTEND, ALT_MAX_ADDRESSES, PROGRAM_ID } from "./constants.js";

export interface LookupTablePlan {
  /** Address of the first lookup table (kept for backwards compatibility). */
  lookupTable: PublicKey;
  /** Every table the plan creates (one per 256 addresses). */
  lookupTables: PublicKey[];
  /**
   * Instructions grouped per transaction, in order. Each table starts with a group that
   * creates it and adds the first batch; later groups add the remaining addresses.
   * Addresses become usable one slot after the extend lands.
   */
  instructionGroups: TransactionInstruction[][];
  addresses: PublicKey[];
}

/** Every address the mint/redeem/auction flows touch for this fund. */
export async function fundLookupAddresses(
  connection: Connection,
  fund: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<PublicKey[]> {
  const [fundAcc, assets] = await Promise.all([readFund(connection, fund), readAssets(connection, fund, programId)]);
  const indexMintInfo = await connection.getAccountInfo(fundAcc.indexMint);
  const indexTokenProgram = indexMintInfo?.owner ?? TOKEN_PROGRAM_ID;
  const feeAta = getAssociatedTokenAddressSync(fundAcc.indexMint, fundAcc.feeRecipient, true, indexTokenProgram);

  const list: PublicKey[] = [
    programId,
    fund,
    fundAcc.indexMint,
    feeAta,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    ComputeBudgetProgram.programId,
  ];
  for (const a of assets) list.push(a.address, a.vault, a.mint);
  return dedupe(list);
}

function dedupe(keys: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  const out: PublicKey[] = [];
  for (const k of keys) {
    const s = k.toBase58();
    if (!seen.has(s)) {
      seen.add(s);
      out.push(k);
    }
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Plan the creation of address lookup table(s) covering the fund, every Asset PDA, every
 * vault, every constituent mint, the index mint, the fee ATA and the programs involved.
 * One table holds 256 addresses (~82 assets); larger funds get several tables, derived from
 * consecutive recent slots so their addresses differ. Used once by the keeper; store every
 * returned address (`lookupTables`).
 */
export async function createFundLookupTable(
  connection: Connection,
  fund: PublicKey,
  payer: PublicKey,
  authority: PublicKey = payer,
  programId: PublicKey = PROGRAM_ID,
): Promise<LookupTablePlan> {
  const addresses = await fundLookupAddresses(connection, fund, programId);
  const recentSlot = await connection.getSlot("finalized");
  const tables = chunk(addresses, ALT_MAX_ADDRESSES);
  if (tables.length === 0) tables.push([]);

  const lookupTables: PublicKey[] = [];
  const instructionGroups: TransactionInstruction[][] = [];
  tables.forEach((tableAddresses, t) => {
    // distinct recent slots -> distinct table addresses (SlotHashes keeps the last 512 slots)
    const [createIx, lookupTable] = AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot: recentSlot - t });
    lookupTables.push(lookupTable);
    const batches = chunk(tableAddresses, ALT_ADDRESSES_PER_EXTEND);
    if (batches.length === 0) instructionGroups.push([createIx]);
    batches.forEach((batch, i) => {
      const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable, authority, payer, addresses: batch });
      instructionGroups.push(i === 0 ? [createIx, extendIx] : [extendIx]);
    });
  });
  return { lookupTable: lookupTables[0], lookupTables, instructionGroups, addresses };
}

export interface LookupTableGrowth {
  instructionGroups: TransactionInstruction[][];
  /** All tables after the plan lands (existing ones first, then any newly created). */
  lookupTables: PublicKey[];
  newLookupTables: PublicKey[];
  missing: number;
}

/**
 * Plan extending existing table(s) with any fund addresses they are missing (call after
 * add_asset). Fills the tables that still have capacity; when none is left, creates new
 * tables for the overflow. Returns empty groups when nothing is missing.
 */
export async function extendFundLookupTables(
  connection: Connection,
  fund: PublicKey,
  lookupTables: PublicKey[],
  payer: PublicKey,
  authority: PublicKey = payer,
  programId: PublicKey = PROGRAM_ID,
): Promise<LookupTableGrowth> {
  const [addresses, ...tables] = await Promise.all([
    fundLookupAddresses(connection, fund, programId),
    ...lookupTables.map((t) => connection.getAddressLookupTable(t)),
  ]);
  const existing = new Set<string>();
  const capacity: { table: PublicKey; free: number }[] = [];
  tables.forEach((t, i) => {
    if (!t.value) throw new Error(`lookup table ${lookupTables[i].toBase58()} not found`);
    for (const a of t.value.state.addresses) existing.add(a.toBase58());
    capacity.push({ table: lookupTables[i], free: ALT_MAX_ADDRESSES - t.value.state.addresses.length });
  });
  let missing = addresses.filter((a) => !existing.has(a.toBase58()));
  const total = missing.length;
  const instructionGroups: TransactionInstruction[][] = [];
  for (const c of capacity) {
    if (missing.length === 0 || c.free <= 0) continue;
    const take = missing.slice(0, c.free);
    missing = missing.slice(c.free);
    for (const batch of chunk(take, ALT_ADDRESSES_PER_EXTEND)) {
      instructionGroups.push([AddressLookupTableProgram.extendLookupTable({ lookupTable: c.table, authority, payer, addresses: batch })]);
    }
  }
  const newLookupTables: PublicKey[] = [];
  if (missing.length > 0) {
    const recentSlot = await connection.getSlot("finalized");
    chunk(missing, ALT_MAX_ADDRESSES).forEach((tableAddresses, t) => {
      const [createIx, lookupTable] = AddressLookupTableProgram.createLookupTable({ authority, payer, recentSlot: recentSlot - t });
      newLookupTables.push(lookupTable);
      chunk(tableAddresses, ALT_ADDRESSES_PER_EXTEND).forEach((batch, i) => {
        const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable, authority, payer, addresses: batch });
        instructionGroups.push(i === 0 ? [createIx, extendIx] : [extendIx]);
      });
    });
  }
  return { instructionGroups, lookupTables: [...lookupTables, ...newLookupTables], newLookupTables, missing: total };
}

/**
 * Single-table variant kept for existing callers: returns the extend groups, or throws when
 * the table is full (use `extendFundLookupTables` to grow into additional tables).
 */
export async function extendFundLookupTable(
  connection: Connection,
  fund: PublicKey,
  lookupTable: PublicKey,
  payer: PublicKey,
  authority: PublicKey = payer,
  programId: PublicKey = PROGRAM_ID,
): Promise<TransactionInstruction[][]> {
  const plan = await extendFundLookupTables(connection, fund, [lookupTable], payer, authority, programId);
  if (plan.newLookupTables.length > 0) {
    throw new Error(`lookup table ${lookupTable.toBase58()} is full; use extendFundLookupTables to add a table`);
  }
  return plan.instructionGroups;
}
