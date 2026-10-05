import type { Metadata } from "next";
import { GovNewProposalView } from "@/components/views/GovNewProposalView";

export const metadata: Metadata = { title: "New proposal" };
export default function Page() {
  return <GovNewProposalView />;
}
