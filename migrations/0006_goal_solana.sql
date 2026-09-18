-- The community goal moves to Solana: contributors send USDC to the operator's wallet, the cron
-- reads the transfers from the chain, and the draw is automatic. The RESETS token, its burn queue
-- and the EVM-shaped round tables are gone.
DROP TABLE IF EXISTS token_burns;
DROP TABLE IF EXISTS goal_entries;
DROP TABLE IF EXISTS goal_rounds;

CREATE TABLE goal_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  target_usd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | frozen | drawn | paid | cancelled
  opened_at TEXT NOT NULL,
  frozen_at TEXT,
  freeze_slot INTEGER,                   -- slot observed when the target was reached
  draw_slot INTEGER,                     -- announced slot; the first finalized block at or after it decides
  draw_block INTEGER,                    -- the block actually used
  draw_hash TEXT,                        -- that block's base58 hash
  winner_wallet TEXT,
  winner_index INTEGER,
  entries INTEGER,                       -- eligible wallets in the draw
  drawn_at TEXT,
  payout_tx TEXT,                        -- the operator's USDC transfer to the winner
  paid_at TEXT,
  note TEXT
);

CREATE TABLE goal_contributions (
  signature TEXT PRIMARY KEY,            -- Solana transaction signature (base58)
  round_id INTEGER,                      -- NULL while no round is open; the next round adopts it
  wallet TEXT NOT NULL,                  -- sender
  amount_units INTEGER NOT NULL,         -- USDC base units (6 decimals) received
  slot INTEGER NOT NULL,
  block_time INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX goal_contributions_round ON goal_contributions (round_id, slot);

-- Cursor of the chain scan: signatures newer than last_signature are still to be read.
CREATE TABLE goal_sync (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_signature TEXT,
  synced_at TEXT,
  last_error TEXT
);
