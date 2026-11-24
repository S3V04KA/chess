-- Arenas: open, always-running PvP with matchmaking
--
-- An arena is a persistent game room where any player can join and play
-- immediately against another free player or the bot. Matches are short,
-- points are awarded 2/1/0 (win/draw/loss), and the leaderboard ranks by
-- total points. Only admins can create arenas; players just join and play.

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

CREATE INDEX IF NOT EXISTS idx Arenas_status ON arenas(status, created_at DESC);

-- One row per participant. Points are tournament-style: 2 for a win, 1 for a draw,
-- 0 for a loss. `status` tracks whether the player is currently in the arena.
CREATE TABLE IF NOT EXISTS arena_players (
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'free' CHECK(status IN ('free','playing','spectating')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (arena_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_players_user ON arena_players(user_id);

-- One row per match. The engine pairs free players into matches; when a game
-- finishes, the result is written and the players return to 'free'. A bot seat
-- is marked with *_is_bot = 1.
CREATE TABLE IF NOT EXISTS arena_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  white_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  black_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  white_is_bot INTEGER NOT NULL DEFAULT 0,
  black_is_bot INTEGER NOT NULL DEFAULT 0,
  result TEXT CHECK(result IN ('1-0','0-1','1/2-1/2')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','finished')),
  game_external_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_arena ON arena_matches(arena_id, status);

-- Pause intervals: when an arena is paused, no new matches are created and
-- active games freeze. The clock subtraction logic reuses the tournament_pauses
-- pattern but lives here for clarity.
CREATE TABLE IF NOT EXISTS arena_pauses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL REFERENCES arenas(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_pauses_arena ON arena_pauses(arena_id, started_at);
