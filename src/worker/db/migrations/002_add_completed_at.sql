-- Migration: 002_add_completed_at
-- Created at: 2026-03-03

ALTER TABLE tasks ADD COLUMN completed_at DATETIME;
