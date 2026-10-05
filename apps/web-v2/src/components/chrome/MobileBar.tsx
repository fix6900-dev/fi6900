"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Sticky bottom bar on home and buy, below 1024px. On home it appears once the hero buttons have scrolled away. */
export function MobileBar() {
  const path = usePathname();
  const [heroCta, setHeroCta] = useState(path === "/");
  useEffect(() => {
    if (path !== "/") {
      setHeroCta(false);
      return;
    }
    const el = document.querySelector(".hero .cta");
    if (!el || typeof IntersectionObserver === "undefined") {
      setHeroCta(false);
      return;
    }
    const io = new IntersectionObserver((entries) => setHeroCta(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [path]);
  if (path !== "/" && path !== "/buy") return null;
  if (heroCta) return null;
  return (
    <div className="mobilebar" role="region" aria-label="Quick actions">
      <Link href="/buy" className="btn btn-primary btn-lg">
        Buy $FIX6900
      </Link>
      <Link href="/verify" className="btn btn-secondary btn-lg">
        Verify
      </Link>
    </div>
  );
}
