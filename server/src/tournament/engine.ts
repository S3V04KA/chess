// Tournament engine — a knockout bracket that lives in SQLite.
//
// The whole bracket is materialised in the database (tournaments,
// tournament_players, tournament_matches) and every game a tournament match
// produces is an ordinary `games` row tagged with `tournament_match_id`. That
// is what makes a tournament recoverable: the state on screen is the state in
// the database, so a restart, a crash in the middle of a round or a player
// closing their laptop changes nothing — the next request reads the same
// bracket back.
//
// Rules:
//   * Knockout ("olympic"). Players are seeded by rating when the admin
//     approves the start; each round pairs the remaining players in seed
//     order. An unpaired player (odd count) plays the Stockfish stand-in
//     instead of sitting the round out.
//   * A bot match never eliminates anybody: the human always moves on, but
//     the result still counts for the tournament points (1 / 0.5 / 0) and the
//     game is saved like any other.
//   * Tournament games are unrated (rated = 0): they must not move anybody's
//     Glicko rating. The tournament keeps its own score.
//   * A drawn game between two humans is replayed — nobody is eliminated by
//     a draw, and the replay counts as the same match.

import { db } from '../db.js';
import { createPvpGamePair } from '../chess/pvpGames.js';
import { classifyTimeControl, normaliseTimeControl } from '../chess/timeClass.js';
import { notifyUser } from '../ws/lobby.js';

export type TournamentStatus = 'open' | 'running' | 'finished' | 'cancelled';
export type TournamentResult = '1-0' | '0-1' | '1/2-1/2';

export interface TournamentRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  /** 1 while the tournament is frozen — see pauseTournament(). */
  paused: number;
  time_control: string;
  bot_difficulty: string;
  created_by: number | null;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  winner_user_id: number | null;
}

export interface PlayerRow {
  user_id: number;
  seed: number;
  points: number;
  status: 'joined' | 'eliminated' | 'champion';
  joined_at: string;
}

export interface MatchRow {
  id: number;
  tournament_id: number;
  round: number;
  position: number;
  white_user_id: number | null;
  black_user_id: number | null;
  white_is_bot: number;
  black_is_bot: number;
  result: TournamentResult | null;
  status: 'pending' | 'active' | 'finished';
  winner_user_id: number | null;
  game_external_id: string | null;
  created_at: string;
  finished_at: string | null;
}

// Codes are read out loud and typed back, so no 0/O and no 1/I. Ten symbols —
// deliberately a different length from the twelve-character account invite, so
// a tournament link can never be spent on a sign-up.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export function generateTournamentCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeTournamentCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- lookups ----

export function getTournament(id: number): TournamentRow | undefined {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as TournamentRow | undefined;
}

export function getTournamentByCode(rawCode: string): TournamentRow | undefined {
  const code = normalizeTournamentCode(rawCode);
  if (!code) return undefined;
  return db.prepare('SELECT * FROM tournaments WHERE code = ?').get(code) as TournamentRow | undefined;
}

export function listPlayers(tournamentId: number): PlayerRow[] {
  return db.prepare(
    'SELECT * FROM tournament_players WHERE tournament_id = ? ORDER BY seed, user_id',
  ).all(tournamentId) as PlayerRow[];
}

export function listMatches(tournamentId: number): MatchRow[] {
  return db.prepare(
    'SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, position',
  ).all(tournamentId) as MatchRow[];
}

export function getMatch(id: number): MatchRow | undefined {
  return db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(id) as MatchRow | undefined;
}

export function participantCount(tournamentId: number): number {
  return (db.prepare('SELECT COUNT(*) c FROM tournament_players WHERE tournament_id = ?').get(tournamentId) as { c: number }).c;
}

export function isParticipant(tournamentId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(tournamentId, userId);
}

// ---- create / join ----

export interface CreateTournamentInput {
  name: string;
  description?: string | null;
  time_control?: string;
  bot_difficulty?: string;
  created_by?: number | null;
}

export function createTournament(input: CreateTournamentInput): TournamentRow {
  const name = input.name.trim();
  if (!name) throw new Error('name_required');
  // The preset keyword ('blitz', 'rapid', …), not a seconds string: the bot
  // game needs the keyword, the games row normalises it itself.
  const timeControl = (input.time_control ?? 'blitz').toLowerCase();
  const difficulty = input.bot_difficulty ?? 'medium';
  // Ten random symbols from a 32-letter alphabet is 50 bits — a code nobody
  // guesses by accident, and still readable on a phone.
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateTournamentCode();
    try {
      const r = db.prepare(
        `INSERT INTO tournaments (code, name, description, status, time_control, bot_difficulty, created_by, created_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
      ).run(code, name, input.description?.trim() || null, timeControl, difficulty, input.created_by ?? null, nowIso());
      return getTournament(Number(r.lastInsertRowid))!;
    } catch (err) {
      // A code collision is astronomically unlikely; try again rather than
      // failing the whole tournament.
      if (!/UNIQUE/i.test((err as Error).message)) throw err;
    }
  }
  throw new Error('code_collision');
}

export type JoinResult = { ok: true; tournament: TournamentRow } | { ok: false; error: string };

/**
 * Joining by code. Once the admin has started the tournament the door
 * closes: the bracket is built, the seats are taken, and a newcomer would have
 * nowhere to play.
 */
export function joinTournament(rawCode: string, userId: number): JoinResult {
  const tournament = getTournamentByCode(rawCode);
  if (!tournament) return { ok: false, error: 'not_found' };
  if (tournament.paused) return { ok: false, error: 'tournament_paused' };
  if (tournament.status !== 'open') return { ok: false, error: joinErrorFor(tournament.status) };
  const existing = db.prepare(
    'SELECT * FROM tournament_players WHERE tournament_id = ? AND user_id = ?',
  ).get(tournament.id, userId) as PlayerRow | undefined;
  if (existing) return { ok: true, tournament };
  db.prepare(
    'INSERT INTO tournament_players (tournament_id, user_id, seed, points, status, joined_at) VALUES (?, ?, 0, 0, ?, ?)',
  ).run(tournament.id, userId, 'joined', nowIso());
  return { ok: true, tournament };
}

/** Why a door is closed — the UI says something more useful than "no". */
function joinErrorFor(status: TournamentStatus): string {
  switch (status) {
    case 'running': return 'tournament_started';
    case 'finished': return 'tournament_finished';
    case 'cancelled': return 'tournament_cancelled';
    default: return 'tournament_started';
  }
}

// ---- pause ----

/**
 * Freezes a tournament for a few days — a family cup that runs over a
 * weekend with the games held in between.
 *
 * The pause is a flag, not a status: the underlying status ('open' or
 * 'running') is kept, so resuming restores exactly what was there before.
 * While paused nobody can join, start a game or move a piece; a game that was
 * already in progress simply waits.
 */
export function pauseTournament(tournamentId: number): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament) return false;
  if (tournament.paused) return false;
  if (tournament.status !== 'open' && tournament.status !== 'running') return false;
  db.prepare('UPDATE tournaments SET paused = 1 WHERE id = ?').run(tournamentId);
  return true;
}

export function resumeTournament(tournamentId: number): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament) return false;
  if (!tournament.paused) return false;
  db.prepare('UPDATE tournaments SET paused = 0 WHERE id = ?').run(tournamentId);
  return true;
}

/** Is this tournament frozen right now? */
export function isTournamentPaused(tournamentId: number): boolean {
  const row = db.prepare('SELECT paused FROM tournaments WHERE id = ?').get(tournamentId) as { paused: number } | undefined;
  return !!row?.paused;
}

/**
 * Is the match frozen? A paused tournament freezes its games with it, so the
 * play socket can ask before it accepts a move.
 */
export function isMatchPaused(matchId: number): boolean {
  const row = db.prepare(
    `SELECT t.paused FROM tournament_matches m
     JOIN tournaments t ON t.id = m.tournament_id
     WHERE m.id = ?`,
  ).get(matchId) as { paused: number } | undefined;
  return !!row?.paused;
}

/** The status a player sees: a paused tournament reads as 'paused'. */
export function publicStatus(tournament: TournamentRow): 'open' | 'running' | 'paused' | 'finished' | 'cancelled' {
  if (tournament.paused && (tournament.status === 'open' || tournament.status === 'running')) return 'paused';
  return tournament.status;
}

export function leaveTournament(tournamentId: number, userId: number): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament || tournament.status !== 'open') return false;
  const r = db.prepare('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?').run(tournamentId, userId);
  return r.changes === 1;
}

// ---- start ----

export type StartResult = { ok: true; rounds: number } | { ok: false; error: string };

/**
 * The admin's green light. Seeds the players by rating and builds round 1.
 */
export function startTournament(tournamentId: number, approvedBy: number | null): StartResult {
  const tournament = getTournament(tournamentId);
  if (!tournament) return { ok: false, error: 'not_found' };
  if (tournament.paused) return { ok: false, error: 'tournament_paused' };
  if (tournament.status !== 'open') return { ok: false, error: 'already_started' };

  const players = listPlayers(tournamentId);
  if (players.length === 0) return { ok: false, error: 'no_players' };
  // A knockout needs two people. One player is not a tournament — the admin
  // has not gathered the group yet.
  if (players.length < 2) return { ok: false, error: 'not_enough_players' };

  seedPlayers(tournament);
  db.prepare(`UPDATE tournaments SET status = 'running', approved_at = ?, started_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), tournamentId);

  generateRound(tournamentId, 1, seededPlayers(tournamentId));
  return { ok: true, rounds: 1 };
}

/** Seed by rating (the tournament's own time class), falling back to 1200. */
function seedPlayers(tournament: TournamentRow): void {
  const timeClass = classifyTimeControl(normaliseTimeControl(tournament.time_control));
  const rows = db.prepare(
    `SELECT tp.user_id
     FROM tournament_players tp
     JOIN users u ON u.id = tp.user_id
     JOIN profiles p ON p.user_id = u.id
     WHERE tp.tournament_id = ?
     ORDER BY COALESCE((SELECT rating FROM ratings r WHERE r.user_id = tp.user_id AND r.time_class = ?), 1200) DESC,
              tp.joined_at ASC, tp.user_id ASC`,
  ).all(tournament.id, timeClass ?? '') as { user_id: number }[];
  const update = db.prepare('UPDATE tournament_players SET seed = ? WHERE tournament_id = ? AND user_id = ?');
  rows.forEach((r, i) => update.run(i + 1, tournament.id, r.user_id));
}

interface SeededPlayer {
  user_id: number;
  seed: number;
}

function seededPlayers(tournamentId: number): SeededPlayer[] {
  return db.prepare(
    'SELECT user_id, seed FROM tournament_players WHERE tournament_id = ? ORDER BY seed, user_id',
  ).all(tournamentId) as SeededPlayer[];
}

/**
 * Builds one round.
 *
 * `ordered` is the player order for this round — by seed in round 1, and by
 * the previous round's match order afterwards, which keeps the bracket
 * connected on screen (round 2's first match is the winner of round 1's first
 * match against the winner of its second).
 *
 * An odd count leaves one player unpaired: that player plays the bot rather
 * than sitting the round out.
 */
function generateRound(tournamentId: number, round: number, ordered: SeededPlayer[]): void {
  const tournament = getTournament(tournamentId)!;
  const insert = db.prepare(
    `INSERT INTO tournament_matches
       (tournament_id, round, position, white_user_id, black_user_id, white_is_bot, black_is_bot, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  );
  const pairs = pairRound(ordered);
  pairs.forEach((pair, i) => {
    const r = insert.run(
      tournamentId, round, i,
      pair.white?.user_id ?? null, pair.black?.user_id ?? null,
      pair.white ? 0 : 1, pair.black ? 0 : 1,
      nowIso(),
    );
    const matchId = Number(r.lastInsertRowid);
    if (pair.white && pair.black) {
      // Two humans: the better seed takes White. The game itself is created
      // when somebody opens the match (claimMatch) — a pairing nobody has
      // played yet must not show up in the player's game list.
      const white = betterSeeded(pair.white, pair.black);
      const black = white.user_id === pair.white.user_id ? pair.black : pair.white;
      db.prepare('UPDATE tournament_matches SET white_user_id = ?, black_user_id = ? WHERE id = ?')
        .run(white.user_id, black.user_id, matchId);
      notifyPlayer(white.user_id, tournament.id, matchId);
      notifyPlayer(black.user_id, tournament.id, matchId);
    } else {
      // Human vs Stockfish: the game is created when the player opens it —
      // the difficulty is the admin's choice, so the client cannot pick a
      // different one. The colour alternates by round, so nobody is always
      // White against the engine.
      const human = pair.white ?? pair.black!;
      const humanIsWhite = round % 2 === 1;
      db.prepare(
        `UPDATE tournament_matches SET white_user_id = ?, black_user_id = ?, white_is_bot = ?, black_is_bot = ?
         WHERE id = ?`,
      ).run(
        humanIsWhite ? human.user_id : null,
        humanIsWhite ? null : human.user_id,
        humanIsWhite ? 0 : 1,
        humanIsWhite ? 1 : 0,
        matchId,
      );
      notifyPlayer(human.user_id, tournament.id, matchId);
    }
  });
}

interface Pair {
  white: SeededPlayer | null;
  black: SeededPlayer | null;
}

function pairRound(ordered: SeededPlayer[]): Pair[] {
  const n = ordered.length;
  const pairs: Pair[] = [];
  const half = Math.floor(n / 2);
  for (let i = 0; i < half; i++) pairs.push({ white: ordered[i * 2]!, black: ordered[i * 2 + 1]! });
  if (n % 2 === 1) pairs.push({ white: ordered[n - 1]!, black: null });
  return pairs;
}

/** The better seed takes White — the same convention a chess club uses. */
function betterSeeded(a: SeededPlayer, b: SeededPlayer): SeededPlayer {
  return a.seed <= b.seed ? a : b;
}

function playerNames(userIds: number[]): Map<number, string> {
  if (userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT p.user_id, p.display_name FROM profiles p WHERE p.user_id IN (${placeholders})`,
  ).all(...userIds) as { user_id: number; display_name: string }[];
  return new Map(rows.map((r) => [r.user_id, r.display_name]));
}

/**
 * Creates the two `games` rows for a human-vs-human match (one per player, as
 * the play socket expects) and stamps them with the match id.
 */
function createMatchGame(
  matchId: number,
  tournament: TournamentRow,
  args: { whiteUserId: number; blackUserId: number; whiteName: string; blackName: string; attempt: number },
): void {
  const externalId = `tournament-${matchId}-${args.attempt}`;
  createPvpGamePair({
    externalId,
    whiteUserId: args.whiteUserId,
    blackUserId: args.blackUserId,
    whiteName: args.whiteName,
    blackName: args.blackName,
    timeControl: tournament.time_control,
    rated: false,
    source: 'tournament',
    tournamentMatchId: matchId,
  });
  db.prepare('UPDATE tournament_matches SET game_external_id = ? WHERE id = ?').run(externalId, matchId);
}

export interface ClaimedMatch {
  match_id: number;
  game_id: number;
  color: 'white' | 'black';
  opponent_name: string;
}

/**
 * A player opens their match. The game pair is created here rather than when
 * the round was drawn: a pairing nobody has touched yet must not appear in
 * anybody's game list as an unfinished game.
 *
 * Safe to call twice — the second call finds the pair that already exists.
 */
export function claimMatch(matchId: number, userId: number): ClaimedMatch | null {
  const match = getMatch(matchId);
  if (!match || match.status === 'finished') return null;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || tournament.status !== 'running') return null;
  // A paused tournament is frozen: nobody starts a new game in it.
  if (tournament.paused) return null;
  if (match.white_is_bot === 1 || match.black_is_bot === 1) return null; // bot matches have no game pair
  const whiteId = match.white_user_id;
  const blackId = match.black_user_id;
  if (!whiteId || !blackId) return null;
  if (whiteId !== userId && blackId !== userId) return null;

  let externalId = match.game_external_id;
  if (!externalId) {
    const names = playerNames([whiteId, blackId]);
    externalId = `tournament-${matchId}-1`;
    createPvpGamePair({
      externalId,
      whiteUserId: whiteId,
      blackUserId: blackId,
      whiteName: names.get(whiteId) ?? 'Player',
      blackName: names.get(blackId) ?? 'Player',
      timeControl: tournament.time_control,
      rated: false,
      source: 'tournament',
      tournamentMatchId: matchId,
    });
    db.prepare('UPDATE tournament_matches SET game_external_id = ? WHERE id = ?').run(externalId, matchId);
  }

  const row = db.prepare('SELECT id FROM games WHERE external_id = ? AND user_id = ?')
    .get(externalId, userId) as { id: number } | undefined;
  if (!row) return null;
  const opponentId = whiteId === userId ? blackId : whiteId;
  const opponentName = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(opponentId) as { display_name: string } | undefined;
  return {
    match_id: matchId,
    game_id: row.id,
    color: whiteId === userId ? 'white' : 'black',
    opponent_name: opponentName?.display_name ?? 'Player',
  };
}

function notifyPlayer(userId: number, tournamentId: number, matchId: number): void {
  notifyUser(userId, { type: 'tournament_match', tournament_id: tournamentId, match_id: matchId });
}

// ---- results ----

/**
 * A human-vs-human match was decided. `result` is from White's point of view.
 *
 * Safe to call twice for the same result: a finished match is left alone.
 */
export function reportMatchResult(matchId: number, result: TournamentResult): void {
  const match = getMatch(matchId);
  if (!match || match.status === 'finished') return;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || tournament.status !== 'running') return;
  if (match.white_is_bot === 1 || match.black_is_bot === 1) return; // bot matches report differently
  const whiteId = match.white_user_id;
  const blackId = match.black_user_id;
  if (!whiteId || !blackId) return;

  if (result === '1/2-1/2') {
    // A draw is replayed: the same two players, a fresh game, nobody out.
    // The finished game stays in the players' history — it was played — but
    // the match continues with a new one.
    const attempt = countAttempts(matchId) + 1;
    const names = playerNames([whiteId, blackId]);
    createMatchGame(matchId, tournament, {
      whiteUserId: whiteId,
      blackUserId: blackId,
      whiteName: names.get(whiteId) ?? 'Player',
      blackName: names.get(blackId) ?? 'Player',
      attempt,
    });
    db.prepare(
      `UPDATE tournament_matches SET status = 'active', result = NULL, winner_user_id = NULL, finished_at = NULL WHERE id = ?`,
    ).run(matchId);
    notifyPlayer(whiteId, tournament.id, matchId);
    notifyPlayer(blackId, tournament.id, matchId);
    return;
  }

  const whiteWon = result === '1-0';
  const winnerId = whiteWon ? whiteId : blackId;
  const loserId = whiteWon ? blackId : whiteId;
  db.prepare('UPDATE tournament_players SET points = points + 1 WHERE tournament_id = ? AND user_id = ?')
    .run(tournament.id, winnerId);
  db.prepare(`UPDATE tournament_players SET status = 'eliminated' WHERE tournament_id = ? AND user_id = ?`)
    .run(tournament.id, loserId);
  db.prepare(`UPDATE tournament_matches SET result = ?, status = 'finished', winner_user_id = ?, finished_at = ? WHERE id = ?`)
    .run(result, winnerId, nowIso(), matchId);
  advanceIfRoundComplete(tournament, match.round);
}

/**
 * The bot match ended. `outcome` is the human's result ('win' | 'draw' |
 * 'loss'). The bot fills an empty seat — it never eliminates the human, who
 * always moves on — but the game still counts for the tournament points.
 */
export function reportBotMatchResult(matchId: number, outcome: 'win' | 'draw' | 'loss'): void {
  const match = getMatch(matchId);
  if (!match || match.status === 'finished') return;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || tournament.status !== 'running') return;
  if (match.white_is_bot !== 1 && match.black_is_bot !== 1) return;
  const humanId = match.white_is_bot === 1 ? match.black_user_id : match.white_user_id;
  if (!humanId) return;

  const points = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
  // The stored result stays in chess notation from White's point of view, so
  // the bracket reads the same way for a bot match as for a real one.
  const humanIsWhite = match.white_is_bot === 0;
  const result: TournamentResult =
    outcome === 'draw' ? '1/2-1/2'
      : (humanIsWhite === (outcome === 'win')) ? '1-0' : '0-1';

  db.prepare('UPDATE tournament_players SET points = points + ? WHERE tournament_id = ? AND user_id = ?')
    .run(points, tournament.id, humanId);
  db.prepare(`UPDATE tournament_matches SET result = ?, status = 'finished', winner_user_id = ?, finished_at = ? WHERE id = ?`)
    .run(result, humanId, nowIso(), matchId);
  advanceIfRoundComplete(tournament, match.round);
}

/** How many games this match has had so far (a replay counts as another). */
function countAttempts(matchId: number): number {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT external_id) c FROM games WHERE tournament_match_id = ?`,
  ).get(matchId) as { c: number };
  return row.c;
}

/**
 * When every match of a round is decided, the next round is built from the
 * survivors — or the tournament ends with a champion.
 */
function advanceIfRoundComplete(tournament: TournamentRow, round: number): void {
  const roundMatches = db.prepare(
    'SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? ORDER BY position',
  ).all(tournament.id, round) as MatchRow[];
  if (roundMatches.length === 0) return;
  if (!roundMatches.every((m) => m.status === 'finished')) return;

  // The survivors in the order their matches were played — that is what keeps
  // the next round connected to the previous one on screen.
  const survivors = roundMatches
    .map((m) => m.winner_user_id)
    .filter((id): id is number => typeof id === 'number');

  if (survivors.length <= 1) {
    finishTournament(tournament, survivors[0] ?? null);
    return;
  }

  const ordered = db.prepare(
    `SELECT tp.user_id, tp.seed FROM tournament_players tp
     WHERE tp.tournament_id = ? AND tp.status = 'joined'
     ORDER BY tp.seed`,
  ).all(tournament.id) as SeededPlayer[];
  const alive = ordered.filter((p) => survivors.includes(p.user_id));
  generateRound(tournament.id, round + 1, alive);
}

function finishTournament(tournament: TournamentRow, winnerId: number | null): void {
  db.prepare(`UPDATE tournaments SET status = 'finished', finished_at = ? WHERE id = ?`).run(nowIso(), tournament.id);
  db.prepare(`UPDATE tournament_players SET status = 'eliminated' WHERE tournament_id = ? AND status = 'joined'`)
    .run(tournament.id);
  if (winnerId) {
    db.prepare(`UPDATE tournament_players SET status = 'champion' WHERE tournament_id = ? AND user_id = ?`)
      .run(tournament.id, winnerId);
    db.prepare('UPDATE tournaments SET winner_user_id = ? WHERE id = ?').run(winnerId, tournament.id);
  }
  for (const p of listPlayers(tournament.id)) {
    notifyUser(p.user_id, { type: 'tournament_finished', tournament_id: tournament.id, winner_user_id: winnerId });
  }
}

export function cancelTournament(tournamentId: number): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament || tournament.status === 'finished') return false;
  db.prepare(`UPDATE tournaments SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(nowIso(), tournamentId);
  return true;
}

/**
 * The settings a bot match runs with: the difficulty the admin picked, the
 * tournament's clock and the colour the player has. The client sends none of
 * it — it asks the server what the match is and plays that.
 *
 * Returns null when the match is not a bot match of this player, or when it
 * is already over.
 */
export function tournamentBotMatchSettings(
  matchId: number,
  userId: number,
): { difficulty: string; timeControl: string; color: 'white' | 'black' } | null {
  const match = getMatch(matchId);
  if (!match || match.status === 'finished') return null;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || tournament.status !== 'running') return null;
  if (match.white_is_bot !== 1 && match.black_is_bot !== 1) return null;
  const humanId = match.white_is_bot === 1 ? match.black_user_id : match.white_user_id;
  if (humanId !== userId) return null;
  return {
    difficulty: tournament.bot_difficulty,
    timeControl: tournament.time_control,
    color: match.white_is_bot === 1 ? 'black' : 'white',
  };
}

/**
 * The admin decides a match that cannot be played (one player never turned
 * up). Same effect as a played game, but chosen by a human.
 */
export function resolveMatch(matchId: number, winnerUserId: number): boolean {
  const match = getMatch(matchId);
  if (!match || match.status === 'finished') return false;
  const tournament = getTournament(match.tournament_id);
  if (!tournament || tournament.status !== 'running') return false;
  const whiteId = match.white_user_id;
  const blackId = match.black_user_id;
  if (!whiteId || !blackId) return false;
  if (winnerUserId !== whiteId && winnerUserId !== blackId) return false;

  const result: TournamentResult = winnerUserId === whiteId ? '1-0' : '0-1';
  const loserId = winnerUserId === whiteId ? blackId : whiteId;
  db.prepare('UPDATE tournament_players SET points = points + 1 WHERE tournament_id = ? AND user_id = ?')
    .run(tournament.id, winnerUserId);
  db.prepare(`UPDATE tournament_players SET status = 'eliminated' WHERE tournament_id = ? AND user_id = ?`)
    .run(tournament.id, loserId);
  db.prepare(`UPDATE tournament_matches SET result = ?, status = 'finished', winner_user_id = ?, finished_at = ? WHERE id = ?`)
    .run(result, winnerUserId, nowIso(), matchId);
  advanceIfRoundComplete(tournament, match.round);
  return true;
}

// ---- recovery ----

/**
 * Re-applies results that were played but never made it into the bracket —
 * the server may have died between "the game ended" and "the tournament
 * noticed". Everything is idempotent, so running this on every start is safe.
 */
export function recoverTournaments(): void {
  const tournaments = db.prepare(`SELECT * FROM tournaments WHERE status = 'running'`).all() as TournamentRow[];
  for (const tournament of tournaments) {
    const pending = db.prepare(
      `SELECT * FROM tournament_matches WHERE tournament_id = ? AND status != 'finished'`,
    ).all(tournament.id) as MatchRow[];
    for (const match of pending) {
      if (match.white_is_bot === 1 || match.black_is_bot === 1) {
        // A bot match: the games row is written by the play socket, and its
        // result is already from the human's point of view.
        const game = db.prepare(
          `SELECT result FROM games WHERE tournament_match_id = ? AND result IS NOT NULL ORDER BY id DESC LIMIT 1`,
        ).get(match.id) as { result: string } | undefined;
        if (!game) continue;
        if (game.result === 'win') reportBotMatchResult(match.id, 'win');
        else if (game.result === 'loss') reportBotMatchResult(match.id, 'loss');
        else if (game.result === 'draw') reportBotMatchResult(match.id, 'draw');
        continue;
      }
      // Only the current attempt counts — a replayed draw leaves the earlier
      // game behind with a result, and that one must not be read twice.
      const games = match.game_external_id
        ? db.prepare(
            `SELECT user_color, result FROM games WHERE external_id = ? AND result IS NOT NULL`,
          ).all(match.game_external_id) as { user_color: 'white' | 'black'; result: string }[]
        : [];
      if (games.length === 0) continue;
      const white = games.find((g) => g.user_color === 'white');
      if (!white) continue;
      const result: TournamentResult | null =
        white.result === 'win' ? '1-0' : white.result === 'loss' ? '0-1' : white.result === 'draw' ? '1/2-1/2' : null;
      if (result) reportMatchResult(match.id, result);
    }
  }
}
