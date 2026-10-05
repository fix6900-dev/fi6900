import type { Metadata } from "next";
import { AuctionsView } from "@/components/views/AuctionsView";

export const metadata: Metadata = { title: "Auctions" };
export default function Page() {
  return <AuctionsView />;
}
