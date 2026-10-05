"use client";

import Link from "next/link";
import { useFund, useVerify } from "@/lib/api";
import { env, REPO } from "@/lib/env";
import { Address } from "../ui/Address";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="ft-row">
      <dt className="micro muted">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Footer() {
  const { data: fund } = useFund();
  const { data: verify } = useVerify();
  const programId = env.programId || verify?.programId;
  const fundPda = fund?.fundPda ?? verify?.fundPda;
  const indexMint = env.indexMint || fund?.indexMint;
  const authority = verify?.upgradeAuthority;
  return (
    <footer className="footer">
      <div className="page">
        <div className="ft-grid">
          <section aria-labelledby="ft-fund">
            <h2 id="ft-fund" className="micro ft-h">
              Fund
            </h2>
            <dl>
              <Row k="Program id">{programId ? <Address value={programId} /> : "—"}</Row>
              <Row k="Fund PDA">{fundPda ? <Address value={fundPda} /> : "—"}</Row>
              <Row k="Index mint">{indexMint ? <Address value={indexMint} kind="token" /> : "—"}</Row>
              <Row k="Cluster">{env.cluster}</Row>
            </dl>
          </section>
          <section aria-labelledby="ft-index">
            <h2 id="ft-index" className="micro ft-h">
              Index
            </h2>
            <ul className="ft-links">
              <li>
                <Link className="lnk" href="/methodology">
                  Methodology
                </Link>
              </li>
              <li>
                <Link className="lnk" href="/verify">
                  Verify
                </Link>
              </li>
              <li>
                <Link className="lnk" href="/auctions">
                  Auctions
                </Link>
              </li>
              <li>
                <Link className="lnk" href="/flywheel">
                  Flywheel
                </Link>
              </li>
            </ul>
          </section>
          <section aria-labelledby="ft-source">
            <h2 id="ft-source" className="micro ft-h">
              Source
            </h2>
            <ul className="ft-links">
              <li>
                <a className="lnk" href={REPO} target="_blank" rel="noreferrer noopener">
                  GitHub repository ↗
                </a>
              </li>
              <li className="ft-small">
                IDL hash: {verify?.idlHash ? <span className="m" title={verify.idlHash}>{verify.idlHash.slice(0, 12)}…</span> : "not published"}
              </li>
              <li className="ft-small">
                Upgrade authority:{" "}
                {verify ? authority ? <Address value={authority} copy={false} /> : "burned" : "—"}
                {verify && authority ? (
                  <>
                    . Held by the developer at launch; scheduled to move to a Realms DAO governed by $FIX6900 holders (
                    <a className="lnk" href={`${REPO}/blob/main/docs/mainnet-go-live.md`} target="_blank" rel="noreferrer noopener">
                      plan ↗
                    </a>
                    ).
                  </>
                ) : null}
              </li>
            </ul>
          </section>
          <section aria-labelledby="ft-notes">
            <h2 id="ft-notes" className="micro ft-h">
              Notes
            </h2>
            <p className="prose-sm">FIX6900 Index is redeemable in-kind for a pro-rata share of the vault. $FIX6900 is the governance and fee token. Nothing on this site is a promise of returns.</p>
          </section>
        </div>
      </div>
    </footer>
  );
}
