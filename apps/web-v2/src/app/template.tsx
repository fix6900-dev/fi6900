import type { ReactNode } from "react";

/**
 * Route change: no entrance animation. Content is legible on the first frame, including in background or
 * throttled tabs where animations stall. Masthead and nav stay still (they live in the layout).
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="route-in">{children}</div>;
}
