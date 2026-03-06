-- Migration: 006_add_task_shares.sql
-- Create task_shares table for temporary public task viewing

CREATE TABLE IF NOT EXISTS task_shares (
    uuid TEXT PRIMARY KEY,
    task_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Index for faster lookups by task_id during generation
CREATE INDEX IF NOT EXISTS idx_task_shares_task_id ON task_shares(task_id);
-- Index for cleanup of expired shares
CREATE INDEX IF NOT EXISTS idx_task_shares_expires_at ON task_shares(expires_at);
