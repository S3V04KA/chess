-- Migration: Create arena_players table
-- Adds support for tracking arena participants with points system (2/1/0)
-- Safe to run on production database - uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS arena_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'spectator' CHECK(status IN ('spectator','playing','left')),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient queries by arena and status
CREATE INDEX IF NOT EXISTS idx_arena_players_arena ON arena_players(arena_id, status);
