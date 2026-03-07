CREATE TABLE IF NOT EXISTS task_lists (
    uuid TEXT PRIMARY KEY,
    tasks_json TEXT NOT NULL,
    intent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_lists_expires_at ON task_lists(expires_at);