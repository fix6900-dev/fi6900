import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Loads a Solana keypair from a JSON byte-array file (solana-keygen format), inline JSON, a base58 secret,
 * or the base64 encoding of an inline JSON array / base58 secret (handy for hosted env vars).
 */
export function loadKeypair(pathOrSecret: string): Keypair {
  const trimmed = pathOrSecret.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
  }
  if (trimmed.startsWith('base64:') || (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length >= 120)) {
    const decoded = Buffer.from(trimmed.replace(/^base64:/, ''), 'base64').toString('utf8').trim();
    if (decoded.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(decoded) as number[]));
    if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(decoded)) return Keypair.fromSecretKey(bs58.decode(decoded));
  }
  try {
    const raw = readFileSync(trimmed, 'utf8');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch (err) {
    if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(trimmed)) {
      return Keypair.fromSecretKey(bs58.decode(trimmed));
    }
    throw new Error(`cannot load keypair from ${trimmed}: ${(err as Error).message}`);
  }
}
