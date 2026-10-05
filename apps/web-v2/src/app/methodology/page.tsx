import type { Metadata } from "next";
import { MethodologyView } from "@/components/views/MethodologyView";

export const metadata: Metadata = { title: "Methodology" };
export default function Page() {
  return <MethodologyView />;
}
