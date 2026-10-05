"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { solscan } from "@/lib/solscan";
import { truncateMiddle } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

export type Note = {
  /** Short description of what the figure is. */
  label: string;
  /** On-chain account the figure reads from, when there is one. */
  address?: string | null;
  kind?: "account" | "token" | "tx";
  /** Where the figure comes from when it has no on-chain account. */
  source?: string;
};

/** Superscript pastel-blue marker. Opens a popover with the account, copy and "View on Solscan". */
export function Fn({ n, note }: { n: number; note: Note }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        pinned.current = false;
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pinned.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hoverOpen = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pinned.current) return;
    timer.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <span ref={wrap} className="fn-wrap" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button type="button" className="fn" aria-expanded={open} aria-controls={id} aria-label={`Footnote ${n}: ${note.label}`} onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          if (open && pinned.current) {
            pinned.current = false;
            setOpen(false);
          } else {
            pinned.current = true;
            setOpen(true);
          }
        }} onFocus={hoverOpen}>
        {n}
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="dialog"
            aria-label={`Source for footnote ${n}`}
            className="pop"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="micro muted pop-k">Source {n}</span>
            <span className="pop-t">{note.label}</span>
            {note.address ? (
              <>
                <span className="addr pop-a">
                  <span title={note.address}>{truncateMiddle(note.address, 6, 6)}</span>
                  <CopyButton value={note.address} />
                </span>
                <a className="lnk pop-l" href={solscan(note.kind ?? "account", note.address)} target="_blank" rel="noreferrer noopener">
                  View on Solscan ↗
                </a>
              </>
            ) : (
              <span className="faint pop-a">{note.source ?? "Keeper snapshot"}</span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Factsheet-style notes block that closes a section. */
export function Notes({ notes, asOf }: { notes: Note[]; asOf?: string }) {
  if (notes.length === 0) return null;
  return (
    <ol className="notes" aria-label="Notes">
      {notes.map((n, i) => (
        <li key={i}>
          <span className="notes-n">{i + 1}</span>
          <span>
            {n.label}
            {n.address ? (
              <>
                {" "}
                <a className="lnk" href={solscan(n.kind ?? "account", n.address)} target="_blank" rel="noreferrer noopener" title={n.address}>
                  {truncateMiddle(n.address, 4, 4)} · Solscan ↗
                </a>
              </>
            ) : (
              <> · {n.source ?? "keeper snapshot"}</>
            )}
            {asOf ? <> · as of {asOf}</> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
