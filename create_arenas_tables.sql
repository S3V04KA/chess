-- Arenas tables for Patzer
-- Run this SQL to create arena tables if they don't exist

CREATE TABLE IF NOT EXISTS arenas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','running','paused','closed')),
  time_control TEXT NOT NULL DEFAULT 'blitz',
  bot_difficulty TEXT NOT NULL DEFAULT 'medium',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arenas_status ON arenas(status, created_at DESC);

-- One row per participant. Points are arena-style: 2 for a win, 1 for a draw,
-- 0 for a loss. `status` tracks whether the player is currently in the arena.
CREATE TABLE IF NOT EXISTS arena_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'spectator' CHECK(status IN ('spectator','playing','left')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_arena_players_arena ON arena_players(arena_id, status);

-- One row per match in the arena. The match is active until a game finishes
-- or the player leaves. Games are linked via `games.arena_match_id`.
CREATE TABLE IF NOT EXISTS arena_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  white_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  black_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished')),
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_arena ON arena_matches(arena_id, status);

-- Arena pauses (for the owner to freeze the room). While paused, no new matches
-- can be claimed and clocks stop. The arena itself has a `paused` column added below.
CREATE TABLE IF NOT EXISTS arena_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_pauses_arena ON arena_pauses(arena_id, started_at);

-- Add paused flag to arenas table (separate from status)
ALTER TABLE arenas ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;

-- Link games to arena matches (similar to tournament_match_id)
ALTER TABLE games ADD COLUMN arena_match_id INTEGER;
