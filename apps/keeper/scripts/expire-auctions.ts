#!/usr/bin/env tsx
/** One-off: expire (cancel) every ended-but-still-open auction, signed by the AP (anyone may expire after end_slot). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { AuctionStatus, Fi6900Client } from '@fi6900/sdk';
const connection = new Connection(process.env.RPC_URL!, 'confirmed');
const ap = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(process.env.AP_KEYPAIR ?? '../../keypairs/devnet-ap.json'), 'utf8'))));
const client = new Fi6900Client(connection, new PublicKey(process.env.INDEX_MINT!));
const open = await client.readAuctions(AuctionStatus.Open);
const slot = BigInt(await connection.getSlot());
console.log(`open=${open.length} slot=${slot}`);
for (const a of open) {
  if (slot <= a.endSlot) { console.log(`${a.address.toBase58()} still live until ${a.endSlot}`); continue; }
  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(await client.cancelAuctionIx(ap.publicKey, a.address)), [ap]);
    console.log(`expired ${a.address.toBase58()} ${sig}`);
  } catch (e) { console.log(`failed ${a.address.toBase58()}: ${(e as Error).message.split('\n')[0]}`); }
}
