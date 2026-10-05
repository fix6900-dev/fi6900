"use client";

import { useState } from "react";
import type { useAdminMutations } from "@/lib/api";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Tabs } from "../ui/Tabs";
import { Field, TextInput, Toggle, Warn } from "./controls";
import type { LogEntry } from "./ResultLog";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** POST /v1/admin/assets — creates a pre-approved manual proposal. API validation errors are shown verbatim in the log. */
export function ManualAssetForm({ m, canMutate, onLog }: { m: ReturnType<typeof useAdminMutations>; canMutate: boolean; onLog: (e: LogEntry) => void }) {
  const [action, setAction] = useState<"add" | "remove">("add");
  const [mint, setMint] = useState("");
  const [weight, setWeight] = useState("");
  const [immediate, setImmediate] = useState(false);
  const [force, setForce] = useState(false);
  const mintTrim = mint.trim();
  const mintBad = mintTrim !== "" && !MINT_RE.test(mintTrim);
  const weightNum = weight.trim() === "" ? undefined : Number(weight);
  const weightBad = weightNum !== undefined && (!Number.isInteger(weightNum) || weightNum < 0 || weightNum > 10_000);
  const busy = m.asset.isPending;
  const ready = canMutate && MINT_RE.test(mintTrim) && !weightBad && !busy;

  return (
    <Card>
      <CardHeader eyebrow="Manual" title="Add or remove an asset" right={<Tabs size="sm" id="asset-action" value={action} onChange={setAction} items={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }]} />} />
      <form
        className="flex flex-col gap-4 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const title = `${action} ${mintTrim.slice(0, 6)}…${immediate ? " (immediate)" : ""}${force ? " (force)" : ""}`;
          m.asset.mutate(
            { mint: mintTrim, action, weightBps: action === "add" ? weightNum : undefined, immediate, force: action === "add" ? force : false },
            {
              onSuccess: (result) => {
                onLog({ ts: Date.now(), title, result });
                setMint("");
                setWeight("");
                setImmediate(false);
                setForce(false);
              },
              onError: (error) => onLog({ ts: Date.now(), title, error }),
            },
          );
        }}
      >
        <Field label="Mint address" hint={action === "add" ? "Must exist on-chain. Mint and freeze authority must be revoked unless force is set." : "Must be a current constituent. Removal auctions the position out over the following cycles."}>
          <TextInput value={mint} onChange={(e) => setMint(e.target.value)} placeholder="base58 mint" spellCheck={false} autoComplete="off" aria-invalid={mintBad} />
        </Field>
        {mintBad && <div className="-mt-2 text-xs text-neg">Not a valid base58 address.</div>}
        {action === "add" && (
          <Field label="Weight bps (optional)" hint="Blank = equal weight (1/N recomputed when queued)." className="sm:w-56">
            <TextInput inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 250" aria-invalid={weightBad} />
          </Field>
        )}
        {weightBad && <div className="-mt-2 text-xs text-neg">Weight must be an integer between 0 and 10000.</div>}
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          <Toggle checked={immediate} onChange={setImmediate} label="Queue immediately" tone="neg" />
          {action === "add" && <Toggle checked={force} onChange={setForce} label="Force" tone="neg" />}
        </div>
        {immediate && <Warn>Immediate bypasses the 48 h announcement. The action goes on-chain now; only the program timelock remains before execution.</Warn>}
        {force && action === "add" && <Warn>Force skips the authority-revoked check: a mint whose issuer can still print or freeze supply will be admitted to the basket. Every holder is exposed to that issuer.</Warn>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-dim">{canMutate ? "Creates a pre-approved proposal (status approved; queued if immediate)." : "Enter an admin token to enable."}</span>
          <Button type="submit" size="sm" variant={immediate || force ? "danger" : "primary"} disabled={!ready}>
            {busy ? "Sending…" : action === "add" ? "Add asset" : "Remove asset"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
