-- Claude Resets: durable application state.
-- Editorial content (events, sources) lives in versioned JSON under content/.
-- This database holds what cannot live in Git: reactions, push subscriptions,
-- and the ledger of what was published/alerted so alerts never replay.

CREATE TABLE IF NOT EXISTS reactions (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
INSERT OR IGNORE INTO reactions (key, count) VALUES ('beg', 0);

CREATE TABLE IF NOT EXISTS reaction_cooldowns (
  identity TEXT PRIMARY KEY,
  last_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT,
  last_error TEXT
);

-- Ledger of publication actions performed through the private endpoint.
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  mode TEXT NOT NULL,            -- publish | backfill | correct
  alert_policy TEXT NOT NULL,    -- default | none | correction
  event_status TEXT NOT NULL,    -- announced | confirmed | cancelled | retracted
  published_at TEXT NOT NULL,
  UNIQUE(event_id, revision)
);

-- One row per alert actually created (never more than one 'reset' alert per event).
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  alert_revision INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- reset | correction
  cutoff_at TEXT NOT NULL,       -- subscription consent cutoff
  created_at TEXT NOT NULL,
  UNIQUE(event_id, alert_revision, kind)
);

CREATE TABLE IF NOT EXISTS push_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | expired | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  leased_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(alert_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS push_jobs_pending ON push_jobs (status, next_attempt_at);
