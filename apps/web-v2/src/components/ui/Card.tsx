import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Square ruled panel. The only place cards are allowed (auctions, forms, admin). */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, eyebrow, right, className }: { title: ReactNode; eyebrow?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("card-head", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="micro muted">{eyebrow}</div>}
        <div className="card-title">{title}</div>
      </div>
      {right && <div className="card-right">{right}</div>}
    </div>
  );
}

/** Plain sub-heading used between panels on a page. */
export function SectionHeader({ eyebrow, title, desc, right, id }: { eyebrow?: string; title: ReactNode; desc?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="subhead">
      <div>
        {eyebrow && <div className="micro muted">{eyebrow}</div>}
        <h2 className="h3">{title}</h2>
        {desc && <p className="faint-lede">{desc}</p>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

/** Page header: 2px ink rule, micro label, mono h1 and a serif lede. */
export function PageHeader({ eyebrow, title, desc, right }: { eyebrow: string; title: ReactNode; desc?: ReactNode; right?: ReactNode }) {
  return (
    <header className="pagehead">
      <div className="pagehead-rule" />
      <div className="pagehead-row">
        <div className="pagehead-main">
          <div className="micro muted">{eyebrow}</div>
          <h1 className="h1">{title}</h1>
          {desc && <p className="lede">{desc}</p>}
        </div>
        {right && <div className="pagehead-right">{right}</div>}
      </div>
    </header>
  );
}
