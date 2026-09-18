-- Scheduled RESET burns triggered by the site: one row per published reset / paid round.
-- The cron drain signs burnForReset / burnForRound with the burner wallet and records the tx.
CREATE TABLE IF NOT EXISTS token_burns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                    -- reset | round
  ref TEXT NOT NULL,                     -- event id or round id
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | confirmed | failed
  tx_hash TEXT,
  block INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  confirmed_at TEXT,
  UNIQUE(kind, ref)
);
CREATE INDEX IF NOT EXISTS token_burns_status ON token_burns (status, next_attempt_at);
