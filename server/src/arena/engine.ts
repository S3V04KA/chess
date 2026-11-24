// Arena engine — open, persistent PvP matchmaking
//
// An arena is always running: players join and play immediately against another
// free player or the bot. Matches are short (blitz/bullet), points are awarded
// 2/1/0 (win/draw/loss), and the leaderboard ranks by total points. Draws between
// humans are replayed; draws vs bot count.
//
// The state on screen is the state in the database: arena, arena_players,
// arena_matches. A restart or crash doesn't lose anyone's place.

import { db } from '../db.js';
import { createPvpGamePair } from '../chess/pvpGames.js';
import { notifyUser } from '../ws/lobby.js';

export type ArenaStatus = 'open' | 'running' | 'paused' | 'closed';
export type ArenaResult = '1-0' | '0-1' | '1/2-1/2';

export interface ArenaRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: ArenaStatus;
  time_control: string;
  bot_difficulty: string;
  created_by: number | null;
  created_at: string;
  started_at: string | null;
  closed_at: string | null;
}

export interface ArenaPlayerRow {
  user_id: number;
  points: number;
  status: 'free' | 'playing' | 'spectating';
  joined_at: string;
}

export interface ArenaMatchRow {
  id: number;
  arena_id: number;
  white_user_id: number | null;
  black_user_id: number | null;
  white_is_bot: number;
  black_is_bot: number;
  result: ArenaResult | null;
  status: 'pending' | 'active' | 'finished';
  game_external_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ArenaSummary {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: ArenaStatus;
  time_control: string;
  bot_difficulty: string;
  participants: number;
  created_at: string;
  started_at: string | null;
}

// Codes are read out loud and typed back, so no 0/O and no 1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export function generateArenaCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeArenaCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- lookups ----

export function getArena(id: number): ArenaRow | undefined {
  return db.prepare('SELECT * FROM arenas WHERE id = ?').get(id) as ArenaRow | undefined;
}

export function getArenaByCode(code: string): ArenaRow | undefined {
  const normalized = normalizeArenaCode(code);
  return db.prepare('SELECT * FROM arenas WHERE code = ?').get(normalized) as ArenaRow | undefined;
}

export function listArenas(): ArenaRow[] {
  return db.prepare('SELECT * FROM arenas ORDER BY created_at DESC').all() as ArenaRow[];
}

export function participantCount(arenaId: number): number {
  const r = db.prepare('SELECT COUNT(*) AS count FROM arena_players WHERE arena_id = ?').get(arenaId) as { count: number };
  return r.count;
}

// ---- admin actions ----

export function createArena(name: string, description: string | null, timeControl: string, botDifficulty: string, createdBy: number): ArenaRow {
  const code = generateArenaCode();
  const now = nowIso();
  const id = db.prepare('INSERT INTO arenas (code, name, description, status, time_control, bot_difficulty, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(code, name, description, 'open', timeControl, botDifficulty, createdBy, now)
    .lastInsertRowid as number;
  return getArena(id)!;
}

export function startArena(arenaId: number): boolean {
  const arena = getArena(arenaId);
  if (!arena || arena.status !== 'open') return false;
  db.prepare('UPDATE arenas SET status = ?, started_at = ? WHERE id = ?')
    .run('running', nowIso(), arenaId);
  return true;
}

export function closeArena(arenaId: number): boolean {
  const arena = getArena(arenaId);
  if (!arena || arena.status === 'closed') return false;
  db.prepare('UPDATE arenas SET status = ?, closed_at = ? WHERE id = ?')
    .run('closed', nowIso(), arenaId);
  return true;
}

export function pauseArena(arenaId: number): boolean {
  const arena = getArena(arenaId);
  if (!arena || arena.status !== 'running') return false;
  db.prepare('UPDATE arenas SET status = ? WHERE id = ?')
    .run('paused', arenaId);
  return true;
}

export function resumeArena(arenaId: number): boolean {
  const arena = getArena(arenaId);
  if (!arena || arena.status !== 'paused') return false;
  db.prepare('UPDATE arenas SET status = ? WHERE id = ?')
    .run('running', arenaId);
  return true;
}

// ---- player actions ----

export function joinArena(arenaCode: string, userId: number): { ok: true; arena: ArenaRow } | { ok: false; error: 'not_found' | 'already_joined' | 'closed' } {
  const arena = getArenaByCode(normalizeArenaCode(arenaCode));
  if (!arena) return { ok: false, error: 'not_found' };
  if (arena.status === 'closed') return { ok: false, error: 'closed' };

  const existing = db.prepare('SELECT 1 FROM arena_players WHERE arena_id = ? AND user_id = ?')
    .get(arena.id, userId);
  if (existing) return { ok: false, error: 'already_joined' };

  db.prepare('INSERT INTO arena_players (arena_id, user_id, status, joined_at) VALUES (?, ?, ?, ?)')
    .run(arena.id, userId, 'free', nowIso());

  notifyUser(userId, { type: 'arena_update', arena_id: arena.id });
  return { ok: true, arena };
}

export function leaveArena(arenaId: number, userId: number): boolean {
  const player = db.prepare('SELECT * FROM arena_players WHERE arena_id = ? AND user_id = ?')
    .get(arenaId, userId) as ArenaPlayerRow | undefined;
  if (!player) return false;
  if (player.status === 'playing') return false; // cannot leave while playing

  db.prepare('DELETE FROM arena_players WHERE arena_id = ? AND user_id = ?').run(arenaId, userId);
  notifyUser(userId, { type: 'arena_left', arena_id: arenaId });
  return true;
}

// ---- matchmaking ----

export function listFreePlayers(arenaId: number): ArenaPlayerRow[] {
  const players = db.prepare(`
    SELECT p.user_id, a.points, p.status, p.joined_at
    FROM arena_players p
    JOIN (
      SELECT user_id, points FROM arena_players WHERE arena_id = ?
    ) a ON p.user_id = a.user_id
    WHERE p.arena_id = ? AND p.status = 'free'
    ORDER BY a.points DESC, p.user_id
  `).all(arenaId, arenaId) as ArenaPlayerRow[];
  return players;
}

export function createMatch(arenaId: number, whiteUserId: number | null, blackUserId: number | null): ArenaMatchRow | null {
  const arena = getArena(arenaId);
  if (!arena || arena.status !== 'running') return null;

  const whiteIsBot = whiteUserId === null;
  const blackIsBot = blackUserId === null;

  // If both are humans, mark them as playing
  if (!whiteIsBot && !blackIsBot) {
    db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
      .run('playing', arenaId, whiteUserId);
    db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
      .run('playing', arenaId, blackUserId);
  }

  const id = db.prepare(`
    INSERT INTO arena_matches (arena_id, white_user_id, black_user_id, white_is_bot, black_is_bot, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(arenaId, whiteUserId, blackUserId, whiteIsBot ? 1 : 0, blackIsBot ? 1 : 0, 'pending', nowIso())
    .lastInsertRowid as number;

  const match = getMatch(id);
  if (!match) return null;

  // Create the game pair (only for human vs human matches)
  if (!whiteIsBot && !blackIsBot) {
    createPvpGamePair({
      externalId: `arena_${id}`,
      whiteUserId,
      blackUserId,
      whiteName: '',
      blackName: '',
      timeControl: arena.time_control,
      rated: false,
      source: 'pvp',
    });
  }
  // Bot matches are handled by the live_bot_games system in the play socket

  return match;
}

export function getMatch(id: number): ArenaMatchRow | undefined {
  return db.prepare('SELECT * FROM arena_matches WHERE id = ?').get(id) as ArenaMatchRow | undefined;
}

export function listMatches(arenaId: number): ArenaMatchRow[] {
  return db.prepare(`
    SELECT m.*, a.status, a.time_control, a.bot_difficulty
    FROM arena_matches m
    JOIN arenas a ON m.arena_id = a.id
    WHERE m.arena_id = ?
    ORDER BY m.created_at DESC
    LIMIT 50
  `).all(arenaId) as ArenaMatchRow[];
}

export function reportMatchResult(matchId: number, result: ArenaResult, winnerUserId: number | null): boolean {
  const match = getMatch(matchId);
  if (!match) return false;

  // Mark match as finished
  db.prepare('UPDATE arena_matches SET result = ?, status = ?, finished_at = ? WHERE id = ?')
    .run(result, 'finished', nowIso(), matchId);

  // Award points: 2 for win, 1 for draw, 0 for loss
  if (result === '1-0' || result === '0-1') {
    const winnerId = result === '1-0' ? match.white_user_id : match.black_user_id;
    const loserId = result === '1-0' ? match.black_user_id : match.white_user_id;

    if (winnerId) {
      db.prepare('UPDATE arena_players SET points = points + 2 WHERE arena_id = ? AND user_id = ?')
        .run(match.arena_id, winnerId);
    }
    if (loserId) {
      db.prepare('UPDATE arena_players SET points = points + 0 WHERE arena_id = ? AND user_id = ?')
        .run(match.arena_id, loserId);
    }

    // Free both players
    if (match.white_user_id) {
      db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
        .run('free', match.arena_id, match.white_user_id);
    }
    if (match.black_user_id) {
      db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
        .run('free', match.arena_id, match.black_user_id);
    }

    notifyUser(winnerId!, { type: 'arena_match_finished', match_id: matchId, result });
    if (loserId) {
      notifyUser(loserId, { type: 'arena_match_finished', match_id: matchId, result });
    }

  } else if (result === '1/2-1/2') {
    // Draw: both get 1 point
    if (match.white_user_id) {
      db.prepare('UPDATE arena_players SET points = points + 1 WHERE arena_id = ? AND user_id = ?')
        .run(match.arena_id, match.white_user_id);
    }
    if (match.black_user_id) {
      db.prepare('UPDATE arena_players SET points = points + 1 WHERE arena_id = ? AND user_id = ?')
        .run(match.arena_id, match.black_user_id);
    }

    // If both are humans and it's a draw, replay (keep them as playing)
    if (!match.white_is_bot && !match.black_is_bot) {
      // Replay: don't free players, just reset match status
      db.prepare('UPDATE arena_matches SET result = NULL, status = ?, finished_at = NULL WHERE id = ?')
        .run('pending', matchId);
      notifyUser(match.white_user_id!, { type: 'arena_draw_replay', match_id: matchId });
      notifyUser(match.black_user_id!, { type: 'arena_draw_replay', match_id: matchId });
    } else {
      // Bot draw or one human vs bot: free players
      if (match.white_user_id) {
        db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
          .run('free', match.arena_id, match.white_user_id);
      }
      if (match.black_user_id) {
        db.prepare('UPDATE arena_players SET status = ? WHERE arena_id = ? AND user_id = ?')
          .run('free', match.arena_id, match.black_user_id);
      }

      notifyUser(match.white_user_id!, { type: 'arena_match_finished', match_id: matchId, result });
      notifyUser(match.black_user_id!, { type: 'arena_match_finished', match_id: matchId, result });
    }
  }

  return true;
}

export function listPlayers(arenaId: number): ArenaPlayerRow[] {
  const players = db.prepare(`
    SELECT p.user_id, a.points, p.status, p.joined_at
    FROM arena_players p
    JOIN (
      SELECT user_id, points FROM arena_players WHERE arena_id = ?
    ) a ON p.user_id = a.user_id
    WHERE p.arena_id = ?
    ORDER BY a.points DESC, p.user_id
  `).all(arenaId, arenaId) as ArenaPlayerRow[];
  return players;
}

export function summarize(arena: ArenaRow): ArenaSummary {
  return {
    id: arena.id,
    code: arena.code,
    name: arena.name,
    description: arena.description,
    status: arena.status,
    time_control: arena.time_control,
    bot_difficulty: arena.bot_difficulty,
    participants: participantCount(arena.id),
    created_at: arena.created_at,
    started_at: arena.started_at,
  };
}
