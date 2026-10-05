import type { Metadata } from "next";
import { CreateView } from "@/components/views/CreateView";

export const metadata: Metadata = { title: "Create and redeem" };
export default function Page() {
  return <CreateView />;
}
