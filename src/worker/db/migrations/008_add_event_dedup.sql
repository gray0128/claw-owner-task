-- Event deduplication table for webhook platforms (Feishu, etc.)
-- Prevents duplicate processing when platforms retry event delivery
CREATE TABLE IF NOT EXISTS event_dedup (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
