-- Contributor discovery moves from per-request log scans to an incremental cron sync:
-- the round remembers the last block it has ingested USDG transfers up to.
ALTER TABLE goal_rounds ADD COLUMN synced_block INTEGER;
