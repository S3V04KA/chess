-- Migration: Create arena_pauses table
-- Tracks pause events for arena owners to freeze the room
-- Safe to run on production database - uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS arena_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

-- Index for efficient queries by arena and start time
CREATE INDEX IF NOT EXISTS idx_arena_pauses_arena ON arena_pauses(arena_id, started_at);
