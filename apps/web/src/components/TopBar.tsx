"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useFund } from "@/lib/api";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Delta } from "./ui/Stat";
import { LiveDot, useLiveStatus } from "./ui/LivePill";
import { NumberTicker } from "./ui/NumberTicker";

/** Five primary links. Methodology lives in the footer, the stat strip and the mobile sheet. */
const NAV = [
  { href: "/buy", label: "Buy" },
  { href: "/create", label: "Create" },
  { href: "/auctions", label: "Auctions" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/verify", label: "Verify" },
];
const NAV_ALL = [{ href: "/", label: "Index" }, ...NAV, { href: "/methodology", label: "Methodology" }];

const WalletButton = dynamic(() => Promise.resolve(WalletMultiButton), { ssr: false, loading: () => <span className="inline-block h-8 w-[124px] rounded-md bg-surface-3" /> });

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2", className)} aria-label="FI6900 home">
      <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-accent text-bg">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M2 12V2h10M2 7h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.03em]">
        FI<span className="text-muted transition-colors group-hover:text-text">6900</span>
      </span>
    </Link>
  );
}

/** Live index chip: dot + level + premium, widths reserved so ticks never shift the bar. Caller sets display. */
function IndexChip({ className }: { className?: string }) {
  const { data: fund } = useFund();
  const live = useLiveStatus();
  return (
    <Link href="/" className={cn("h-8 items-center gap-2.5 rounded-md px-2.5 text-xs hairline hover:bg-surface-2", className)} title={live.label}>
      <LiveDot tone={live.tone} />
      <NumberTicker value={fund?.indexLevel ?? null} format={(n) => num(n, 2)} reserve="0,000.00" className="text-[13px] font-medium" />
      <Delta value={fund?.premiumBps != null ? fund.premiumBps / 100 : null} size="xs" reserve />
    </Link>
  );
}

export function TopBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="wrap flex h-14 items-center gap-6">
        <Wordmark />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", active ? "text-text" : "text-muted hover:text-text")}>
                {n.label}
                {active && <span className="absolute inset-x-3 -bottom-[13px] h-px bg-accent" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <IndexChip className="hidden md:inline-flex" />
          <WalletButton />
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            // Absolute (not fixed): the header's backdrop-filter makes it the containing block anyway.
            className="absolute inset-x-0 top-full z-40 flex h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto bg-bg lg:hidden"
            aria-label="Mobile"
          >
            <div className="wrap flex flex-1 flex-col pt-4">
              {NAV_ALL.map((n) => {
                const active = isActive(n.href);
                return (
                  <Link key={n.href} href={n.href} className={cn("flex h-14 items-center justify-between border-b border-line text-lg font-medium tracking-[-0.01em]", active ? "text-text" : "text-muted")}>
                    {n.label}
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </Link>
                );
              })}
              <div className="py-6">
                <IndexChip className="inline-flex" />
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
