import type { Metadata } from "next";
import { AdminView } from "@/components/admin/AdminView";

export const metadata: Metadata = { title: "Committee console", robots: { index: false, follow: false } };
export default function Page() {
  return <AdminView />;
}
