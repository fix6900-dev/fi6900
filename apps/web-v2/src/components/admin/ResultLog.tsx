"use client";

import type { AdminError } from "@/lib/api";
import type { AdminProposalResult } from "@/lib/schemas";
import { relTime } from "@/lib/format";
import { Card, CardHeader } from "../ui/Card";
import { ResultBox } from "./ResultBox";

export type LogEntry = { ts: number; title: string; result?: AdminProposalResult; error?: AdminError };

/** Session-local record of every admin mutation and what the keeper returned. Not persisted. */
export function ResultLog({ entries, onClear }: { entries: LogEntry[]; onClear: () => void }) {
  if (entries.length === 0) return null;
  return (
    <Card>
      <CardHeader
        eyebrow="This session"
        title="Mutation results"
        right={
          <button type="button" onClick={onClear} className="text-xs text-muted hover:text-ink">
            clear
          </button>
        }
      />
      <div className="flex flex-col gap-2 px-5 py-4">
        {entries.map((e, i) => (
          <div key={`${e.ts}-${i}`} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 font-mono text-[11px]">
              <span className="text-dim">{relTime(e.ts)}</span>
              <span className="text-muted">{e.title}</span>
            </div>
            <ResultBox result={e.result} error={e.error} />
          </div>
        ))}
      </div>
    </Card>
  );
}
