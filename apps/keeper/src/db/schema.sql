-- FI6900 keeper schema. All statements are idempotent; `kv.schema_version` tracks migrations.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS nav_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                TEXT    NOT NULL,
  nav_usd           REAL    NOT NULL,
  nav_per_unit_usd  REAL    NOT NULL,
  index_level       REAL    NOT NULL,
  divisor           REAL    NOT NULL,
  market_price_usd  REAL,
  premium_bps       INTEGER,
  supply            TEXT    NOT NULL,      -- raw u64 as decimal string
  epoch             TEXT    NOT NULL,
  sol_price_usd     REAL
);
CREATE INDEX IF NOT EXISTS nav_snapshots_ts ON nav_snapshots(ts);

CREATE TABLE IF NOT EXISTS holdings_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id       INTEGER NOT NULL REFERENCES nav_snapshots(id) ON DELETE CASCADE,
  slot              INTEGER NOT NULL,
  mint              TEXT    NOT NULL,
  balance           TEXT    NOT NULL,
  price_usd         REAL    NOT NULL,
  value_usd         REAL    NOT NULL,
  weight_bps        INTEGER NOT NULL,
  target_weight_bps INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS holdings_snapshots_snapshot ON holdings_snapshots(snapshot_id);

CREATE TABLE IF NOT EXISTS auctions (
  pda             TEXT PRIMARY KEY,
  nonce           TEXT    NOT NULL,
  sell_mint       TEXT    NOT NULL,
  buy_mint        TEXT    NOT NULL,
  sell_total      TEXT    NOT NULL,
  sell_remaining  TEXT    NOT NULL,
  start_price     TEXT    NOT NULL,      -- Q64.64 as decimal string
  end_price       TEXT    NOT NULL,
  start_slot      TEXT    NOT NULL,
  end_slot        TEXT    NOT NULL,
  status          TEXT    NOT NULL,      -- open | filled | cancelled | expired
  mid_price       REAL,                  -- buy per sell (raw units) at open
  reason          TEXT,                  -- scheduled | drift | reconstitution
  start_sig       TEXT,
  created_ts      TEXT    NOT NULL,
  updated_ts      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_status ON auctions(status);

CREATE TABLE IF NOT EXISTS auction_fills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_pda  TEXT NOT NULL REFERENCES auctions(pda) ON DELETE CASCADE,
  sig          TEXT NOT NULL,
  filler       TEXT NOT NULL,
  sell_amount  TEXT NOT NULL,
  buy_amount   TEXT NOT NULL,
  price        TEXT NOT NULL,
  slot         INTEGER NOT NULL,
  ts           TEXT NOT NULL,
  UNIQUE(auction_pda, sig, sell_amount)
);

CREATE TABLE IF NOT EXISTS rebalance_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  sell_mint   TEXT NOT NULL,
  buy_mint    TEXT NOT NULL,
  sell_amount TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued'  -- queued | opened | dropped
);

CREATE TABLE IF NOT EXISTS flywheel_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT NOT NULL,   -- claim|buy_index|add_lp|airdrop|buyback|burn|create|redeem|auction_start|auction_fill|fee_accrual
  ts       TEXT NOT NULL,
  sig      TEXT NOT NULL,
  amounts  TEXT NOT NULL,   -- JSON
  note     TEXT
);
CREATE INDEX IF NOT EXISTS flywheel_events_ts ON flywheel_events(ts);
CREATE INDEX IF NOT EXISTS flywheel_events_kind ON flywheel_events(kind);

CREATE TABLE IF NOT EXISTS airdrop_rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  total_units   TEXT NOT NULL,
  holders       INTEGER NOT NULL,
  paid          INTEGER NOT NULL,
  skipped       INTEGER NOT NULL,
  carried_units TEXT NOT NULL,
  tx_count      INTEGER NOT NULL,
  status        TEXT NOT NULL   -- complete | partial | dry-run
);

CREATE TABLE IF NOT EXISTS airdrop_payouts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id  INTEGER NOT NULL REFERENCES airdrop_rounds(id) ON DELETE CASCADE,
  wallet    TEXT NOT NULL,
  units     TEXT NOT NULL,
  sig       TEXT NOT NULL,
  ts        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airdrop_payouts_wallet ON airdrop_payouts(wallet);

CREATE TABLE IF NOT EXISTS carry (
  wallet     TEXT PRIMARY KEY,
  units      TEXT NOT NULL,
  updated_ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    TEXT NOT NULL,
  title TEXT NOT NULL,
  body  TEXT NOT NULL,
  key   TEXT UNIQUE         -- dedupe key (e.g. recon-2026-11)
);

CREATE TABLE IF NOT EXISTS methodology_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ts             TEXT NOT NULL,
  config_version TEXT NOT NULL,
  config         TEXT NOT NULL,   -- JSON
  eligible       TEXT NOT NULL,   -- JSON
  selected       TEXT NOT NULL,   -- JSON
  weights        TEXT NOT NULL,   -- JSON
  dry            INTEGER NOT NULL DEFAULT 1,
  applied        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS market_observations (
  mint        TEXT NOT NULL,
  day         TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  volume24h   REAL NOT NULL,
  fdv_usd     REAL NOT NULL,
  price_usd   REAL NOT NULL,
  PRIMARY KEY (mint, day)
);

CREATE TABLE IF NOT EXISTS holder_snapshots (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  mint    TEXT NOT NULL,
  holders INTEGER NOT NULL,
  supply  TEXT NOT NULL,
  data    TEXT NOT NULL    -- JSON [{owner, amount}] (top N)
);

-- Index-committee reconstitution proposals (RECONSTITUTION_MODE=manual). One open row per (mint, action).
CREATE TABLE IF NOT EXISTS reconstitution_proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mint          TEXT NOT NULL,
  symbol        TEXT,
  action        TEXT NOT NULL,               -- add | remove
  reason        TEXT NOT NULL,               -- JSON: methodology metrics / 'manual'
  status        TEXT NOT NULL,               -- proposed | approved | rejected | queued | executed
  weight_bps    INTEGER,                     -- target weight for adds (approve --weight overrides)
  proposed_ts   TEXT NOT NULL,
  decided_ts    TEXT,
  queued_ts     TEXT,
  executed_ts   TEXT,
  action_pda    TEXT,                        -- PendingAction PDA once queued
  queued_sig    TEXT,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS reconstitution_proposals_mint ON reconstitution_proposals(mint, status);

-- Local mirror of timelocked admin actions the keeper queued/executed (for /v1/governance queuedSig).
CREATE TABLE IF NOT EXISTS governance_actions (
  pda          TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL,
  kind         INTEGER NOT NULL,
  payload      TEXT NOT NULL,                -- JSON {key, values[]}
  eta_slot     TEXT NOT NULL,
  proposer     TEXT NOT NULL,
  queued_sig   TEXT,
  executed_sig TEXT,
  status       TEXT NOT NULL,                -- queued | executed | cancelled
  label        TEXT,
  created_ts   TEXT NOT NULL,
  updated_ts   TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Holder governance v1: token-weighted, signature-based (gasless) voting by $FIX6900 holders.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov_proposals (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL,                -- add_asset | remove_asset | set_param
  payload          TEXT NOT NULL,                -- JSON {mint, symbol?, weightBps?, allowTransferFee?} | {key, value}
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  proposer         TEXT NOT NULL,                -- wallet (base58) or 'admin'
  created_ts       TEXT NOT NULL,
  snapshot_slot    TEXT NOT NULL,
  snapshot_supply  TEXT NOT NULL,                -- circulating = total - excluded holders (raw units)
  start_ts         TEXT NOT NULL,
  end_ts           TEXT NOT NULL,
  quorum_bps       INTEGER NOT NULL,
  status           TEXT NOT NULL,                -- open | passed | failed | queued | executed | cancelled
  result           TEXT,                         -- JSON tally at close + execution notes
  queued_action_pda TEXT,
  queued_sig       TEXT,
  updated_ts       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gov_proposals_status ON gov_proposals(status);
CREATE INDEX IF NOT EXISTS gov_proposals_proposer ON gov_proposals(proposer, status);

CREATE TABLE IF NOT EXISTS gov_votes (
  proposal_id  INTEGER NOT NULL REFERENCES gov_proposals(id) ON DELETE CASCADE,
  wallet       TEXT NOT NULL,
  choice       TEXT NOT NULL,                    -- for | against | abstain
  weight       TEXT NOT NULL,                    -- raw units at the snapshot
  sig          TEXT NOT NULL,                    -- base58 ed25519 signature
  message      TEXT NOT NULL,                    -- exact signed message
  ts           TEXT NOT NULL,
  PRIMARY KEY (proposal_id, wallet)
);

CREATE TABLE IF NOT EXISTS gov_snapshots (
  proposal_id  INTEGER NOT NULL REFERENCES gov_proposals(id) ON DELETE CASCADE,
  wallet       TEXT NOT NULL,
  balance      TEXT NOT NULL,                    -- raw units at snapshot_slot
  PRIMARY KEY (proposal_id, wallet)
);
