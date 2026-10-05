import type { Metadata } from "next";
import { FlywheelView } from "@/components/flywheel/FlywheelView";

export const metadata: Metadata = { title: "Flywheel", description: "How $FI creator fees fund the index and index fees burn $FI. Live counters, airdrop lookup and event feed." };

export default function FlywheelPage() {
  return <FlywheelView />;
}
