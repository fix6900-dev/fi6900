"use client";

/**
 * "Devnet test wallet": an in-page keypair wallet so the create/redeem and auction-fill flows can be driven
 * in a browser without an extension. Registered by <Providers> only when NEXT_PUBLIC_CLUSTER !== "mainnet-beta".
 *
 * Key source, in order: `?burner=<base58 64-byte secret>` query param (persisted, then stripped from the URL),
 * localStorage (`fi6900.burner.<cluster>`), else a freshly generated keypair (persisted). The setup script
 * `apps/keeper/scripts/fund-setup.ts` funds `keypairs/<cluster>-burner.json`; load it with
 * `/create?burner=$(node -e "...base58 secret...")`, or send tokens to the address shown in the wallet button.
 *
 * Never used on mainnet. The secret is as safe as the browser profile it lives in.
 */
import { BaseSignerWalletAdapter, WalletReadyState, type WalletName, WalletNotConnectedError, type TransactionOrVersionedTransaction, type WalletError } from "@solana/wallet-adapter-base";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { env } from "./env";

export const BurnerWalletName = "Devnet test wallet" as WalletName<"Devnet test wallet">;
const STORAGE_KEY = `fi6900.burner.${env.cluster}`;
const QUERY_PARAM = "burner";

/* ------------------------------ base58 (no dependency) ------------------------------ */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("invalid base58");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}
export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

function parseSecret(raw: string): Keypair | null {
  try {
    const t = raw.trim();
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t) as number[]));
    const bytes = base58Decode(t);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
  } catch {
    /* ignore */
  }
  return null;
}

/** Resolves the burner keypair (query param > localStorage > new), persisting it. Browser only. */
export function loadBurnerKeypair(): Keypair {
  if (typeof window === "undefined") throw new Error("burner wallet is browser-only");
  let kp: Keypair | null = null;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get(QUERY_PARAM);
    if (q) {
      kp = parseSecret(q);
      url.searchParams.delete(QUERY_PARAM);
      window.history.replaceState(null, "", url.toString());
    }
  } catch {
    /* ignore */
  }
  if (!kp) {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) kp = parseSecret(stored);
    } catch {
      /* storage unavailable */
    }
  }
  if (!kp) kp = Keypair.generate();
  try {
    window.localStorage.setItem(STORAGE_KEY, base58Encode(kp.secretKey));
  } catch {
    /* storage unavailable: session-only key */
  }
  return kp;
}

const ICON =
  "data:image/svg+xml;base64," +
  (typeof btoa === "function"
    ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#B6FF3B"/><path d="M8 24V8h14M8 16h10" stroke="#0A0B0D" stroke-width="4" stroke-linecap="square" fill="none"/></svg>')
    : "");

export class BurnerWalletAdapter extends BaseSignerWalletAdapter {
  name = BurnerWalletName;
  url = "https://fi6900.vercel.app/create";
  icon = ICON;
  supportedTransactionVersions = new Set(["legacy", 0] as const);

  private _keypair: Keypair | null = null;
  private _connecting = false;
  private _readyState: WalletReadyState = typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;

  get publicKey(): PublicKey | null {
    return this._keypair?.publicKey ?? null;
  }
  get connecting(): boolean {
    return this._connecting;
  }
  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this._connecting = true;
    try {
      this._keypair = loadBurnerKeypair();
      this.emit("connect", this._keypair.publicKey);
    } catch (e) {
      this.emit("error", e as WalletError);
      throw e;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(transaction: T): Promise<T> {
    if (!this._keypair) throw new WalletNotConnectedError();
    if (transaction instanceof VersionedTransaction) transaction.sign([this._keypair]);
    else if (transaction instanceof Transaction) transaction.partialSign(this._keypair);
    return transaction;
  }

  /** Exposes the secret so a user can copy it out (devnet only). */
  exportSecretBase58(): string | null {
    return this._keypair ? base58Encode(this._keypair.secretKey) : null;
  }
}
