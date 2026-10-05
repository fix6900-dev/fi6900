import type { Metadata } from "next";
import { VerifyView } from "@/components/verify/VerifyView";

export const metadata: Metadata = { title: "Verify", description: "Program id, fund PDA, mint authority proof and every vault account, deep-linked to Solscan." };

export default function VerifyPage() {
  return <VerifyView />;
}
