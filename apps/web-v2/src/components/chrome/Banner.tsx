"use client";

import { useDemoMode, useFund } from "@/lib/api";

/** Full-width pastel-orange strip with one plain sentence. Shown only when it applies. */
export function Banner() {
  const { demo } = useDemoMode();
  const { data: fund } = useFund();
  const paused = !demo && !!fund && Number(fund.paused) !== 0;
  if (!demo && !paused) return null;
  return (
    <div className="banner" role="status">
      <div className="page banner-in">
        {demo ? (
          <p>Demo data: the keeper API is unreachable. Figures below are sample values. Reconnecting in the background.</p>
        ) : (
          <p>The fund is paused. Creation, redemption and auctions are disabled until the authority resumes it.</p>
        )}
      </div>
    </div>
  );
}
