-- One announcement per release or X post. Ambiguous delivery is held for review, never blindly retried.
CREATE TABLE IF NOT EXISTS telegram_outbox (
  dedupe_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('release', 'tweet')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'unknown')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  leased_until TEXT,
  lease_token TEXT,
  telegram_message_id INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS telegram_pending ON telegram_outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS telegram_incoming (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL
);
