import type { Metadata } from "next";
import { BuyView } from "@/components/views/BuyView";

export const metadata: Metadata = { title: "Buy" };
export default function Page() {
  return <BuyView />;
}
