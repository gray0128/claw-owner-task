-- Migration: Create task_summaries table for AI summaries
CREATE TABLE task_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,          -- 生成的唯一链接标识
    summary_json TEXT NOT NULL,         -- AI 生成并返回的格式化总结 JSON 数据
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 创建时间
    expires_at DATETIME NOT NULL        -- 过期时间（创建时间 + 24小时）
);

-- 为了加速基于 UUID 的查询
CREATE INDEX idx_task_summaries_uuid ON task_summaries(uuid);
