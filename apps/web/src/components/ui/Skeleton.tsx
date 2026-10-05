import { cn } from "@/lib/utils";

/** Static placeholder: no pulse, so loading states stay quiet. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("inline-block rounded bg-surface-3", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="h-11 px-3">
              <Skeleton className={cn("h-3", c === 0 ? "w-28" : "w-16")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
