import type { Metadata } from "next";
import { BuyView } from "@/components/buy/BuyView";

export const metadata: Metadata = { title: "Buy $FI6900", description: "Swap into the FI6900 memecoin index via Jupiter. Live NAV, market price and premium." };

export default function BuyPage() {
  return <BuyView />;
}
