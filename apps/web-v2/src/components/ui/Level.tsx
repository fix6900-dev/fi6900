"use client";

import { useEffect, useRef, useState } from "react";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The Level. Every digit sits in a fixed 1ch cell with overflow hidden and rolls like an odometer; the roll
 * is a CSS transform transition (<= 600ms) so it needs no animation runtime and always lands on the real
 * value. Punctuation keeps the font's natural advance and never rolls. Font size scales with the glyph
 * count so the whole number fits the page width without any glyph box overlapping another.
 * On first data the digits roll from the base level (1000.00), a real number in the methodology, never from 0.
 */
export function Level({ value, base = 1000, loading, label = "Index level" }: { value: number | null | undefined; base?: number; loading?: boolean; label?: string }) {
  const target = value != null && Number.isFinite(value) ? fmt(value) : null;
  // `cur` is the string currently drawn. It starts at the base so the first real value rolls from there.
  const [cur, setCur] = useState(() => fmt(base));
  const [hasData, setHasData] = useState(false);
  const rolled = useRef(false);

  useEffect(() => {
    if (target == null) return;
    if (!rolled.current) {
      rolled.current = true;
      // Paint the base first, then roll to the target a tick later so the transition is visible.
      // A timer, not requestAnimationFrame: rAF never fires in a background or throttled tab, and the
      // real value must land regardless.
      setHasData(true);
      const t = setTimeout(() => setCur(target), 30);
      return () => clearTimeout(t);
    }
    setCur(target);
  }, [target]);

  const pending = !hasData;
  const glyphs = cur.split("");
  const n = glyphs.length;

  return (
    <div className={`level${loading || target == null ? " is-loading" : ""}`} style={{ ["--glyphs" as string]: n }} role="img" aria-label={target ? `${label} ${target}` : `${label}: loading`} aria-busy={target == null}>
      {glyphs.map((g, i) => {
        const fromRight = n - 1 - i;
        if (pending) {
          // Pre-data: one dash in the first cell, empty 1ch cells after it, punctuation hidden but keeping its width.
          return i === 0 ? (
            <span key="pend0" className="od od-dash" aria-hidden>
              —
            </span>
          ) : (
            <span key={`pend${i}`} className={/\d/.test(g) ? "od" : "od-p od-hide"} aria-hidden>
              {/\d/.test(g) ? "" : g}
            </span>
          );
        }
        if (!/\d/.test(g)) {
          return (
            <span key={`p${fromRight}`} className="od-p" aria-hidden>
              {g}
            </span>
          );
        }
        const d = Number(g);
        return (
          <span key={`d${fromRight}`} className="od" aria-hidden>
            <span className="od-strip" style={{ transform: `translateY(${-d * 10}%)`, transitionDelay: `${Math.min(fromRight, 6) * 20}ms` }}>
              {DIGITS.map((x) => (
                <span key={x} className="od-d">
                  {x}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
}
