import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_ID, SEEDS } from "./constants.js";

export type NonceLike = bigint | number | BN;

export function nonceToLeBytes(nonce: NonceLike): Buffer {
  const bn = BN.isBN(nonce) ? (nonce as BN) : new BN(nonce.toString());
  return bn.toArrayLike(Buffer, "le", 8);
}

/** Fund PDA: ["fund", index_mint] */
export function fundPda(indexMint: PublicKey, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.fund, indexMint.toBuffer()], programId);
}

/** Asset PDA: ["asset", fund, mint] */
export function assetPda(fund: PublicKey, mint: PublicKey, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.asset, fund.toBuffer(), mint.toBuffer()], programId);
}

/** MintSession PDA: ["mint_session", fund, owner, nonce_le] */
export function mintSessionPda(
  fund: PublicKey,
  owner: PublicKey,
  nonce: NonceLike,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.mintSession, fund.toBuffer(), owner.toBuffer(), nonceToLeBytes(nonce)],
    programId,
  );
}

/** RedeemSession PDA: ["redeem_session", fund, owner, nonce_le] */
export function redeemSessionPda(
  fund: PublicKey,
  owner: PublicKey,
  nonce: NonceLike,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEEDS.redeemSession, fund.toBuffer(), owner.toBuffer(), nonceToLeBytes(nonce)],
    programId,
  );
}

/** Auction PDA: ["auction", fund, auction_nonce_le] */
export function auctionPda(fund: PublicKey, nonce: NonceLike, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.auction, fund.toBuffer(), nonceToLeBytes(nonce)], programId);
}

/** Random u64 nonce for mint/redeem sessions. */
export function randomNonce(): bigint {
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/** PendingAction PDA: ["pending", fund, action_nonce_le] */
export function pendingActionPda(fund: PublicKey, nonce: NonceLike, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEEDS.pending, fund.toBuffer(), nonceToLeBytes(nonce)], programId);
}
