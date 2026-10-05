import { Connection } from '@solana/web3.js';
import type { Env } from '../config/env.js';

export function rpcUrl(env: Env): string {
  if (env.HELIUS_API_KEY && /mainnet-beta\.solana\.com/.test(env.RPC_URL)) {
    return `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
  }
  return env.RPC_URL;
}

export function createConnection(env: Env): Connection {
  return new Connection(rpcUrl(env), {
    commitment: env.COMMITMENT,
    wsEndpoint: env.RPC_WS_URL,
    disableRetryOnRateLimit: false,
  });
}
