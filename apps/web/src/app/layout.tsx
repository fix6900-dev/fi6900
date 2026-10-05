import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { DemoBanner } from "@/components/DemoBanner";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";
import { TopBar } from "@/components/TopBar";
import "./globals.css";

const display = Instrument_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"] });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "FI6900 — The memecoin index fund", template: "%s · FI6900" },
  description: "An on-chain, equal-weight index of the 40 largest Solana memecoins. Every $FI6900 unit is redeemable in-kind for its slice of the vault. Dutch-auction rebalancing, no oracle, fully verifiable.",
  applicationName: "FI6900",
  keywords: ["Solana", "memecoin", "index fund", "ETF", "FI6900", "on-chain", "in-kind redemption", "Dutch auction"],
  openGraph: { type: "website", siteName: "FI6900", title: "FI6900 — The memecoin index fund", description: "40 memecoins. One token. Redeemable in-kind.", url: SITE },
  twitter: { card: "summary_large_image", title: "FI6900 — The memecoin index fund", description: "40 memecoins. One token. Redeemable in-kind." },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0A0B0D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <Providers>
          <TopBar />
          <DemoBanner />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
