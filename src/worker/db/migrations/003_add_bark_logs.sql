-- Migration: 003_add_bark_logs
-- Created at: 2026-03-04

-- Bark Push Logs Table
CREATE TABLE IF NOT EXISTS bark_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  payload TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bark_logs_task_id ON bark_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_bark_logs_pushed_at ON bark_logs(pushed_at);
