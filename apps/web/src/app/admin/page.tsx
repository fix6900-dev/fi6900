import type { Metadata } from "next";
import { AdminView } from "@/components/admin/AdminView";

export const metadata: Metadata = {
  title: "Admin",
  description: "FI6900 index committee: proposals, approvals, manual asset changes and the on-chain timelock queue.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminView />;
}
