/**
 * MOCK_MODE holder governance: the real HolderGovernance service on an in-memory SQLite db, seeded with a few
 * proposals and signed votes from deterministic keypairs. Signature verification is real, so a wallet
 * (e.g. the web "Devnet test wallet") can sign and submit a vote against this keeper. GOV_DEV_ACCEPT_ANY_BALANCE
 * is on so a wallet absent from the fake holder set still votes with 1 unit.
 */
import { Keypair } from '@solana/web3.js';
import { openDb } from '../db/db.js';
import { Repo } from '../db/repo.js';
import { HolderGovernance } from '../governance/holder-gov.js';
import { proposeMessage, signMessage, voteMessage } from '../governance/voting.js';
import type { EventBus } from '../util/events.js';
import { seededRandom } from '../util/math.js';
import type { MockState } from './generator.js';

const HOUR = 3_600_000;

function keypairFrom(rnd: () => number): Keypair {
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = Math.floor(rnd() * 256);
  return Keypair.fromSeed(seed);
}

export function createMockGovernance(state: MockState, events: EventBus, seed = 6900): HolderGovernance {
  const rnd = seededRandom(seed + 77);
  const repo = new Repo(openDb(':memory:'));
  // 60 fake holders; total 1B coin supply (6 dp), top-heavy like a real memecoin.
  const holders = Array.from({ length: 60 }, (_, i) => ({ kp: keypairFrom(rnd), amount: BigInt(Math.floor((1_000_000_000 / (i + 2)) * 0.12 * 1e6)) }));
  const env = {
    GOV_ENABLED: true,
    GOV_VOTING_HOURS: 48,
    GOV_QUORUM_BPS: 500,
    GOV_PROPOSAL_THRESHOLD_BPS: 50,
    GOV_MAX_OPEN_PER_WALLET: 1,
    GOV_ALLOWED_PARAMS: 'eligibility.minVolume24hUsd,rebalance.driftRelativeBps,FEE_BURN_PCT,flywheel.airdropShareBps',
    GOV_DEV_ACCEPT_ANY_BALANCE: true,
    DRY_RUN: true,
    COIN_MINT: state.coinMint,
  };
  let now = Date.now() - 30 * HOUR; // seed history in the past (now > 0), then follow the wall clock (now = 0)
  const gov = new HolderGovernance({
    repo,
    env,
    events,
    now: () => (now > 0 ? new Date(now) : new Date()),
    getSlot: async () => state.currentSlot,
    getHolders: async () => holders.map((h) => ({ owner: h.kp.publicKey.toBase58(), amount: h.amount })),
    exclusions: async () => new Set<string>(),
    readAssets: async () => state.tokens.map((t) => ({ mint: t.mint, status: t.status })),
  });

  // Governance events land in the mock feed so /v1/flywheel/events shows them like the live keeper does.
  events.subscribe((ev) => {
    const d = ev.data as { id?: number; kind?: string; sig?: string; amounts?: Record<string, unknown>; note?: string; ts?: string };
    if (ev.type !== 'flywheel_event' || d.kind !== 'governance') return;
    const id = state.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    state.events.unshift({ id, kind: 'governance', ts: d.ts ?? ev.ts, sig: d.sig ?? 'off-chain', amounts: d.amounts ?? {}, note: d.note ?? null });
  });

  const propose = async (proposer: Keypair, kind: 'add_asset' | 'remove_asset' | 'set_param', payload: Record<string, unknown>, title: string, description: string) => {
    const draft = { kind, payload, title, description, proposer: proposer.publicKey.toBase58() };
    const message = proposeMessage(draft);
    return gov.propose({ ...draft, message, signature: signMessage(proposer.secretKey, message) });
  };
  const vote = (id: number, voter: Keypair, choice: 'for' | 'against' | 'abstain') => {
    const p = repo.gov.get(id)!;
    const message = voteMessage(choice, id, p.snapshot_slot);
    gov.vote(id, { wallet: voter.publicKey.toBase58(), choice, message, signature: signMessage(voter.secretKey, message) });
  };

  void (async () => {
    const t0 = state.tokens[state.tokens.length - 1];
    const h = holders.map((x) => x.kp);
    // 1) executed set_param (closed 20 h ago): drift band 5000 -> 4000 bps
    const p1 = await propose(h[3]!, 'set_param', { key: 'rebalance.driftRelativeBps', value: 4000 }, 'Tighten the drift band to 40%', 'The 50% relative band let small names drift for days between weekly rebalances. 40% keeps the equal-weight promise tighter at a modest auction cost.');
    for (let i = 0; i < 14; i++) vote(p1.id, h[i]!, i % 5 === 0 ? 'against' : 'for');
    now += 2 * HOUR;
    // 2) failed remove (quorum missed), closed 10 h ago
    const p2 = t0 ? await propose(h[8]!, 'remove_asset', { mint: t0.mint, symbol: t0.symbol }, `Remove ${t0.symbol} from the index`, 'Volume has been below the 24h floor on 9 of the last 14 days.') : null;
    if (p2) for (let i = 40; i < 46; i++) vote(p2.id, h[i]!, 'for');
    now += 2 * HOUR;
    // close both: move their end back and tick
    for (const p of [p1, p2]) if (p) repo.gov.update(p.id, { end_ts: new Date(now - 1).toISOString() });
    await gov.tick();
    now = Date.now() - 6 * HOUR;
    // 3) open add_asset with a live tally
    const p3 = await propose(h[1]!, 'add_asset', { mint: Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58(), symbol: 'GOAT', weightBps: 250 }, 'Add GOAT to the index', 'GOAT has cleared every eligibility rule for 30 days: authorities revoked, $412M market cap, $38M daily volume, 41 bps impact on a $10k sale. Proposed at the equal weight of 250 bps.');
    for (let i = 0; i < 9; i++) vote(p3.id, h[i]!, i === 2 ? 'against' : i === 6 ? 'abstain' : 'for');
    now = Date.now() - 1 * HOUR;
    // 4) open set_param, quorum not yet reached
    const p4 = await propose(h[12]!, 'set_param', { key: 'FEE_BURN_PCT', value: 90 }, 'Burn 90% of ETF fees', 'Raise the buyback-and-burn share of mint/redeem/management fees from 75% to 90%; the treasury keeps 10%.');
    for (let i = 20; i < 23; i++) vote(p4.id, h[i]!, 'for');
    vote(p4.id, h[24]!, 'against');
    now = 0; // back to real time
  })().catch((err: Error) => console.error('mock governance seed failed', err.message));
  return gov;
}
