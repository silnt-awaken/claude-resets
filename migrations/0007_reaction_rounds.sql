-- Per-reset counters. Keep the existing counter and cooldowns in place so no
-- reactions are lost while the old Worker is still serving during deployment.
CREATE TABLE IF NOT EXISTS reaction_rounds (
  event_id TEXT PRIMARY KEY,
  counter_key TEXT NOT NULL UNIQUE REFERENCES reactions(key),
  started_at TEXT NOT NULL
);

-- The currently displayed banked reset adopts the existing total (18 at rollout).
INSERT OR IGNORE INTO reaction_rounds (event_id, counter_key, started_at)
SELECT '2026-09-22-opus-5-5-reset', key, COALESCE(updated_at, '2026-10-08T00:00:00Z')
FROM reactions WHERE key = 'beg';
