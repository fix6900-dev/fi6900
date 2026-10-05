import { env } from "./env";

type Kind = "account" | "token" | "tx";

function clusterSuffix(): string {
  if (env.cluster === "mainnet-beta") return "";
  if (env.cluster === "localnet") return "?cluster=custom&customUrl=" + encodeURIComponent(env.rpcUrl);
  return `?cluster=${env.cluster}`;
}

export function solscan(kind: Kind, id: string): string {
  const base = "https://solscan.io";
  const path = kind === "account" ? "account" : kind === "token" ? "token" : "tx";
  return `${base}/${path}/${id}${clusterSuffix()}`;
}

export const solscanAccount = (id: string) => solscan("account", id);
export const solscanToken = (id: string) => solscan("token", id);
export const solscanTx = (id: string) => solscan("tx", id);
