"use client";

import { useCallback, useMemo, useState } from "react";
import { useAdminMutations, useDemoMode } from "@/lib/api";
import { PageHeader } from "../ui/Card";
import { GovernancePanel } from "./GovernancePanel";
import { GovProposalsPanel } from "./GovProposalsPanel";
import { ManualAssetForm } from "./ManualAssetForm";
import { ProposalsPanel } from "./ProposalsPanel";
import { ReconstitutionStatus } from "./ReconstitutionStatus";
import { ResultLog, type LogEntry } from "./ResultLog";
import { TokenGate, type AuthState } from "./TokenGate";
import { useAdminToken } from "./useAdminToken";

export function AdminView() {
  const { token, setToken, getToken, ready } = useAdminToken();
  const { demo } = useDemoMode();
  const m = useAdminMutations(getToken);
  const [log, setLog] = useState<LogEntry[]>([]);
  const onLog = useCallback((e: LogEntry) => setLog((l) => [e, ...l].slice(0, 50)), []);

  // Auth state follows the most recent mutation outcome; changing the token resets it.
  const auth = useMemo<AuthState>(() => {
    const last = log[0];
    if (!last) return { kind: "none" };
    if (last.error && (last.error.status === 401 || last.error.status === 403 || last.error.status === 503)) return { kind: "rejected", status: last.error.status, message: last.error.message };
    return last.result ? { kind: "ok" } : { kind: "none" };
  }, [log]);

  const canMutate = ready && token.length > 0 && !demo;

  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Index committee" title="Admin" desc="Review methodology proposals, approve or reject them, add or remove assets by hand, and watch the timelock queue. Reads are public; writes need the keeper's ADMIN_TOKEN." />
      <div className="flex flex-col gap-6">
        <TokenGate
          token={token}
          onChange={(t) => {
            setToken(t);
            setLog([]);
          }}
          auth={auth}
          demo={demo}
        />
        <ResultLog entries={log} onClear={() => setLog([])} />
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          <ReconstitutionStatus />
          <ManualAssetForm m={m} canMutate={canMutate} onLog={onLog} />
        </div>
        <ProposalsPanel m={m} canMutate={canMutate} onLog={onLog} />
        <GovProposalsPanel getToken={getToken} canMutate={canMutate} />
        <GovernancePanel />
      </div>
    </div>
  );
}
