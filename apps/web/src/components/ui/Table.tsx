"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function TableWrap({ children, className, maxHeight }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={cn("relative w-full overflow-auto rounded-lg bg-surface hairline", className)} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn("w-full border-collapse text-[13px]", className)}>{children}</table>;
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface [&_th]:border-b [&_th]:border-line">{children}</thead>;
}

export function Th({ children, align = "left", className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th className={cn("eyebrow h-10 whitespace-nowrap px-3 font-medium", align === "right" && "text-right", align === "center" && "text-center", className)} {...rest}>
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
      <button type="button" onClick={onClick} className={cn("inline-flex h-full items-center gap-1 uppercase transition-colors hover:text-text", active && "text-text", align === "right" && "flex-row-reverse")}>
        {children}
        {/* The icon slot is always reserved so headers never shift when the sort changes. */}
        <span className={cn("inline-flex w-[11px] justify-center", active ? "text-text" : "text-transparent")}>{dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
      </button>
    </Th>
  );
}

export function Td({ children, align = "left", className, mono, colSpan }: { children?: ReactNode; align?: "left" | "right" | "center"; className?: string; mono?: boolean; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("h-11 whitespace-nowrap px-3 align-middle", align === "right" && "text-right", align === "center" && "text-center", mono && "font-mono tabular-nums", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-24 text-center text-sm text-muted">
        {children}
      </td>
    </tr>
  );
}
