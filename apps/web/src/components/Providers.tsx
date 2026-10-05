"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
import { env } from "@/lib/env";
import { BurnerWalletAdapter } from "@/lib/burnerWallet";
import { useStream } from "@/lib/useStream";

import "@solana/wallet-adapter-react-ui/styles.css";

function StreamMount() {
  useStream();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
        },
      }),
  );
  // Phantom + Solflare adapters; Backpack (and any other Wallet Standard wallet) is auto-detected by wallet-adapter-react.
  // Off mainnet, an in-page "Devnet test wallet" (keypair in localStorage / ?burner=) lets the flows run without an extension.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), ...(env.cluster !== "mainnet-beta" ? [new BurnerWalletAdapter()] : [])],
    [],
  );
  return (
    <QueryClientProvider client={qc}>
      <ConnectionProvider endpoint={env.rpcUrl} config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            {/* Framer Motion honours the OS reduced-motion preference. */}
            <MotionConfig reducedMotion="user">
              <StreamMount />
              {children}
            </MotionConfig>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
