"use client";

import Link from "next/link";
import { useVerify } from "@/lib/api";
import { REPO } from "@/lib/env";
import { env } from "@/lib/env";
import { useInViewOnce } from "@/lib/motion";
import { Address } from "../ui/Address";
import { CheckGlyph, stateFor, useRunner } from "../ui/Check";
import { SectionHead } from "../ui/SectionHead";

export function VerifyStrip() {
  const { data } = useVerify();
  const [ref, seen] = useInViewOnce<HTMLDivElement>(0.2);
  const ready = !!data && seen;
  const resolved = useRunner(ready, 2);
  const mintOk = data ? data.mintAuthority === data.fundPda : null;
  const owned = data ? data.vaults.filter((v) => v.owner === data.fundPda).length : 0;
  const ownersOk = data ? owned === data.vaults.length : null;
  const programId = env.programId || data?.programId;

  return (
    <section className="sec" aria-labelledby="ver-h">
      <SectionHead n={6} title={<span id="ver-h">Verify</span>} right={<Link href="/verify" className="lnk">Full verification →</Link>} />
      <div ref={ref} className="vstrip">
        <div className="vcol">
          <div className="vcol-h">
            <CheckGlyph state={stateFor(0, resolved, ready, mintOk)} />
            <span className="micro muted">Mint authority</span>
          </div>
          <p className="vcol-t">Mint authority = fund PDA</p>
          <p className="faint">{data ? <Address value={data.mintAuthority} head={6} tail={6} /> : "reading from chain"}</p>
        </div>
        <div className="vcol">
          <div className="vcol-h">
            <CheckGlyph state={stateFor(1, resolved, ready, ownersOk)} />
            <span className="micro muted">Vault owners</span>
          </div>
          <p className="vcol-t">
            {data ? `${owned} of ${data.vaults.length}` : "—"} vaults owned by fund PDA
          </p>
          <p className="faint">
            <Link className="lnk" href="/verify#vaults">
              vault table
            </Link>
          </p>
        </div>
        <div className="vcol">
          <div className="vcol-h">
            <span className="micro muted">Program id</span>
          </div>
          <p className="vcol-t">{programId ? <Address value={programId} head={6} tail={6} /> : "—"}</p>
          <p className="faint">The FIX6900 program. Open source.</p>
        </div>
        <div className="vcol">
          <div className="vcol-h">
            <span className="micro muted">Upgrade authority</span>
          </div>
          <p className="vcol-t">
            {data ? data.upgradeAuthority ? <Address value={data.upgradeAuthority} head={6} tail={6} /> : <span>burned</span> : "—"}
          </p>
          <p>
            {data ? data.upgradeAuthority ? <span className="chip chip-pending">holders trust this key</span> : <span className="chip chip-verified">burned</span> : null}
          </p>
          {data?.upgradeAuthority && (
            <p className="faint">
              Held by the developer at launch; scheduled to move to a Realms DAO governed by $FIX6900 holders.{" "}
              <a className="lnk" href={`${REPO}/blob/main/docs/mainnet-go-live.md`} target="_blank" rel="noreferrer noopener">
                Plan ↗
              </a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
