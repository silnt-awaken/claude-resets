-- Entries are contributors: unique wallets that sent USDC to the pool during the round.
-- Rebuild goal_entries with the contributor shape (SQLite cannot alter constraints in place).
ALTER TABLE goal_rounds ADD COLUMN open_block INTEGER;

DROP TABLE IF EXISTS goal_entries;
CREATE TABLE goal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  identity TEXT NOT NULL,                -- lowercase 0x wallet address
  display TEXT NOT NULL,                 -- shortened address for public lists
  amount_units INTEGER NOT NULL DEFAULT 0, -- USDC 6-decimal units contributed in the round
  first_tx TEXT,                         -- first contribution transaction
  created_at TEXT NOT NULL,
  UNIQUE(round_id, identity)
);
CREATE INDEX IF NOT EXISTS goal_entries_round ON goal_entries (round_id, id);
