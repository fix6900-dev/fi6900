import type { Metadata } from "next";
import { GovProposalView } from "@/components/views/GovProposalView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Proposal #${id}` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GovProposalView id={id} />;
}
