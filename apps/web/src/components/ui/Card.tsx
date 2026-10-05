import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Single surface primitive: 8px radius, one hairline, no inner shadows. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("rounded-lg bg-surface hairline", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, eyebrow, right, className }: { title: ReactNode; eyebrow?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <div className="text-sm font-semibold tracking-[-0.01em]">{title}</div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function SectionHeader({ eyebrow, title, desc, right, id }: { eyebrow?: string; title: ReactNode; desc?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{title}</h2>
        {desc && <p className="mt-2 text-sm leading-relaxed text-muted">{desc}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Page-level header used by every app route: eyebrow, h1, one short paragraph. */
export function PageHeader({ eyebrow, title, desc, right }: { eyebrow: string; title: ReactNode; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-col gap-5 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <div className="eyebrow mb-3">{eyebrow}</div>
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
        {desc && <p className="mt-3 text-sm leading-relaxed text-muted">{desc}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
