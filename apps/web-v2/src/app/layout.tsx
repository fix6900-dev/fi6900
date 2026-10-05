import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/azeret-mono";
import "@fontsource-variable/source-serif-4/opsz.css";
import { Banner } from "@/components/chrome/Banner";
import { Footer } from "@/components/chrome/Footer";
import { Masthead } from "@/components/chrome/Masthead";
import { MobileBar } from "@/components/chrome/MobileBar";
import { Nav } from "@/components/chrome/Nav";
import { Providers } from "@/components/Providers";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
const DESC = "An on-chain, equal-weight memecoin index fund on Solana. Mintable, redeemable in-kind, verifiable.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "FI6900 Solana Memecoin Equal Weight Index", template: "%s · FI6900" },
  description: DESC,
  applicationName: "FI6900",
  openGraph: { type: "website", siteName: "FI6900", title: "FI6900 Solana Memecoin Equal Weight Index", description: DESC, url: SITE },
  twitter: { card: "summary_large_image", title: "FI6900 Solana Memecoin Equal Weight Index", description: DESC },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#10100e" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Sets data-theme before first paint so there is no flash. Storage may be blocked: try/catch. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("fi6900.theme");if(t==="ink")document.documentElement.setAttribute("data-theme","ink")}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <Providers>
          <Masthead />
          <Nav />
          <Banner />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
          <MobileBar />
        </Providers>
      </body>
    </html>
  );
}
