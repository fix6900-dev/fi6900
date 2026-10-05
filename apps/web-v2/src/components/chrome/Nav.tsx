"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { env } from "@/lib/env";
import { SPRING } from "@/lib/motion";
import { solscanAccount } from "@/lib/solscan";
import { ThemeToggle } from "./Masthead";

const TABS = [
  { href: "/", label: "Index" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/buy", label: "Buy" },
  { href: "/create", label: "Create" },
  { href: "/auctions", label: "Auctions" },
  { href: "/flywheel", label: "Flywheel" },
  { href: "/verify", label: "Verify" },
  { href: "/methodology", label: "Methodology" },
];

/**
 * Primary nav. At 768px and up the seven section tabs sit in a row with a sliding 2px ink underline.
 * Below 768px the row would clip, so it is replaced by the current section name and a Menu button that
 * opens a ruled sheet with every section plus the Paper / Ink toggle and the Program link.
 */
export function Nav() {
  const path = usePathname() ?? "/";
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The sheet closes on route change, on Escape and when the viewport grows past the breakpoint.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 768px)");
    const onMq = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const current = TABS.find((t) => active(t.href))?.label ?? (path.startsWith("/admin") ? "Committee console" : "");

  return (
    <header className="navbar">
      <nav className="page nav" aria-label="Primary">
        <Link href="/" className="wordmark" aria-label="FIX6900 home">
          FIX6900
        </Link>
        <div className="nav-tabs" ref={tabsRef} data-overflow={overflow || undefined}>
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="nav-tab" aria-current={active(t.href) ? "page" : undefined}>
              {t.label}
              {active(t.href) && <motion.span layoutId="nav-underline" className="nav-u" transition={SPRING} />}
            </Link>
          ))}
        </div>
        <span className="nav-current" aria-hidden>
          {current}
        </span>
        <button type="button" className="nav-menu-btn" aria-expanded={open} aria-controls="nav-sheet" onClick={() => setOpen((o) => !o)}>
          Menu <span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
      </nav>
      {open && (
        <div id="nav-sheet" className="nav-sheet" role="dialog" aria-label="Sections">
          <ul>
            {TABS.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="nav-sheet-link" aria-current={active(t.href) ? "page" : undefined} onClick={() => setOpen(false)}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="nav-sheet-foot micro">
            <ThemeToggle />
            <a className="lnk" href={solscanAccount(env.programId)} target="_blank" rel="noreferrer noopener">
              Program ↗
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
