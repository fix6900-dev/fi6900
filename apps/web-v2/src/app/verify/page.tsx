import type { Metadata } from "next";
import { VerifyView } from "@/components/views/VerifyView";

export const metadata: Metadata = { title: "Verify" };
export default function Page() {
  return <VerifyView />;
}
