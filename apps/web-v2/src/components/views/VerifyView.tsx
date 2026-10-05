"use client";

import { useMemo } from "react";
import { useGovernance, useHoldings, useVerify } from "@/lib/api";
import { env, REPO } from "@/lib/env";
import { tokens, usd } from "@/lib/format";
import { useInViewOnce } from "@/lib/motion";
import { solscanAccount } from "@/lib/solscan";
import { Address } from "../ui/Address";
import { CheckGlyph, stateFor, useRunner } from "../ui/Check";
import { CopyButton } from "../ui/CopyButton";
import { Skeleton } from "../ui/Skeleton";
import { TokenLogo } from "../ui/TokenLogo";

const UNSET = <span className="faint">not set</span>;

function Code({ children }: { children: string }) {
  return (
    <div className="codewrap">
      <pre className="code">
        <code>{children}</code>
      </pre>
      <CopyButton value={children.replace(/^#.*$/gm, "").trim()} className="code-copy" label="Copy commands" />
    </div>
  );
}

export function VerifyView() {
  const { data, isLoading } = useVerify();
  const { data: gov } = useGovernance();
  const { data: holdings } = useHoldings();
  const byMint = useMemo(() => new Map((holdings ?? []).map((h) => [h.mint, h])), [holdings]);
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const programId = env.programId || data?.programId;
  const mintOk = data ? data.mintAuthority === data.fundPda : null;
  const ownersOk = data ? data.vaults.every((v) => v.owner === data.fundPda) : null;
  const ready = !!data && seen;
  const resolved = useRunner(ready, 2);
  const timelock = gov ? Number(gov.timelockSlots) : null;
  const cluster = env.cluster === "mainnet-beta" ? "" : ` --url ${env.cluster === "localnet" ? "localhost" : env.cluster}`;

  const rows: { k: string; v: React.ReactNode; note?: React.ReactNode }[] = [
    { k: "Program id", v: programId ? <Address value={programId} full /> : UNSET, note: "The FI6900 program. All vault and mint authority derives from it." },
    { k: "Fund PDA", v: data ? <Address value={data.fundPda} full /> : UNSET, note: <>Derivation: <span className="m">seeds = [&quot;fund&quot;, index_mint]</span></> },
    { k: "Index mint", v: data ? <Address value={data.indexMint} kind="token" full /> : UNSET },
    { k: "Mint authority", v: data ? <Address value={data.mintAuthority} full /> : UNSET },
    {
      k: "Upgrade authority",
      v: data ? data.upgradeAuthority ? <Address value={data.upgradeAuthority} full /> : <span className="chip chip-verified">burned</span> : UNSET,
      note: data?.upgradeAuthority ? (
        <>
          <span className="chip chip-pending">holders trust this key</span> It can replace the program. The upgrade authority is held by the developer at launch and is scheduled to move to a Realms DAO governed by $FI holders.{" "}
          <a className="lnk" href={`${REPO}/blob/main/docs/mainnet-go-live.md`} target="_blank" rel="noreferrer noopener">
            Go-live plan ↗
          </a>
        </>
      ) : data ? (
        "No key can change the program."
      ) : undefined,
    },
    { k: "Program data", v: data?.programDataAddress ? <Address value={data.programDataAddress} full /> : UNSET },
    { k: "Lookup table", v: data?.lookupTable ? <Address value={data.lookupTable} full /> : UNSET },
    { k: "IDL hash", v: data?.idlHash ? <span className="m brk">{data.idlHash} <CopyButton value={data.idlHash} /></span> : <span className="faint">not published</span> },
    { k: "Timelock", v: timelock == null ? UNSET : <span className="m">{timelock.toLocaleString()} slots</span>, note: timelock === 0 ? (env.cluster === "mainnet-beta" ? "Timelock is 0 slots." : "Timelock: 0 slots on devnet (48 h on mainnet).") : undefined },
    { k: "Fund authority", v: gov ? <Address value={gov.fundAuthority} full /> : UNSET },
    { k: "Rebalancer", v: gov ? <Address value={gov.rebalancer} full /> : UNSET },
    { k: "Fee recipient", v: gov ? <Address value={gov.feeRecipient} full /> : UNSET },
  ];

  return (
    <div className="page pagebody">
      <header className="pagehead">
        <div className="pagehead-rule" />
        <div className="micro muted">Verify</div>
        <h1 className="h1">Verify it.</h1>
        <p className="lede">Do not trust this page. Every value below can be read from chain with the commands at the bottom.</p>
      </header>

      <div ref={ref} className="proof">
        <div className="proofrow">
          <CheckGlyph state={stateFor(0, resolved, ready, mintOk)} />
          <div>
            <b>Mint authority equals fund PDA</b>
            <p className="faint">{ready && resolved > 0 ? (mintOk ? "Nobody can print units without delivering the basket." : "does not equal ×. Investigate before using this fund.") : "reading from chain"}</p>
          </div>
        </div>
        <div className="proofrow">
          <CheckGlyph state={stateFor(1, resolved, ready, ownersOk)} />
          <div>
            <b>
              {data ? data.vaults.filter((v) => v.owner === data.fundPda).length : "—"} of {data?.vaults.length ?? "—"} vaults owned by fund PDA
            </b>
            <p className="faint">Constituent coins only move through program instructions.</p>
          </div>
        </div>
      </div>

      <section className="sec" aria-labelledby="facts-h">
        <h2 id="facts-h" className="h2">
          Accounts
        </h2>
        <dl className="facts">
          {rows.map((r) => (
            <div key={r.k} className="fact">
              <dt className="micro muted">{r.k}</dt>
              <dd>
                {isLoading && !data ? <Skeleton className="w-28" /> : r.v}
                {r.note && <p className="faint">{r.note}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="sec" id="vaults" aria-labelledby="vaults-h">
        <h2 id="vaults-h" className="h2">
          Vaults
        </h2>
        <p className="sec-lede">Each vault is a token account owned by the fund PDA. Amount is the raw on-chain balance.</p>
        <div className="tw" tabIndex={0}>
          <table className="t">
            <thead>
              <tr>
                <th className="micro">Coin</th>
                <th className="micro">Mint</th>
                <th className="micro">Vault</th>
                <th className="micro">Owner</th>
                <th className="micro">Owner is fund PDA</th>
                <th className="micro r">Amount</th>
                <th className="micro r">Value</th>
              </tr>
            </thead>
            <tbody>
              {!data
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, c) => (
                        <td key={c}>
                          <Skeleton className="w-16" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data.vaults.map((v) => {
                    const h = byMint.get(v.mint);
                    const dec = v.decimals ?? h?.decimals ?? 0;
                    const ok = v.owner === data.fundPda;
                    return (
                      <tr key={v.vault}>
                        <td>
                          <span className="cellrow">
                            <TokenLogo symbol={v.symbol ?? h?.symbol ?? "?"} mint={v.mint} src={h?.logo} size={20} />
                            <b>{v.symbol ?? h?.symbol ?? "—"}</b>
                          </span>
                        </td>
                        <td>
                          <Address value={v.mint} kind="token" head={4} tail={4} />
                        </td>
                        <td>
                          <Address value={v.vault} head={4} tail={4} />
                        </td>
                        <td>
                          <Address value={v.owner} head={4} tail={4} copy={false} />
                        </td>
                        <td>{ok ? <span className="chip chip-verified">✓ yes</span> : <span className="chip chip-down">× no</span>}</td>
                        <td className="r m">{dec ? tokens(v.amount, dec, 2) : v.amount}</td>
                        <td className="r m muted">{h ? usd(h.valueUsd) : "—"}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec" aria-labelledby="cli-h">
        <h2 id="cli-h" className="h2">
          Check it yourself
        </h2>
        <ol className="cli">
          <li>
            <h3 className="h3">
              <span className="muted">01</span> Confirm the mint authority is the fund PDA
            </h3>
            <Code>{`spl-token display ${data?.indexMint ?? "<INDEX_MINT>"}${cluster}\n# Mint authority: ${data?.fundPda ?? "<FUND_PDA>"}`}</Code>
          </li>
          <li>
            <h3 className="h3">
              <span className="muted">02</span> Derive the PDA and check it matches
            </h3>
            <Code>{`node -e 'const {PublicKey}=require("@solana/web3.js");const [p]=PublicKey.findProgramAddressSync([Buffer.from("fund"),new PublicKey("${data?.indexMint ?? "<INDEX_MINT>"}").toBuffer()],new PublicKey("${programId ?? "<PROGRAM_ID>"}"));console.log(p.toBase58())'`}</Code>
          </li>
          <li>
            <h3 className="h3">
              <span className="muted">03</span> Read a vault and its owner
            </h3>
            <Code>{`spl-token account-info --address ${data?.vaults[0]?.vault ?? "<VAULT>"}${cluster}\n# Owner: ${data?.fundPda ?? "<FUND_PDA>"}`}</Code>
          </li>
          <li>
            <h3 className="h3">
              <span className="muted">04</span> Check the program and its authority
            </h3>
            <Code>{`solana program show ${programId ?? "<PROGRAM_ID>"}${cluster}\nanchor idl fetch ${programId ?? "<PROGRAM_ID>"}${cluster ? ` --provider.cluster ${env.cluster}` : ""} | sha256sum`}</Code>
          </li>
          <li>
            <h3 className="h3">
              <span className="muted">05</span> Read the fund account
            </h3>
            <Code>{`solana account ${data?.fundPda ?? "<FUND_PDA>"} --output json${cluster}`}</Code>
          </li>
        </ol>
        {data && (
          <p>
            <a className="lnk" href={solscanAccount(data.fundPda)} target="_blank" rel="noreferrer noopener">
              Open the fund PDA on Solscan ↗
            </a>
          </p>
        )}
      </section>
    </div>
  );
}
