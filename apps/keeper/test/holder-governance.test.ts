import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { openDb } from '../src/db/db.js';
import { Repo } from '../src/db/repo.js';
import { HolderGovernance, thresholdUnits, type HolderGovDeps } from '../src/governance/holder-gov.js';
import { canonicalJson, describeGovPayload, proposeMessage, quorumUnits, signMessage, tallyOutcome, validateParamPayload, verifySignature, voteMessage } from '../src/governance/voting.js';
import { buildHolderExclusions } from '../src/flywheel/exclusions.js';
import { airdropShareBps, feeBurnPct, withConfigOverrides } from '../src/config/overrides.js';
import { DEFAULT_METHODOLOGY_CONFIG } from '../src/config/methodology.config.js';
import { EventBus } from '../src/util/events.js';
import { createApp } from '../src/api/server.js';
import { MockProvider } from '../src/mock/provider.js';

const HOUR = 3_600_000;
const U = 1_000_000n; // 1 unit, 6 dp

function env(over: Partial<HolderGovDeps['env']> = {}): HolderGovDeps['env'] {
  return {
    GOV_ENABLED: true,
    GOV_VOTING_HOURS: 48,
    GOV_QUORUM_BPS: 500,
    GOV_PROPOSAL_THRESHOLD_BPS: 50,
    GOV_MAX_OPEN_PER_WALLET: 1,
    GOV_ALLOWED_PARAMS: 'eligibility.minVolume24hUsd,rebalance.driftRelativeBps,FEE_BURN_PCT,flywheel.airdropShareBps',
    GOV_DEV_ACCEPT_ANY_BALANCE: false,
    DRY_RUN: true,
    COIN_MINT: 'coin',
    ...over,
  };
}

/** A governance instance over an in-memory db with a fixed holder set and a controllable clock. */
function setup(holders: { kp: Keypair; amount: bigint }[], over: Partial<HolderGovDeps['env']> = {}, extra: Partial<HolderGovDeps> = {}) {
  const repo = extra.repo ?? new Repo(openDb(':memory:'));
  const clock = { now: Date.parse('2026-10-06T00:00:00.000Z') };
  const gov = new HolderGovernance({
    repo,
    env: env(over),
    now: () => new Date(clock.now),
    getSlot: async () => 1_000n,
    getHolders: async () => holders.map((h) => ({ owner: h.kp.publicKey.toBase58(), amount: h.amount })),
    exclusions: async () => new Set(),
    ...extra,
  });
  type H = { kp: Keypair } | Keypair;
  const keyOf = (h: H): Keypair => (h instanceof Keypair ? h : h.kp);
  const propose = (h: H, kind: 'add_asset' | 'remove_asset' | 'set_param', payload: Record<string, unknown>, title = 'A fine proposal', description = 'Because.') => {
    const kp = keyOf(h);
    const draft = { kind, payload, title, description, proposer: kp.publicKey.toBase58() };
    const message = proposeMessage(draft);
    return gov.propose({ ...draft, message, signature: signMessage(kp.secretKey, message) });
  };
  const vote = (id: number, h: H, choice: 'for' | 'against' | 'abstain', tamper?: { message?: string; signer?: Keypair }) => {
    const kp = keyOf(h);
    const slot = repo.gov.get(id)!.snapshot_slot;
    const message = tamper?.message ?? voteMessage(choice, id, slot);
    return gov.vote(id, { wallet: kp.publicKey.toBase58(), choice, message, signature: signMessage((tamper?.signer ?? kp).secretKey, message) });
  };
  return { repo, gov, clock, propose, vote };
}

const mk = (amountUnits: number) => ({ kp: Keypair.generate(), amount: BigInt(amountUnits) * U });

describe('canonical messages and signatures', () => {
  it('canonical JSON sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x', null], c: true }, z: undefined })).toBe('{"a":{"c":true,"d":[1,"x",null]},"b":1}');
    expect(canonicalJson({ big: 10n })).toBe('{"big":"10"}');
  });

  it('propose and vote messages have the documented shape', () => {
    const m = proposeMessage({ kind: 'set_param', payload: { key: 'FEE_BURN_PCT', value: 80 }, title: 't', description: 'd', proposer: 'p' });
    expect(m).toMatch(/^FIX6900 governance: propose [0-9a-f]{64}$/);
    expect(voteMessage('for', 7, 123n)).toBe('FIX6900 governance: vote for on proposal 7 (snapshot slot 123)');
  });

  it('verifies ed25519 signatures from a generated keypair and rejects tampering', () => {
    const kp = Keypair.generate();
    const msg = voteMessage('against', 1, 5);
    const sig = signMessage(kp.secretKey, msg);
    expect(verifySignature(kp.publicKey.toBase58(), msg, sig)).toBe(true);
    expect(verifySignature(kp.publicKey.toBase58(), msg + ' ', sig)).toBe(false);
    expect(verifySignature(Keypair.generate().publicKey.toBase58(), msg, sig)).toBe(false);
    expect(verifySignature(kp.publicKey.toBase58(), msg, 'nope')).toBe(false);
    expect(verifySignature('not-a-key', msg, sig)).toBe(false);
  });
});

describe('tally rules', () => {
  const supply = 1_000_000n * U;
  it('quorum is ceil(supply * bps / 1e4)', () => {
    expect(quorumUnits(supply, 500)).toBe(50_000n * U);
    expect(quorumUnits(1n, 500)).toBe(1n);
    expect(quorumUnits(supply, 0)).toBe(0n);
  });
  it('passes only with quorum AND for > against; abstain counts toward quorum', () => {
    const t = (f: number, a: number, ab: number) => tallyOutcome({ for: BigInt(f) * U, against: BigInt(a) * U, abstain: BigInt(ab) * U, voters: 3 }, supply, 500);
    expect(t(40_000, 9_999, 1).passed).toBe(true); // exactly quorum (50_000) and majority
    expect(t(40_000, 9_998, 1).quorumReached).toBe(false); // one unit short
    expect(t(25_000, 25_000, 10_000).passed).toBe(false); // tie is not a majority
    expect(t(25_000, 25_000, 10_000).quorumReached).toBe(true);
    expect(t(10, 0, 60_000).passed).toBe(true); // abstain lifts quorum, for > against still decides
    expect(t(0, 0, 60_000).passed).toBe(false);
    expect(t(0, 0, 0).quorumReached).toBe(false);
  });
  it('zero-supply snapshot never reaches quorum unless quorum is 0', () => {
    expect(tallyOutcome({ for: 0n, against: 0n, abstain: 0n, voters: 0 }, 0n, 500).quorumReached).toBe(false);
    expect(tallyOutcome({ for: 1n, against: 0n, abstain: 0n, voters: 1 }, 0n, 0).passed).toBe(true);
  });
});

describe('param whitelist and bounds', () => {
  const allow = 'eligibility.minVolume24hUsd,rebalance.driftRelativeBps,FEE_BURN_PCT,flywheel.airdropShareBps';
  it('accepts in-range values and rejects out-of-range, non-integer, unknown and non-whitelisted keys', () => {
    expect(validateParamPayload({ key: 'FEE_BURN_PCT', value: 100 }, allow)).toEqual({ key: 'FEE_BURN_PCT', value: 100 });
    expect(validateParamPayload({ key: 'eligibility.minVolume24hUsd', value: '50000' }, allow).value).toBe(50_000);
    expect(() => validateParamPayload({ key: 'FEE_BURN_PCT', value: 101 }, allow)).toThrow(/outside/);
    expect(() => validateParamPayload({ key: 'eligibility.minVolume24hUsd', value: 49_999 }, allow)).toThrow(/outside/);
    expect(() => validateParamPayload({ key: 'rebalance.driftRelativeBps', value: 1500.5 }, allow)).toThrow(/integer/);
    expect(() => validateParamPayload({ key: 'selection.targetCount', value: 10 }, allow)).toThrow(/not votable/);
    expect(() => validateParamPayload({ key: 'FEE_BURN_PCT', value: 50 }, 'eligibility.minVolume24hUsd')).toThrow(/not votable/);
    expect(() => validateParamPayload({ key: 'FEE_BURN_PCT', value: 'abc' }, allow)).toThrow(/number/);
  });
  it('describes payloads for the feed', () => {
    expect(describeGovPayload('add_asset', { mint: 'CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', symbol: 'GOAT', weightBps: 714 })).toBe('Add GOAT · CzLS…pump · 714 bps');
    expect(describeGovPayload('set_param', { key: 'FEE_BURN_PCT', value: 90 })).toBe('Set FEE_BURN_PCT = 90');
  });
});

describe('HolderGovernance service', () => {
  it('proposal threshold, snapshot supply and signature checks on propose', async () => {
    const whale = mk(10_000); // 1% of 1M
    const small = mk(100); // 0.01%
    const { gov, propose, repo } = setup([whale, small, mk(989_900)]);
    await expect(propose(small, 'set_param', { key: 'FEE_BURN_PCT', value: 80 })).rejects.toThrow(/required/);
    const p = await propose(whale, 'set_param', { key: 'FEE_BURN_PCT', value: 80 });
    expect(p.status).toBe('open');
    expect(p.snapshotSupply).toBe((1_000_000n * U).toString());
    expect(p.snapshotHolders).toBe(3);
    expect(p.snapshotSlot).toBe('1000');
    expect(p.myWeight).toBe((10_000n * U).toString());
    expect(repo.flywheelEvents(5, undefined, 'governance')).toHaveLength(1);
    // one open proposal per wallet
    await expect(propose(whale, 'set_param', { key: 'FEE_BURN_PCT', value: 70 })).rejects.toThrow(/open proposal/);
    // bad signature / message
    const draft = { kind: 'set_param' as const, payload: { key: 'FEE_BURN_PCT', value: 60 }, title: 'x title', description: '', proposer: whale.kp.publicKey.toBase58() };
    await expect(gov.propose({ ...draft, message: 'FIX6900 governance: propose deadbeef', signature: 'x' })).rejects.toThrow(/message mismatch/);
    await expect(gov.propose({ ...draft, message: proposeMessage(draft), signature: signMessage(small.kp.secretKey, proposeMessage(draft)) })).rejects.toThrow(/invalid signature/);
    // admin bypasses threshold and signature
    const a = await gov.propose({ kind: 'remove_asset', payload: { mint: whale.kp.publicKey.toBase58() }, title: 'admin remove', proposer: '' }, { admin: true });
    expect(a.proposer).toBe('admin');
    expect(thresholdUnits(1_000_000n * U, 50)).toBe(5_000n * U);
  });

  it('votes carry snapshot weight, re-vote replaces, zero-balance and closed proposals are rejected', async () => {
    const a = mk(60_000);
    const b = mk(30_000);
    const nobody = { kp: Keypair.generate(), amount: 0n };
    const { gov, propose, vote, clock, repo } = setup([a, b, mk(910_000)]);
    const p = await propose(a, 'set_param', { key: 'rebalance.driftRelativeBps', value: 3000 });
    let d = vote(p.id, a, 'for');
    expect(d.tally.for).toBe((60_000n * U).toString());
    expect(d.myVote?.choice).toBe('for');
    d = vote(p.id, a, 'against'); // re-vote replaces, does not add
    expect(d.tally.for).toBe('0');
    expect(d.tally.against).toBe((60_000n * U).toString());
    expect(d.tally.voters).toBe(1);
    expect(() => vote(p.id, nobody.kp, 'for')).toThrow(/held no/);
    expect(() => vote(p.id, b, 'for', { signer: a.kp })).toThrow(/invalid signature/);
    expect(() => vote(p.id, b, 'for', { message: voteMessage('for', p.id, 999) })).toThrow(/message mismatch/);
    expect(() => gov.vote(p.id, { wallet: b.kp.publicKey.toBase58(), choice: 'maybe', message: '', signature: '' })).toThrow(/choice/);
    // balance acquired after the snapshot does not count: a new holder is still 0 at the snapshot
    expect(repo.gov.snapshotBalance(p.id, nobody.kp.publicKey.toBase58())).toBe(0n);
    // past end_ts: rejected even before the job closes it
    clock.now += 49 * HOUR;
    expect(() => vote(p.id, b, 'for')).toThrow(/ended/);
    const r = gov.closeDue();
    expect(r.failed).toEqual([p.id]); // 6% participation >= 5% quorum but against > for
    expect(gov.get(p.id).status).toBe('failed');
    expect(() => vote(p.id, b, 'for')).toThrow(/closed/);
  });

  it('quorum edge: exactly the quorum passes, one unit short fails', async () => {
    const a = mk(50_000);
    const { propose, vote, clock, gov, repo } = setup([a, mk(950_000)]);
    const p = await propose(a, 'set_param', { key: 'FEE_BURN_PCT', value: 90 });
    vote(p.id, a, 'for');
    clock.now += 49 * HOUR;
    expect(gov.closeDue().passed).toEqual([p.id]);
    expect(repo.gov.countByStatus().passed).toBe(1);
    // second instance: one extra unit of supply puts the same vote one unit short of quorum
    const b = mk(50_000);
    const s2 = setup([b, { kp: Keypair.generate(), amount: 950_000n * U + 1n }]);
    const p2 = await s2.propose(b, 'set_param', { key: 'FEE_BURN_PCT', value: 90 });
    s2.vote(p2.id, b, 'for');
    s2.clock.now += 49 * HOUR;
    expect(s2.gov.closeDue().failed).toEqual([p2.id]);
    expect(s2.gov.get(p2.id).result?.reason).toBe('quorum not reached');
  });

  it('passed set_param writes a kv override consumed by the config layer; add/remove bind through reconstitution', async () => {
    const a = mk(200_000);
    const calls: string[] = [];
    const repo = new Repo(openDb(':memory:'));
    const recon: NonNullable<HolderGovDeps['reconstitution']> = {
      list: () => [],
      addAsset: async (mint, o) => {
        calls.push(`add ${mint} ${o.weightBps} force=${o.force}`);
        const id = repo.governance.insertProposal({ mint, action: 'add', reason: { source: 'governance' }, status: 'approved', weightBps: o.weightBps ?? null });
        repo.governance.updateProposal(id, { status: 'queued', action_pda: 'PDA1', queued_sig: 'SIG1', queued_ts: '2026-10-07T00:00:00.000Z' });
        return { proposal: repo.governance.getProposal(id)!, queued: { queued: [{ mint, action: 'add', pda: 'PDA1', sig: 'SIG1' }], weightActions: [], skipped: [] } };
      },
      removeAsset: async (mint) => {
        calls.push(`remove ${mint}`);
        const id = repo.governance.insertProposal({ mint, action: 'remove', reason: { source: 'governance' }, status: 'approved' });
        return { proposal: repo.governance.getProposal(id)!, queued: { queued: [], weightActions: [], skipped: [mint] } };
      },
    };
    const held = Keypair.generate().publicKey.toBase58();
    const { gov, propose, vote, clock } = setup([a, mk(800_000)], {}, { repo, reconstitution: recon, readAssets: async () => [{ mint: held, status: 'active' }] });
    const newMint = Keypair.generate().publicKey.toBase58();
    const p1 = await propose(a, 'set_param', { key: 'FEE_BURN_PCT', value: 90 });
    vote(p1.id, a, 'for');
    clock.now += 49 * HOUR;
    await gov.tick();
    expect(gov.get(p1.id).status).toBe('executed');
    expect(repo.getKv('cfg.FEE_BURN_PCT')).toBe('90');
    expect(feeBurnPct({ FEE_BURN_PCT: 75 }, repo)).toBe(90);
    expect(airdropShareBps(repo)).toBe(5000);
    repo.setKv('cfg.rebalance.driftRelativeBps', '2500');
    repo.setKv('cfg.eligibility.minVolume24hUsd', '100000');
    const cfg = withConfigOverrides(DEFAULT_METHODOLOGY_CONFIG, repo);
    expect(cfg.rebalance.driftRelativeBps).toBe(2500);
    expect(cfg.eligibility.minVolume24hUsd).toBe(100_000);
    expect(gov.summary().overrides).toEqual({ 'eligibility.minVolume24hUsd': 100_000, 'rebalance.driftRelativeBps': 2500, FEE_BURN_PCT: 90 });

    // add_asset -> queued (recon queued immediately); remove_asset of a non-constituent rejected at propose
    await expect(propose(a, 'add_asset', { mint: held, weightBps: 250 })).rejects.toThrow(/already a constituent/);
    await expect(propose(a, 'remove_asset', { mint: newMint })).rejects.toThrow(/not a constituent/);
    const p2 = await propose(a, 'add_asset', { mint: newMint, weightBps: 300, allowTransferFee: true });
    vote(p2.id, a, 'for');
    clock.now += 49 * HOUR;
    await gov.tick();
    const d2 = gov.get(p2.id);
    expect(d2.status).toBe('queued');
    expect(d2.queuedActionPda).toBe('PDA1');
    expect(d2.queuedSig).toBe('SIG1');
    expect(calls).toEqual([`add ${newMint} 300 force=true`]);
    // once the reconstitution proposal is executed on-chain (reconcileExecuted), the governance proposal follows
    repo.governance.updateProposal(d2.result!.reconProposalId as number, { status: 'executed', executed_ts: '2026-10-09T00:00:00.000Z' });
    await gov.tick();
    expect(gov.get(p2.id).status).toBe('executed');
    // remove -> approved but not queued (auctions open) stays 'passed' until the window queues it
    const p3 = await propose(a, 'remove_asset', { mint: held });
    vote(p3.id, a, 'for');
    clock.now += 49 * HOUR;
    await gov.tick();
    expect(gov.get(p3.id).status).toBe('passed');
    expect(calls[1]).toBe(`remove ${held}`);
    const kinds = repo.flywheelEvents(50, undefined, 'governance').map((e) => e.amounts.action);
    expect(kinds).toEqual(expect.arrayContaining(['proposed', 'passed', 'executed', 'approved', 'queued']));
  });

  it('cancel only from open or passed; GOV_DEV_ACCEPT_ANY_BALANCE lets an empty wallet vote with 1 unit', async () => {
    const a = mk(100_000);
    const { gov, propose, vote, clock } = setup([a, mk(900_000)], { GOV_DEV_ACCEPT_ANY_BALANCE: true });
    const p = await propose(a, 'set_param', { key: 'flywheel.airdropShareBps', value: 6000 });
    const burner = Keypair.generate();
    const d = vote(p.id, burner, 'abstain');
    expect(d.tally.abstain).toBe(U.toString());
    expect(gov.cancel(p.id, 'duplicate').status).toBe('cancelled');
    expect(() => gov.cancel(p.id)).toThrow(/only open or passed/);
    clock.now += 49 * HOUR;
    expect(gov.closeDue().closed).toBe(0);
  });
});

describe('holder exclusions (snapshot)', () => {
  it('drops PDAs, program-owned owners, denylist, own wallets and the incinerator', async () => {
    const wallet = Keypair.generate().publicKey;
    const multisigOwned = Keypair.generate().publicKey;
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('pool')], new PublicKey('Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV'));
    const denied = Keypair.generate().publicKey.toBase58();
    const own = Keypair.generate().publicKey.toBase58();
    const connection = {
      getMultipleAccountsInfo: async (keys: PublicKey[]) =>
        keys.map((k) =>
          k.equals(multisigOwned)
            ? { executable: false, owner: new PublicKey('SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu'), lamports: 1, data: Buffer.alloc(0) }
            : k.equals(wallet)
              ? { executable: false, owner: new PublicKey('11111111111111111111111111111111'), lamports: 1, data: Buffer.alloc(0) }
              : null,
        ),
    };
    const ex = await buildHolderExclusions({ connection: connection as never, env: { AIRDROP_DENYLIST: denied, TREASURY_WALLET: undefined }, own: [own] }, [wallet.toBase58(), multisigOwned.toBase58(), pda.toBase58(), denied, own, 'garbage']);
    expect(ex.has(wallet.toBase58())).toBe(false);
    for (const x of [multisigOwned.toBase58(), pda.toBase58(), denied, own, 'garbage', '1nc1nerator11111111111111111111111111111111']) expect(ex.has(x), x).toBe(true);
  });
});

describe('governance HTTP routes (mock provider)', () => {
  const events = new EventBus();
  const provider = new MockProvider(events, 42);
  const app = createApp({ provider, events, corsOrigin: '*', adminToken: 'test-admin' });
  const ready = new Promise((r) => setTimeout(r, 1500));
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('lists proposals open first, serves detail with tallies and my vote, enforces admin on cancel', async () => {
    await ready;
    const list = await (await app.request('/v1/governance/proposals')).json();
    expect(list.ok).toBe(true);
    expect(list.data.map((p: { status: string }) => p.status)).toEqual(['open', 'open', 'executed', 'failed']);
    const open = list.data[0];
    const det = await (await app.request(`/v1/governance/proposals/${open.id}?wallet=${open.proposer}`)).json();
    expect(det.data.tally).toMatchObject({ quorumUnits: expect.any(String), forBps: expect.any(Number) });
    expect(det.data.votes.length).toBeGreaterThan(0);
    expect(det.data).toHaveProperty('myVote');
    const summary = await (await app.request('/v1/governance')).json();
    expect(summary.data.governance.counts.open).toBe(2);
    expect(summary.data.governance.params.quorumBps).toBe(500);
    expect((await app.request('/v1/governance/proposals/999')).status).toBe(404);
    expect((await app.request('/v1/governance/proposals/abc')).status).toBe(400);
    expect((await post(`/v1/admin/governance/proposals/${open.id}/cancel`, {})).status).toBe(401);
  });

  it('accepts a signed vote from a fresh keypair (dev flag), rejects a bad signature, creates a signed proposal, and rate-limits', async () => {
    await ready;
    const list = await (await app.request('/v1/governance/proposals?status=open')).json();
    const p = list.data[0];
    const kp = Keypair.generate();
    const message = voteMessage('for', p.id, p.snapshotSlot);
    const body = { wallet: kp.publicKey.toBase58(), choice: 'for', message, signature: signMessage(kp.secretKey, message) };
    const res = await post(`/v1/governance/proposals/${p.id}/vote`, body);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.myVote.choice).toBe('for');
    expect(j.data.myWeight).toBe('1000000');
    const bad = await post(`/v1/governance/proposals/${p.id}/vote`, { ...body, choice: 'against' });
    expect(bad.status).toBe(400); // message/signature were for 'for'
    const draft = { kind: 'set_param', payload: { key: 'FEE_BURN_PCT', value: 85 }, title: 'Burn 85%', description: '', proposer: kp.publicKey.toBase58() };
    const pm = proposeMessage(draft as never);
    const created = await post('/v1/governance/proposals', { ...draft, message: pm, signature: signMessage(kp.secretKey, pm) });
    expect(created.status).toBe(201);
    const adminCreated = await post('/v1/governance/proposals', { kind: 'set_param', payload: { key: 'FEE_BURN_PCT', value: 60 }, title: 'Committee proposal', description: '' }, { authorization: 'Bearer test-admin' });
    expect(adminCreated.status).toBe(201);
    expect((await adminCreated.json()).data.proposer).toBe('admin');
    for (let i = 0; i < 20; i++) await post(`/v1/governance/proposals/${p.id}/vote`, body);
    const limited = await post(`/v1/governance/proposals/${p.id}/vote`, body);
    expect(limited.status).toBe(429);
  });
});
