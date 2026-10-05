"use client";

import type { ReactNode, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ children, className, maxHeight }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={cn("tw", className)} style={maxHeight ? { maxHeight } : undefined} tabIndex={0}>
      {children}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn("t", className)}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function Th({ children, align = "left", className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th className={cn("micro", align === "right" && "r", align === "center" && "c", className)} {...rest}>
      {children}
    </th>
  );
}

export function SortTh({
  children,
  active,
  dir,
  onClick,
  align = "left",
  className,
}: {
  children: ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <Th align={align} className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} className={cn("sortbtn", active && "is-active")}>
        {children}
        <span className="sortglyph" aria-hidden>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </Th>
  );
}

export function Td({ children, align = "left", className, mono, colSpan }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string; mono?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn(align === "right" && "r", align === "center" && "c", mono && "m", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty">
        {children}
      </td>
    </tr>
  );
}
