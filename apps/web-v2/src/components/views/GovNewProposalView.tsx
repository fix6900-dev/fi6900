"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useDemoMode, useGovernance, useHoldings } from "@/lib/api";
import { useGovEligibility, useGovPropose, useWalletAddress, GOV_MESSAGE_PREFIX } from "@/lib/gov";
import { bpsToPct } from "@/lib/format";
import type { GovKind } from "@/lib/schemas";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { KIND_LABEL, SidePanel, units } from "../governance/GovBits";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function GovNewProposalView() {
  const router = useRouter();
  const wallet = useWalletAddress();
  const { setVisible } = useWalletModal();
  const { demo } = useDemoMode();
  const { data: gov } = useGovernance();
  const { data: holdings } = useHoldings();
  const { data: elig } = useGovEligibility(wallet);
  const propose = useGovPropose();
  const params = gov?.governance?.params.allowedParams ?? [];

  const [kind, setKind] = useState<GovKind>("add_asset");
  const [mint, setMint] = useState("");
  const [symbol, setSymbol] = useState("");
  const [weight, setWeight] = useState("");
  const [allowFee, setAllowFee] = useState(false);
  const [removeMint, setRemoveMint] = useState("");
  const [paramKey, setParamKey] = useState("");
  const [paramValue, setParamValue] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const spec = params.find((p) => p.key === (paramKey || params[0]?.key));
  const key = spec?.key ?? "";

  const problems = useMemo(() => {
    const out: string[] = [];
    if (kind === "add_asset") {
      if (!MINT_RE.test(mint.trim())) out.push("Enter the mint address of the coin to add.");
      if (holdings?.some((h) => h.mint === mint.trim())) out.push("That mint is already a constituent.");
      if (weight !== "" && !(Number.isInteger(Number(weight)) && Number(weight) >= 1 && Number(weight) <= 10_000)) out.push("Weight must be an integer in 1..10000 bps, or blank for equal weight.");
    }
    if (kind === "remove_asset" && !MINT_RE.test(removeMint)) out.push("Pick the constituent to remove.");
    if (kind === "set_param") {
      if (!spec) out.push("No votable parameters are enabled on this keeper.");
      else {
        const v = Number(paramValue);
        if (paramValue.trim() === "" || !Number.isFinite(v)) out.push(`Enter a value for ${spec.key}.`);
        else if (spec.integer && !Number.isInteger(v)) out.push("Value must be an integer.");
        else if (v < spec.min || v > spec.max) out.push(`Value must be within ${spec.min.toLocaleString("en-US")}–${spec.max.toLocaleString("en-US")} ${spec.unit}.`);
      }
    }
    if (title.trim().length < 4) out.push("Title needs at least 4 characters.");
    if (title.length > 120) out.push("Title is limited to 120 characters.");
    if (description.length > 4000) out.push("Description is limited to 4000 characters.");
    return out;
  }, [kind, mint, weight, holdings, removeMint, spec, paramValue, title, description]);

  const payload = useMemo<Record<string, unknown>>(() => {
    if (kind === "add_asset") {
      const p: Record<string, unknown> = { mint: mint.trim() };
      if (symbol.trim()) p.symbol = symbol.trim().toUpperCase().slice(0, 16);
      if (weight !== "") p.weightBps = Number(weight);
      if (allowFee) p.allowTransferFee = true;
      return p;
    }
    if (kind === "remove_asset") {
      const h = holdings?.find((x) => x.mint === removeMint);
      return h ? { mint: h.mint, symbol: h.symbol } : { mint: removeMint };
    }
    return { key, value: Number(paramValue) };
  }, [kind, mint, symbol, weight, allowFee, holdings, removeMint, key, paramValue]);

  const submit = async () => {
    if (!wallet) return setVisible(true);
    try {
      const p = await propose.mutateAsync({ kind, payload, title: title.trim(), description: description.trim() });
      router.push(`/governance/${p.id}`);
    } catch {
      /* surfaced below */
    }
  };

  const eligible = Boolean(elig?.eligible);
  const blocked = !wallet ? "Connect a wallet to propose." : elig && !eligible ? `This wallet holds ${units(elig.balance)} $FIX6900; ${units(elig.thresholdUnits)} (${bpsToPct(gov?.governance?.params.proposalThresholdBps ?? 50, 2)} of circulating) is required to propose.` : elig && elig.openProposals >= elig.maxOpenPerWallet ? `This wallet already has ${elig.openProposals} open proposal(s); the limit is ${elig.maxOpenPerWallet}.` : demo ? "Keeper unreachable: proposals are unavailable in demo mode." : null;

  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Holder governance" title="New proposal" desc="Pick what to change, write a title and a short case, then sign. The keeper snapshots every holder's balance when the proposal opens and voting runs for the configured window." />
      <p className="faint">
        <Link href="/governance" className="lnk">
          ← All proposals
        </Link>
      </p>
      <div className="split split-gov">
        <section className="split-main" aria-label="Proposal form">
          <form
            className="gov-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset className="panel-b">
              <legend className="micro muted">Kind</legend>
              <div className="gov-kinds" role="radiogroup" aria-label="Proposal kind">
                {(Object.keys(KIND_LABEL) as GovKind[]).map((k) => (
                  <label key={k} className={`gov-kind${kind === k ? " is-on" : ""}`}>
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    <span>{KIND_LABEL[k]}</span>
                    <span className="faint">{k === "add_asset" ? "A mint that passes the checks joins at equal weight (or the weight you set)." : k === "remove_asset" ? "A current constituent is flagged for removal and sold down." : "One whitelisted keeper parameter, within bounds."}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {kind === "add_asset" && (
              <div className="panel-b">
                <label>
                  <span className="micro muted">Mint address</span>
                  <span className="field">
                    <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Base58 mint" spellCheck={false} autoComplete="off" className="m" />
                  </span>
                </label>
                <div className="gov-two">
                  <label>
                    <span className="micro muted">Symbol (optional)</span>
                    <span className="field">
                      <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="GOAT" maxLength={16} className="m" />
                    </span>
                  </label>
                  <label>
                    <span className="micro muted">Target weight, bps (optional)</span>
                    <span className="field">
                      <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={holdings?.length ? `equal = ${Math.floor(10_000 / (holdings.length + 1))}` : "equal"} inputMode="numeric" className="m" />
                    </span>
                  </label>
                </div>
                <label className="gov-check">
                  <input type="checkbox" checked={allowFee} onChange={(e) => setAllowFee(e.target.checked)} />
                  <span className="faint">Allow a Token-2022 transfer-fee mint (rule 2.7 override; every deposit, redemption and auction fill is taxed by its fee authority). Transfer-hook mints are never allowed.</span>
                </label>
              </div>
            )}

            {kind === "remove_asset" && (
              <div className="panel-b">
                <label>
                  <span className="micro muted">Constituent</span>
                  <span className="field field-sm">
                    <select value={removeMint} onChange={(e) => setRemoveMint(e.target.value)} className="m">
                      <option value="">Pick a holding…</option>
                      {(holdings ?? [])
                        .filter((h) => h.status === "active")
                        .sort((a, b) => a.symbol.localeCompare(b.symbol))
                        .map((h) => (
                          <option key={h.mint} value={h.mint}>
                            {h.symbol} · {h.mint.slice(0, 4)}…{h.mint.slice(-4)} · {bpsToPct(h.weightBps, 2)}
                          </option>
                        ))}
                    </select>
                  </span>
                </label>
              </div>
            )}

            {kind === "set_param" && (
              <div className="panel-b">
                <label>
                  <span className="micro muted">Parameter</span>
                  <span className="field field-sm">
                    <select value={key} onChange={(e) => setParamKey(e.target.value)} className="m">
                      {params.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                {spec && (
                  <p className="faint">
                    {spec.label}. Bounds {spec.min.toLocaleString("en-US")}–{spec.max.toLocaleString("en-US")} {spec.unit}; applies to {spec.applies}.
                    {gov?.governance?.overrides[spec.key] != null ? ` In force by vote: ${gov.governance.overrides[spec.key]}.` : ""}
                  </p>
                )}
                <label>
                  <span className="micro muted">Value{spec ? ` (${spec.unit})` : ""}</span>
                  <span className="field">
                    <input value={paramValue} onChange={(e) => setParamValue(e.target.value)} inputMode="decimal" placeholder={spec ? `${spec.min}–${spec.max}` : ""} className="m" />
                  </span>
                </label>
              </div>
            )}

            <div className="panel-b">
              <label>
                <span className="micro muted">Title</span>
                <span className="field">
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="One line, plain words" />
                </span>
              </label>
              <label>
                <span className="micro muted">Description</span>
                <textarea className="field gov-textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={6} placeholder="Why this change, what evidence, what it costs." />
              </label>
            </div>

            <div className="panel-b">
              {problems.length > 0 && title.length + mint.length + paramValue.length + removeMint.length > 0 && (
                <ul className="gov-problems">
                  {problems.map((x) => (
                    <li key={x} className="field-err">
                      {x}
                    </li>
                  ))}
                </ul>
              )}
              {blocked && <p className="field-err">{blocked}</p>}
              {propose.error && <p className="field-err">{propose.error.message}</p>}
              <div className="actions">
                <Button type="submit" variant="primary" disabled={propose.isPending || problems.length > 0 || Boolean(blocked && wallet)}>
                  {propose.isPending ? "Signing…" : wallet ? "Sign and submit" : "Connect wallet"}
                </Button>
                <span className="faint">
                  Signs <span className="m">{GOV_MESSAGE_PREFIX}propose &lt;sha256&gt;</span> with your wallet. No transaction.
                </span>
              </div>
            </div>
          </form>
        </section>

        <aside className="split-side stack" aria-label="Eligibility">
          <SidePanel label="Your eligibility">
            {!wallet ? (
              <div className="faint">Connect a wallet. The keeper checks your live balance against the threshold when you submit.</div>
            ) : elig ? (
              <>
                <div className="side-v m">{units(elig.balance)} $FIX6900</div>
                <div className="faint">
                  Threshold {units(elig.thresholdUnits)} ({bpsToPct(gov?.governance?.params.proposalThresholdBps ?? 50, 2)} of {units(elig.circulatingSupply)} circulating). {eligible ? "You can propose." : "Below threshold."}
                </div>
              </>
            ) : (
              <div className="faint">Checking…</div>
            )}
          </SidePanel>
          <SidePanel label="What happens next">
            <ol className="gov-steps">
              <li>The keeper verifies your signature and threshold, snapshots every holder and opens voting for {gov?.governance?.params.votingHours ?? 48} h.</li>
              <li>Holders sign For / Against / Abstain. Weight is their snapshot balance.</li>
              <li>At close: passed if participation reaches {bpsToPct(gov?.governance?.params.quorumBps ?? 500, 2)} of circulating and for &gt; against.</li>
              <li>Passed add/remove proposals are queued through the on-chain timelock; parameters take effect in the keeper at once.</li>
            </ol>
          </SidePanel>
        </aside>
      </div>
    </div>
  );
}
