"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useAirdrops, useFlywheel, useFlywheelEvents } from "@/lib/api";
import { compact, dateTime, num, relTime } from "@/lib/format";
import type { EventKind, FlywheelEvent } from "@/lib/schemas";
import { solscanTx } from "@/lib/solscan";
import { truncateMiddle } from "@/lib/utils";
import { FeeLoop, flows24h } from "../flywheel/FeeLoop";
import { Address } from "../ui/Address";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/Card";
import { Countdown, useNow } from "../ui/Countdown";
import { Figure } from "../ui/Figure";
import { Fn, Notes, type Note } from "../ui/Fn";
import { Skeleton } from "../ui/Skeleton";

/** Outline chips: colour is reserved for state, so kind badges carry no fill. */
const KIND: Record<EventKind, string> = {
  claim: "CLAIM",
  buy_index: "MINT",
  add_lp: "LP",
  airdrop: "AIRDROP",
  buyback: "BUYBACK",
  burn: "BURN",
  create: "CREATE",
  redeem: "REDEEM",
  auction_start: "AUCTION",
  auction_fill: "FILL",
  fee_accrual: "FEE",
};

function fmtAmounts(a: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(a)) {
    if (typeof v !== "number" && typeof v !== "string") continue;
    if (k === "source") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      parts.push(`${k} ${String(v)}`);
      continue;
    }
    const raw = k === "units" && Math.abs(n) > 1e6; // raw 6-decimal units from the keeper
    const val = raw ? n / 1e6 : n;
    const s = Math.abs(val) >= 1000 ? compact(val, 2) : num(val, val < 1 ? 4 : 2);
    const unit = k === "sol" ? "SOL" : k === "units" ? "units" : k === "coin" ? "$FIX6900" : k.replace(/([A-Z])/g, " $1").toLowerCase();
    parts.push(`${s} ${unit}`);
  }
  return parts.join(" · ");
}

export function FlywheelView() {
  const { data } = useFlywheel();
  const { data: events } = useFlywheelEvents(100);
  const flows = useMemo(() => flows24h(events), [events]);
  const airdropAt = data?.next.airdropAt ?? null;
  const notes: Note[] = [
    { label: "Creator fees claimed by the keeper from pump.fun and PumpSwap", source: "keeper ledger, tx signatures in the event feed" },
    { label: "Liquidity added to the FI6900/SOL pool", source: "keeper ledger" },
    { label: "FIX6900 units minted from fee SOL and airdropped to $FIX6900 holders", source: "keeper ledger" },
    { label: "$FIX6900 bought with 75% of index fees and burned", source: "keeper ledger" },
  ];

  return (
    <div className="page pagebody">
      <PageHeader eyebrow="Flywheel" title="The coin funds the index. The index burns the coin." desc="$FIX6900 creator fees are split. Half becomes permanent FI6900/SOL liquidity. Half buys the basket, mints units and airdrops them to $FIX6900 holders every 15 minutes. 75% of the index's own fees buy back and burn $FIX6900." />

      <section className="sec" aria-label="Fee flow">
        <div className="fw-big">
          <FeeLoop data={data} flows={flows} />
        </div>
        {data && !data.coinMint && <p className="faint idle-note">Counters start when $FIX6900 launches. Coin mint not set on devnet.</p>}
      </section>

      <dl className="strip5">
        <div>
          <dt className="micro muted">Claimed</dt>
          <dd>
            <Figure value={data?.creatorFeesClaimedSol} format={(n) => num(n, 2)} /> <span className="unit">SOL</span>
            {data && <Fn n={1} note={notes[0]} />}
          </dd>
          <dd className="faint">unclaimed: {data && data.creatorFeesUnclaimedSol != null ? `${num(data.creatorFeesUnclaimedSol, 2)} SOL` : "not available"}</dd>
        </div>
        <div>
          <dt className="micro muted">LP added</dt>
          <dd>
            <Figure value={data?.lpAddedSol} format={(n) => num(n, 2)} /> <span className="unit">SOL</span>
            {data && <Fn n={2} note={notes[1]} />}
          </dd>
        </div>
        <div>
          <dt className="micro muted">Airdropped</dt>
          <dd>
            <Figure value={data?.airdroppedUnits} format={(n) => compact(n, 2)} /> <span className="unit">units</span>
            {data && <Fn n={3} note={notes[2]} />}
          </dd>
          <dd className="faint">{data ? `${data.airdropRounds.toLocaleString()} rounds` : ""}</dd>
        </div>
        <div>
          <dt className="micro muted">$FIX6900 burned</dt>
          <dd>
            <Figure value={data?.burnedCoin} format={(n) => compact(n, 2)} /> <span className="unit">$FIX6900</span>
            {data && <Fn n={4} note={notes[3]} />}
          </dd>
          <dd className="faint">{data ? `${num(data.buybackSol, 2)} SOL of buybacks` : ""}</dd>
        </div>
        <div>
          <dt className="micro muted">Next airdrop</dt>
          <dd>
            {airdropAt ? (
              <span className="chip chip-pending chip-lg">
                <Countdown to={airdropAt} compact showDays={false} />
              </span>
            ) : data ? (
              <span className="m">Not scheduled</span>
            ) : (
              "—"
            )}
          </dd>
          <dd className="faint">{airdropAt ? "every 15 minutes" : "coin not launched"}</dd>
        </div>
      </dl>
      <Notes notes={notes} />

      <div className="split split-fw">
        <AirdropLookup />
        <EventFeed />
      </div>
    </div>
  );
}

function AirdropLookup() {
  const wallet = useWallet();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    if (wallet.publicKey && !input) {
      const k = wallet.publicKey.toBase58();
      setInput(k);
      setQuery(k);
    }
  }, [wallet.publicKey, input]);
  const { data, isLoading, isError } = useAirdrops(query);
  const total = useMemo(() => (data ?? []).reduce((a, r) => a + r.units, 0), [data]);
  const valid = input.trim().length >= 32 && input.trim().length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(input.trim());

  return (
    <section className="panel split-side" aria-label="Airdrop lookup">
      <div className="panel-h">
        <span className="micro muted">Airdrop lookup</span>
      </div>
      <form
        className="panel-b"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setQuery(input.trim());
        }}
      >
        <label>
          <span className="micro muted">Wallet address</span>
          <span className="field">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste a wallet address" aria-invalid={input.length > 0 && !valid} />
          </span>
        </label>
        {input.length > 0 && !valid && <p className="field-err">That is not a valid Solana address.</p>}
        <Button type="submit" variant="primary" disabled={!valid}>
          Look up
        </Button>
      </form>
      <div className="panel-b lookup-out" aria-live="polite">
        {!query ? (
          <p className="faint">Connect a wallet or paste an address to list every airdrop round it received.</p>
        ) : isLoading ? (
          <Skeleton className="w-28" />
        ) : isError ? (
          <p className="field-err">Lookup failed. Check the address.</p>
        ) : !data || data.length === 0 ? (
          <p className="faint">No airdrops recorded for {truncateMiddle(query, 6, 6)}.</p>
        ) : (
          <>
            <p className="m">
              {data.length} rounds · {num(total, 4)} units
            </p>
            <table className="t">
              <tbody>
                {data.map((r) => (
                  <tr key={r.roundId}>
                    <td className="m muted">#{r.roundId}</td>
                    <td className="m muted">{dateTime(r.ts)}</td>
                    <td className="r m">+{num(r.units, 4)}</td>
                    <td className="r">
                      <Address value={r.sig} kind="tx" head={4} tail={4} copy={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

function EventFeed() {
  const { data, isLoading } = useFlywheelEvents(50);
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const now = useNow(10_000);
  const list = useMemo(() => (data ?? []).filter((e) => filter === "all" || e.kind === filter), [data, filter]);
  return (
    <section className="split-main" aria-label="Event feed">
      <div className="panel-h">
        <span className="micro muted">Event feed · live</span>
        <label className="field field-sm">
          <span className="sr-only">Filter by kind</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as EventKind | "all")}>
            <option value="all">All kinds</option>
            {(Object.keys(KIND) as EventKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="feed" role="list">
        {isLoading && !data && <Skeleton className="w-28" />}
        {data && list.length === 0 && <p className="empty-note">No events.</p>}
        <AnimatePresence initial={false}>
          {list.map((e) => (
            <EventRow key={String(e.id)} e={e} now={now ?? Date.now()} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

function EventRow({ e, now }: { e: FlywheelEvent; now: number }) {
  const amounts = fmtAmounts(e.amounts);
  return (
    <motion.div role="listitem" layout="position" className="feedrow" initial={{ backgroundColor: "var(--fill-up)" }} animate={{ backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 0.9 }}>
      <span className="chip chip-outline">{KIND[e.kind]}</span>
      <span className="feed-note" title={e.note ?? ""}>
        {e.note ?? "—"}
        {amounts && <span className="faint m"> · {amounts}</span>}
      </span>
      <span className="m muted feed-t" title={`${dateTime(e.ts)}`}>
        {relTime(e.ts, now)} · {new Date(e.ts).toISOString().slice(11, 19)}
      </span>
      {e.sig ? (
        <a className="lnk m" href={solscanTx(e.sig)} target="_blank" rel="noreferrer noopener">
          {truncateMiddle(e.sig, 5, 5)} ↗
        </a>
      ) : (
        <span className="muted">—</span>
      )}
    </motion.div>
  );
}
