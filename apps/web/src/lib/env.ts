export const env = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  cluster: (process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet-beta") as "mainnet-beta" | "devnet" | "testnet" | "localnet",
  indexMint: process.env.NEXT_PUBLIC_INDEX_MINT ?? "",
  coinMint: process.env.NEXT_PUBLIC_COIN_MINT ?? "",
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV",
};
