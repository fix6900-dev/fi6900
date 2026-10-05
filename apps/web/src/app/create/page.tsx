import type { Metadata } from "next";
import { CreateConsole } from "@/components/create/CreateConsole";

export const metadata: Metadata = { title: "Create / Redeem", description: "Authorized Participant console: in-kind creation and redemption of FI6900 units." };

export default function CreatePage() {
  return <CreateConsole />;
}
