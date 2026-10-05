import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { canTransition, equalWeightAfter, isSuppressed, reconcileProposals, transition, type IndicatedChange } from '../src/governance/proposals.js';
import { effectiveAnchor, moveBps, planRefPriceUpdates, refPriceQ64ToUsd, usdToRefPriceQ64 } from '../src/governance/ref-prices.js';
import { describePayload, payloads } from '../src/governance/actions.js';
import { targetWeightsAfter } from '../src/governance/reconstitution.js';
import { boundAuctionPrices, fairPriceQ64, minEndPriceQ64 } from '../src/rebalancer/auction-pricing.js';
import { decodeProgramDataAddress, decodeUpgradeAuthority } from '../src/chain/accounts.js';
import { ActionKind, type AssetState } from '../src/chain/types.js';
import { DEFAULT_METHODOLOGY_CONFIG } from '../src/config/methodology.config.js';
import type { ProposalRow } from '../src/db/repo.js';
import { openDb } from '../src/db/db.js';
import { Repo } from '../src/db/repo.js';
import { Q64 } from '../src/util/math.js';

const DAY = 86_400_000;

function row(p: Partial<ProposalRow> & Pick<ProposalRow, 'mint' | 'action' | 'status'>): ProposalRow {
  return { id: 1, symbol: null, reason: '{}', weight_bps: null, proposed_ts: '2026-01-01T00:00:00.000Z', decided_ts: null, queued_ts: null, executed_ts: null, action_pda: null, queued_sig: null, note: null, ...p };
}

describe('reconstitution proposal state machine', () => {
  it('allows only the documented transitions', () => {
    expect(transition('proposed', 'approve')).toBe('approved');
    expect(transition('proposed', 'reject')).toBe('rejected');
    expect(transition('approved', 'queue')).toBe('queued');
    expect(transition('approved', 'reject')).toBe('rejected');
    expect(transition('queued', 'execute')).toBe('executed');
    expect(() => transition('proposed', 'queue')).toThrow();
    expect(() => transition('rejected', 'approve')).toThrow();
    expect(() => transition('executed', 'reject')).toThrow();
    expect(canTransition('queued', 'approve')).toBe(false);
  });

  it('rejections suppress re-proposal for the cooldown window', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    expect(isSuppressed('2026-05-01T00:00:00.000Z', now, 90)).toBe(true);
    expect(isSuppressed('2026-02-01T00:00:00.000Z', now, 90)).toBe(false);
    expect(isSuppressed('2026-05-30T00:00:00.000Z', now, 0)).toBe(false);
    expect(isSuppressed(null, now, 90)).toBe(false);
  });

  it('reconcileProposals creates new, skips open and in-cooldown ones', () => {
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    const indicated: IndicatedChange[] = [
      { mint: 'A', symbol: 'A', action: 'add', weightBps: 250, metrics: {} },
      { mint: 'B', symbol: 'B', action: 'remove', weightBps: null, metrics: {} },
      { mint: 'C', symbol: 'C', action: 'add', weightBps: 250, metrics: {} },
      { mint: 'D', symbol: 'D', action: 'add', weightBps: 250, metrics: {} },
    ];
    const existing: ProposalRow[] = [
      row({ mint: 'B', action: 'remove', status: 'proposed' }),
      row({ mint: 'C', action: 'add', status: 'rejected', decided_ts: new Date(now - 10 * DAY).toISOString() }),
      row({ mint: 'D', action: 'add', status: 'rejected', decided_ts: new Date(now - 100 * DAY).toISOString() }),
    ];
    const r = reconcileProposals(indicated, existing, now, 90);
    expect(r.create.map((c) => c.mint)).toEqual(['A', 'D']);
    expect(r.alreadyOpen).toEqual(['B']);
    expect(r.suppressed).toEqual(['C']);
  });

  it('equal weights after adds/removes and target weight recomputation', () => {
    expect(equalWeightAfter(40, 2, 1)).toBe(243);
    const w = targetWeightsAfter(['a', 'b', 'c'], [{ mint: 'd', weightBps: null }], new Set(['c']), DEFAULT_METHODOLOGY_CONFIG, []);
    expect([...w.entries()]).toEqual([
      ['a', 3333],
      ['b', 3333],
      ['d', 3333],
    ]);
    const w2 = targetWeightsAfter(['a'], [{ mint: 'd', weightBps: 777 }], new Set(), DEFAULT_METHODOLOGY_CONFIG, []);
    expect(w2.get('d')).toBe(777);
  });

  it('persists proposals and governance actions through the repo', () => {
    const repo = new Repo(openDb(':memory:'));
    const id = repo.governance.insertProposal({ mint: 'M', symbol: 'MM', action: 'add', reason: { rank: 12, marketCapUsd: 5e6 }, weightBps: 250 });
    expect(repo.governance.openProposal('M')?.id).toBe(id);
    repo.governance.updateProposal(id, { status: 'approved', decided_ts: '2026-01-02T00:00:00.000Z' });
    expect(repo.governance.proposals('approved')).toHaveLength(1);
    repo.governance.updateProposal(id, { status: 'queued', action_pda: 'PDA', queued_sig: 'sig' });
    expect(repo.governance.openProposal('M')?.status).toBe('queued');
    repo.governance.updateProposal(id, { status: 'executed' });
    expect(repo.governance.openProposal('M')).toBeUndefined();
    const rej = repo.governance.insertProposal({ mint: 'N', action: 'remove', reason: {}, status: 'rejected' });
    repo.governance.updateProposal(rej, { decided_ts: '2026-01-03T00:00:00.000Z' });
    expect(repo.governance.latestRejection('N', 'remove')?.id).toBe(rej);
    repo.governance.insertGovernanceAction({ pda: 'P1', nonce: 0n, kind: ActionKind.SetFees, payload: { key: 'k', values: [1n, 2n, 3n, 0n] }, etaSlot: 100n, proposer: 'auth', queuedSig: 's1' });
    expect(repo.governance.governanceActions('queued')).toHaveLength(1);
    repo.governance.setGovernanceActionStatus('P1', 'executed', 's2');
    expect(repo.governance.governanceAction('P1')?.executed_sig).toBe('s2');
    expect(repo.governance.governanceActions('queued')).toHaveLength(0);
  });
});

describe('reference prices', () => {
  const asset = (over: Partial<AssetState>): AssetState => ({
    pda: 'p',
    fund: 'f',
    mint: 'm',
    vault: 'v',
    tokenProgram: 't',
    index: 0,
    status: 'active',
    decimals: 6,
    targetWeightBps: 250,
    pendingDeposits: 0n,
    pendingWithdrawals: 0n,
    vaultAmount: 1n,
    refPrice: 1000n * Q64,
    refPriceUpdatedSlot: 10n,
    refPriceAnchor: 1000n * Q64,
    refPriceAnchorSlot: 10n,
    ...over,
  });

  it('nano-USD numeraire round-trips and mirrors the SDK convention', () => {
    expect(usdToRefPriceQ64(1.25, 6)).toBe(1250n * Q64);
    expect(refPriceQ64ToUsd(1250n * Q64, 6)).toBeCloseTo(1.25, 12);
    expect(Number(usdToRefPriceQ64(0.00002, 5)) / 2 ** 64).toBeCloseTo(0.2, 9);
    expect(moveBps(1000n, 1200n)).toBe(2000n);
    expect(moveBps(1000n, 1001n)).toBe(10n);
    expect(effectiveAnchor({ refPrice: 5n, refPriceAnchor: 3n, refPriceAnchorSlot: 100n }, 10n, 105n)).toBe(3n);
    expect(effectiveAnchor({ refPrice: 5n, refPriceAnchor: 3n, refPriceAnchorSlot: 100n }, 10n, 110n)).toBe(5n);
  });

  it('planRefPriceUpdates clamps to the move cap, skips tiny moves and flags unset prices', () => {
    const o = { maxRefMoveBps: 2000, periodSlots: 216_000n, slot: 100n, minChangeBps: 25, isAuthority: false };
    // assets default to 1000 nUSD/raw = $1.00 per token (6 decimals); target +30% vs anchor 1000 -> clamped to 1200
    const up = planRefPriceUpdates([asset({ mint: 'A' })], new Map([['A', 1.3]]), o);
    expect(up.updates).toHaveLength(1);
    expect(up.updates[0]).toMatchObject({ mint: 'A', clamped: true, targetMoveBps: 3000, bootstrap: false });
    expect(up.updates[0]!.send).toBe(1200n * Q64);
    // target -10% -> sent as is
    const down = planRefPriceUpdates([asset({ mint: 'B' })], new Map([['B', 0.9]]), o);
    expect(down.updates[0]).toMatchObject({ clamped: false });
    expect(down.updates[0]!.send).toBe(900n * Q64);
    // already pinned at the edge: the window is exhausted
    const pinned = planRefPriceUpdates([asset({ mint: 'C', refPrice: 1200n * Q64 })], new Map([['C', 1.5]]), o);
    expect(pinned.updates).toHaveLength(0);
    expect(pinned.unchanged).toEqual(['C']);
    // period rolled -> anchor is the current value -> +20% from 1200 allowed
    const rolled = planRefPriceUpdates([asset({ mint: 'C', refPrice: 1200n * Q64 })], new Map([['C', 1.5]]), { ...o, slot: 216_200n });
    expect(rolled.updates[0]!.send).toBe(1440n * Q64);
    // below min change
    const tiny = planRefPriceUpdates([asset({ mint: 'D' })], new Map([['D', 1.001]]), o);
    expect(tiny.unchanged).toEqual(['D']);
    // unset: only the authority may bootstrap
    const unset = planRefPriceUpdates([asset({ mint: 'E', refPrice: 0n, refPriceAnchor: 0n })], new Map([['E', 2]]), o);
    expect(unset.needsAuthority).toEqual(['E']);
    const boot = planRefPriceUpdates([asset({ mint: 'E', refPrice: 0n, refPriceAnchor: 0n })], new Map([['E', 2]]), { ...o, isAuthority: true });
    expect(boot.updates[0]).toMatchObject({ bootstrap: true, send: 2000n * Q64 });
    expect(planRefPriceUpdates([asset({ mint: 'F' })], new Map(), o).unpriced).toEqual(['F']);
  });

  it('auction curve is lifted to the on-chain bound', () => {
    const fair = fairPriceQ64(2n * Q64, 4n * Q64);
    expect(fair).toBe(Q64 / 2n);
    expect(minEndPriceQ64(fair, 500)).toBe((Q64 * 475n) / 1000n);
    const px = { midRaw: 0.5, startPrice: (Q64 * 515n) / 1000n, endPrice: (Q64 * 40n) / 100n };
    const b = boundAuctionPrices(px, 2n * Q64, 4n * Q64, 500, 300);
    expect(b.bounded).toBe(true);
    expect(b.endPrice).toBe((Q64 * 475n) / 1000n);
    expect(b.startPrice).toBe(px.startPrice);
    const ok = boundAuctionPrices({ ...px, endPrice: (Q64 * 48n) / 100n }, 2n * Q64, 4n * Q64, 500, 300);
    expect(ok.bounded).toBe(false);
    // start below the floor -> premium re-applied above the new end
    const low = boundAuctionPrices({ midRaw: 0.4, startPrice: (Q64 * 41n) / 100n, endPrice: (Q64 * 38n) / 100n }, 2n * Q64, 4n * Q64, 500, 300);
    expect(low.startPrice).toBe((low.endPrice * 10_300n) / 10_000n);
    expect(() => boundAuctionPrices(px, 0n, 4n * Q64, 500, 300)).toThrow(/ref price unset/);
  });
});

describe('timelock payloads and upgrade authority decoding', () => {
  it('payload builders encode kinds, keys and u128 ref prices', () => {
    const m = PublicKey.unique().toBase58();
    expect(payloads.setFees(1, 2, 3)).toMatchObject({ kind: ActionKind.SetFees, values: [1n, 2n, 3n, 0n] });
    const big = (123n << 64n) | 456n;
    const rp = payloads.refPriceOverride(m, big);
    expect(rp.values[0]).toBe(456n);
    expect(rp.values[1]).toBe(123n);
    expect(describePayload(rp.kind, rp.key, rp.values)).toEqual({ mint: m, refPrice: big.toString() });
    expect(describePayload(ActionKind.AddAsset, m, [250n, 0n, 0n, 0n])).toEqual({ mint: m, targetWeightBps: 250 });
    expect(describePayload(ActionKind.SetTimelock, m, [432_000n, 0n, 0n, 0n])).toEqual({ timelockSlots: '432000' });
  });

  it('decodes BPF upgradeable loader Program / ProgramData accounts', () => {
    const pd = PublicKey.unique();
    const program = Buffer.concat([Buffer.from([2, 0, 0, 0]), pd.toBuffer()]);
    expect(decodeProgramDataAddress(program)).toBe(pd.toBase58());
    const auth = PublicKey.unique();
    const withAuth = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.alloc(8), Buffer.from([1]), auth.toBuffer()]);
    expect(decodeUpgradeAuthority(withAuth)).toBe(auth.toBase58());
    const burned = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.alloc(8), Buffer.from([0])]);
    expect(decodeUpgradeAuthority(burned)).toBeNull();
    const defaultKey = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.alloc(8), Buffer.from([1]), PublicKey.default.toBuffer()]);
    expect(decodeUpgradeAuthority(defaultKey)).toBeNull(); // test-validator --bpf-program
    expect(decodeProgramDataAddress(Buffer.from([1, 0, 0, 0]))).toBeNull();
  });
});
