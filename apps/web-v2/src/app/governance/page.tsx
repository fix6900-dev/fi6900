import type { Metadata } from "next";
import { GovernanceView } from "@/components/views/GovernanceView";

export const metadata: Metadata = { title: "Governance", description: "Token-weighted, signature-based voting by $FIX6900 holders on constituents and keeper parameters." };
export default function Page() {
  return <GovernanceView />;
}
