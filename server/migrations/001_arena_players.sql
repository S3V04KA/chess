-- Migration: Create arena_players table with correct schema
-- Adds support for tracking arena participants with points system (2/1/0)
-- IMPORTANT: Drops existing table if it has wrong schema (created_at instead of joined_at)

DROP TABLE IF EXISTS arena_players;

CREATE TABLE arena_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'spectator' CHECK(status IN ('spectator','playing','left')),
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for efficient queries by arena and status
CREATE INDEX idx_arena_players_arena ON arena_players(arena_id, status);
