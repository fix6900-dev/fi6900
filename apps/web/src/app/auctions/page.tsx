import type { Metadata } from "next";
import { AuctionsView } from "@/components/auctions/AuctionsView";

export const metadata: Metadata = { title: "Auctions", description: "Live Dutch auctions rebalancing the FI6900 vault. Permissionless fills." };

export default function AuctionsPage() {
  return <AuctionsView />;
}
