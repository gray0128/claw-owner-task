-- Migration: 004_remove_reminded
-- Created at: 2026-03-05

-- SQLite 支持 DROP COLUMN，直接移除 reminded 列
ALTER TABLE tasks DROP COLUMN reminded;
