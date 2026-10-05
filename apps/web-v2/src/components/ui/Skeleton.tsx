import { cn } from "@/lib/utils";

/** Static placeholder bar. No pulse: loading states stay quiet. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("skel", className)} aria-hidden />;
}

export function SkeletonRows({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <Skeleton className={c === 0 ? "w-28" : "w-16"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
