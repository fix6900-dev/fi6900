"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { useFund, useHoldings } from "@/lib/api";
import { useAsOf, utcClock } from "@/lib/asof";
import { env } from "@/lib/env";
import { bpsToPct, fromRaw, usd } from "@/lib/format";
import { Address } from "../ui/Address";
import { Fn, Notes, type Note } from "../ui/Fn";
import { SectionHead } from "../ui/SectionHead";
import { TokenLogo } from "../ui/TokenLogo";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const money = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const units = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 2 : 6 });

type Position = { units: number; raw: bigint; account: string | null };

/** The connected wallet's $FI6900 token accounts for the index mint (both token programs), summed. Polls every 15 s. */
function usePosition(owner: PublicKey | null) {
  const { connection } = useConnection();
  const mint = env.indexMint;
  return useQuery<Position>({
    queryKey: ["position", owner?.toBase58() ?? null, mint],
    enabled: !!owner && !!mint,
    refetchInterval: 15_000,
    staleTime: 10_000,
    queryFn: async () => {
      const m = new PublicKey(mint);
      const [a, b] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner!, { mint: m, programId: TOKEN_PROGRAM }).catch(() => ({ value: [] })),
        connection.getParsedTokenAccountsByOwner(owner!, { mint: m, programId: TOKEN_2022 }).catch(() => ({ value: [] })),
      ]);
      let raw = 0n;
      let u = 0;
      let account: string | null = null;
      for (const acc of [...a.value, ...b.value]) {
        const info = (acc.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string; uiAmount?: number } } } }).parsed?.info;
        raw += BigInt(info?.tokenAmount?.amount ?? "0");
        u += info?.tokenAmount?.uiAmount ?? 0;
        account ??= acc.pubkey.toBase58();
      }
      return { units: u, raw, account };
    },
  });
}

/**
 * Your position: $FI6900 balance, its NAV value, share of supply, and the pro-rata slice of every vault
 * you would receive on redemption, net of the redeem fee. Reads the wallet's token account over RPC; every
 * fund figure comes from the keeper snapshot and is footnoted like the rest of the factsheet.
 */
export function Portfolio({ n = 1, standalone = false }: { n?: number; standalone?: boolean }) {
  const { publicKey, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const { data: fund } = useFund();
  const { data: holdings } = useHoldings();
  const pos = usePosition(publicKey);
  const asOf = useAsOf();
  const clock = asOf ? `${utcClock(asOf)} UTC` : undefined;

  const supply = fund ? Number(fund.supply) / 1e6 : null;
  const bal = pos.data?.units ?? null;
  const share = bal != null && supply ? bal / supply : null;
  const value = bal != null && fund ? bal * fund.navPerUnitUsd : null;
  const feeBps = fund ? Number(fund.fees.redeemBps) : null;

  const rows = useMemo(() => {
    if (!holdings || share == null) return [];
    return holdings.map((h) => {
      const vault = fromRaw(h.balance, Number(h.decimals));
      const mine = vault * share;
      return { ...h, mine, mineUsd: mine * h.priceUsd };
    });
  }, [holdings, share]);
  const gross = rows.reduce((a, r) => a + r.mineUsd, 0);
  const fee = feeBps != null ? gross * (feeBps / 10_000) : 0;
  const net = gross - fee;

  const notes: Note[] = [
    { label: "Your $FI6900 balance. Read from your token account for the index mint over RPC", address: pos.data?.account ?? undefined, kind: "account", source: "wallet token account" },
    { label: "Value = balance × NAV per unit; share = balance ÷ index supply. Read from the fund account", address: fund?.fundPda },
    { label: "Your share of each vault = vault balance × share. Redemption delivers these amounts in-kind, less the redeem fee", address: fund?.fundPda },
  ];

  const head = standalone ? null : <SectionHead n={n} title={<span id="pf-h">Your position</span>} right={publicKey ? <Link href="/portfolio" className="lnk">Portfolio page →</Link> : undefined} />;

  if (!publicKey) {
    return (
      <section className="sec pf" aria-labelledby="pf-h">
        {head}
        <p className="pf-prompt">
          <button type="button" className="lnk pf-connect" onClick={() => setVisible(true)}>
            Connect a wallet
          </button>{" "}
          to see your share of the vault.
        </p>
      </section>
    );
  }

  return (
    <section className="sec pf" aria-labelledby="pf-h">
      {head}
      <p className="sec-lede">
        {wallet?.adapter.name ?? "Wallet"} <Address value={publicKey.toBase58()} head={4} tail={4} copy={false} />. Figures are your pro-rata claim on the vault at the latest keeper snapshot.
      </p>

      <dl className="kf-strip pf-strip">
        <div className="kf">
          <dt className="micro muted">Balance</dt>
          <dd>
            <span className="kf-v">{pos.isLoading ? <span className="faint">reading</span> : bal != null ? units(bal) : "—"}</span>
            {pos.data && <Fn n={1} note={notes[0]} />}
          </dd>
          <dd className="faint">$FI6900 units</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">Value at NAV</dt>
          <dd>
            <span className="kf-v">{value != null ? money(value) : "—"}</span>
            {fund && bal != null && <Fn n={2} note={notes[1]} />}
          </dd>
          <dd className="faint">{fund ? `× ${money(fund.navPerUnitUsd, 4)} per unit` : "loading"}</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">Share of fund</dt>
          <dd>
            <span className="kf-v">{share != null ? (share * 100).toFixed(share * 100 < 0.01 ? 5 : 3) + "%" : "—"}</span>
          </dd>
          <dd className="faint">{supply != null ? `of ${units(supply)} units` : "of index supply"}</dd>
        </div>
        <div className="kf">
          <dt className="micro muted">Redeem now, net</dt>
          <dd>
            <span className="kf-v">{rows.length ? money(net) : "—"}</span>
            {rows.length > 0 && <Fn n={3} note={notes[2]} />}
          </dd>
          <dd className="faint">{feeBps != null ? `after ${bpsToPct(feeBps, 2)} redeem fee (${money(fee)})` : "after redeem fee"}</dd>
        </div>
      </dl>

      <div className="pf-actions">
        {bal != null && bal > 0 ? (
          <Link href={`/create?mode=redeem&units=${encodeURIComponent(String(bal))}`} className="btn btn-primary btn-md">
            Redeem {units(bal)} units
          </Link>
        ) : (
          <Link href="/create" className="btn btn-secondary btn-md">
            Create units in-kind
          </Link>
        )}
        {bal != null && bal > 0 && (
          <Link href="/create" className="lnk">
            or create more →
          </Link>
        )}
      </div>

      <div className="tw pf-tw">
        <table className="t" aria-label="Your share of each constituent">
          <thead>
            <tr>
              <th>Constituent</th>
              <th className="r">Vault balance</th>
              <th className="r">Your share</th>
              <th className="r">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="empty" colSpan={4}>
                  {bal === 0 ? "This wallet holds no $FI6900 units yet." : "Reading your position"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.mint}>
                <td>
                  <span className="pf-tok">
                    <TokenLogo symbol={r.symbol} mint={r.mint} src={r.logo} />
                    <span className="tok-s">{r.symbol}</span>
                  </span>
                </td>
                <td className="r m muted">{qty(fromRaw(r.balance, Number(r.decimals)))}</td>
                <td className="r m">
                  {qty(r.mine)} {r.symbol}
                </td>
                <td className="r m">{usd(r.mineUsd, { precise: true })}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} className="r muted">
                  Gross
                </td>
                <td className="r m">{money(gross)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="r muted">
                  Redeem fee {feeBps != null ? bpsToPct(feeBps, 2) : ""}
                </td>
                <td className="r m">−{money(fee)}</td>
              </tr>
              <tr className="pf-net">
                <td colSpan={3} className="r">
                  You would receive
                </td>
                <td className="r m">{money(net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Notes notes={notes} asOf={clock} />
    </section>
  );
}
