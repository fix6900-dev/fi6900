import type { Metadata } from "next";
import { MethodologyView } from "@/components/methodology/MethodologyView";

export const metadata: Metadata = { title: "Methodology", description: "FI6900 index methodology: eligibility, selection, equal weighting, rebalance cadence and reconstitution." };

export default function MethodologyPage() {
  return <MethodologyView />;
}
