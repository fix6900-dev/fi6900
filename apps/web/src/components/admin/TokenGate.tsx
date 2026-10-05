"use client";

import { useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextInput, Warn } from "./controls";

export type AuthState = { kind: "none" } | { kind: "ok" } | { kind: "rejected"; status: number; message: string };

export function TokenGate({ token, onChange, auth, demo }: { token: string; onChange: (t: string) => void; auth: AuthState; demo: boolean }) {
  const [draft, setDraft] = useState(token);
  const [show, setShow] = useState(false);
  const dirty = draft !== token;
  return (
    <Card className="px-5 py-4">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          onChange(draft.trim());
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="eyebrow">Admin token</span>
          <TextInput
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ADMIN_TOKEN"
            autoComplete="off"
            spellCheck={false}
            aria-label="Admin token"
            data-1p-ignore
            data-lpignore="true"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)}>
            {show ? "Hide" : "Show"}
          </Button>
          <Button type="submit" variant={dirty ? "primary" : "secondary"} size="sm" disabled={!dirty}>
            Use token
          </Button>
          {token && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-dim">
        <span>Stored in sessionStorage for this tab only; sent as <code className="font-mono text-muted">Authorization: Bearer</code> on admin requests. Never logged.</span>
        {token ? <span className="font-mono text-muted">token set · {token.length} chars</span> : <span className="font-mono text-amber">no token · read-only</span>}
      </div>
      {demo && <div className="mt-3"><Warn tone="amber">Keeper unreachable — showing demo fixtures. Admin actions are disabled until the API is back.</Warn></div>}
      {auth.kind === "rejected" && (
        <div className="mt-3">
          <Warn>
            {auth.status === 401 && <>401 — the keeper rejected this token (<span className="font-mono">{auth.message}</span>). Check ADMIN_TOKEN on the keeper and re-enter it.</>}
            {auth.status === 403 && <>403 — the admin API is disabled on this keeper (<span className="font-mono">{auth.message}</span>). Set ADMIN_TOKEN and restart it.</>}
            {auth.status === 503 && <>503 — <span className="font-mono">{auth.message}</span>. The keeper is in mock mode; admin actions need a live provider.</>}
            {![401, 403, 503].includes(auth.status) && <>{auth.status ? `${auth.status} — ` : ""}<span className="font-mono">{auth.message}</span></>}
          </Warn>
        </div>
      )}
    </Card>
  );
}
