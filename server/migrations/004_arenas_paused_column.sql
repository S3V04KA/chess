-- Migration: Add paused column to arenas table
-- Adds a separate paused flag from status for arena owners to freeze the room
-- Safe to run on production database - uses ensureColumn pattern

-- Note: This migration is handled by ensureColumn() in db.ts
-- The SQL equivalent would be:
-- ALTER TABLE arenas ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
