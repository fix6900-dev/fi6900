"use client";

import type { ReactNode } from "react";
import { useInViewOnce } from "@/lib/motion";

/**
 * Section opener: a 2px ink rule that draws left to right when the head first enters view, the section
 * number ("03.") and a mono h2. The number is static: it is a label, not a figure.
 */
export function SectionHead({ n, title, id, right }: { n: number; title: ReactNode; id?: string; right?: ReactNode }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const num = `${String(n).padStart(2, "0")}.`;
  return (
    <div ref={ref} className={`sec-head${seen ? " in" : ""}`} id={id}>
      <span className="sec-rule" aria-hidden />
      <span className="sec-num">{num}</span>
      <h2 className="h2">{title}</h2>
      {right && <div className="sec-right">{right}</div>}
    </div>
  );
}
