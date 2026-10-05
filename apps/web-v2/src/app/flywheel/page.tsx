import type { Metadata } from "next";
import { FlywheelView } from "@/components/views/FlywheelView";

export const metadata: Metadata = { title: "Flywheel" };
export default function Page() {
  return <FlywheelView />;
}
