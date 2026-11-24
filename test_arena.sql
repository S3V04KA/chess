-- Create arenas table if not exists
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
  closed_at TEXT,
  paused INTEGER NOT NULL DEFAULT 0
);

-- Create arena_players table if not exists
CREATE TABLE IF NOT EXISTS arena_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'spectator' CHECK(status IN ('spectator','playing','left')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create arena_matches table if not exists
CREATE TABLE IF NOT EXISTS arena_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  white_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  black_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','finished')),
  created_at TEXT NOT NULL,
  finished_at TEXT
);

-- Create arena_pauses table if not exists
CREATE TABLE IF NOT EXISTS arena_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
