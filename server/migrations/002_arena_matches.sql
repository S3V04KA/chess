-- Migration: Create arena_matches table
-- Tracks active matches between players in arenas

DROP TABLE IF EXISTS arena_matches;

CREATE TABLE arena_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  white_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  black_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished')),
  created_at TEXT NOT NULL,
  finished_at TEXT
);

-- Index for efficient queries by arena and status
CREATE INDEX idx_arena_matches_arena ON arena_matches(arena_id, status);
