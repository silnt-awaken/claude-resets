-- Community goal rounds ("Max 20x for a reader") and free entries.
-- Contributions live on-chain (the pool wallet); only entries and round bookkeeping live here.

CREATE TABLE IF NOT EXISTS goal_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  target_usd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | frozen | drawn | paid | cancelled
  opened_at TEXT NOT NULL,
  frozen_at TEXT,
  freeze_block INTEGER,                  -- block at which entries were frozen
  draw_block INTEGER,                    -- announced future block whose hash decides the winner
  draw_hash TEXT,                        -- that block's hash once known
  winner_entry_id INTEGER,
  payout_tx TEXT,
  paid_at TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS goal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  identity_kind TEXT NOT NULL,           -- wallet | x
  identity TEXT NOT NULL,                -- lowercased 0x address or lowercased X handle
  display TEXT NOT NULL,                 -- as entered (for the public entry list, shortened)
  browser_id TEXT,                       -- signed anonymous cookie, one entry per browser per round
  created_at TEXT NOT NULL,
  UNIQUE(round_id, identity_kind, identity)
);
CREATE INDEX IF NOT EXISTS goal_entries_round ON goal_entries (round_id, id);
