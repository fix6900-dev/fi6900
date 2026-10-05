import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col items-start gap-6 px-4 py-32 sm:px-6">
      <div className="eyebrow">404</div>
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">This page is not in the index.</h1>
      <p className="max-w-md text-muted">It may have fallen below the rank-50 buffer. Check the methodology, or head back to the fund.</p>
      <div className="flex gap-2">
        <Button href="/" variant="primary">Back to index</Button>
        <Button href="/methodology">Methodology</Button>
      </div>
      <Link href="/verify" className="text-sm text-muted hover:text-text">Verify holdings →</Link>
    </div>
  );
}
