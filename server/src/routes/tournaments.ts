// Tournament API — the player-facing half.
//
// Joining works from a link: an admin creates a tournament, shares
// `/tournaments/join/<code>`, the players open it, log in and press "Join".
// Nothing happens until the admin approves the start.
//
// The bracket itself is the tournament's own state (server/src/tournament/
// engine.ts) — this file only reads it and shapes it for the UI.

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import {
  claimMatch,
  getTournament,
  getTournamentByCode,
  listMatches,
  listPlayers,
  participantCount,
  joinTournament,
  leaveTournament,
  isParticipant,
  publicStatus,
  type MatchRow,
  type TournamentRow,
} from '../tournament/engine.js';

const router = new Hono();

// ---- public: what the link is about ----

/**
 * The landing page of an invitation link. Public on purpose: a guest should
 * see what the tournament is before being asked to sign in.
 */
router.get('/code/:code', (c) => {
  const tournament = getTournamentByCode(c.req.param('code'));
  if (!tournament) return c.json({ error: 'not_found' }, 404);
  return c.json({ tournament: summarize(tournament) });
});

// ---- joining ----

router.post('/code/:code/join', requireAuth, async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({}).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const result = joinTournament(c.req.param('code'), me.id);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 409;
    return c.json({ error: result.error }, status);
  }
  return c.json({ tournament: summarize(result.tournament) });
});

// ---- my tournaments ----

router.get('/', requireAuth, (c) => {
  const me = c.get('user');
  const rows = db.prepare(`
    SELECT t.* FROM tournaments t
    WHERE t.status IN ('open','running','finished')
      AND (t.status = 'open'
           OR EXISTS (SELECT 1 FROM tournament_players tp WHERE tp.tournament_id = t.id AND tp.user_id = ?))
    ORDER BY t.created_at DESC
    LIMIT 50
  `).all(me.id) as TournamentRow[];

  const tournaments = rows.map((t) => ({
    ...summarize(t),
    joined: isParticipant(t.id, me.id),
  }));
  return c.json({ tournaments });
});

/** The whole bracket: players, rounds, matches and the caller's own match. */
router.get('/:id', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const tournament = getTournament(id);
  if (!tournament) return c.json({ error: 'not_found' }, 404);

  const matches = listMatches(id);
  const players = listPlayers(id);
  const profiles = new Map<number, { display_name: string; avatar_emoji: string; username: string }>();
  for (const p of players) {
    const row = db.prepare(
      'SELECT p.display_name, p.avatar_emoji, u.username FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?',
    ).get(p.user_id) as { display_name: string; avatar_emoji: string; username: string } | undefined;
    if (row) profiles.set(p.user_id, row);
  }

  const rounds: { round: number; matches: ReturnType<typeof shapeMatch>[] }[] = [];
  for (const m of matches) {
    let round = rounds.find((r) => r.round === m.round);
    if (!round) { round = { round: m.round, matches: [] }; rounds.push(round); }
    round.matches.push(shapeMatch(m, me.id, profiles));
  }

  const playerRows = players.map((p) => {
    const prof = profiles.get(p.user_id);
    return {
      user_id: p.user_id,
      display_name: prof?.display_name ?? `#${p.user_id}`,
      avatar_emoji: prof?.avatar_emoji ?? '♟',
      username: prof?.username ?? '',
      seed: p.seed,
      points: p.points,
      status: p.status,
    };
  });

  return c.json({
    tournament: summarize(tournament),
    players: playerRows,
    rounds,
    my_matches: matches
      .filter((m) => m.white_user_id === me.id || m.black_user_id === me.id)
      .map((m) => shapeMatch(m, me.id, profiles)),
  });
});

/** Leaves a tournament that has not started yet. */
router.post('/:id/leave', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!leaveTournament(id, me.id)) return c.json({ error: 'cannot_leave' }, 409);
  return c.json({ ok: true });
});

/**
 * Joins a tournament the player found on their own (not through the
 * invitation link). Same rule as joining by code: once the admin has started
 * it, the door is closed.
 */
router.post('/:id/join', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const tournament = getTournament(id);
  if (!tournament) return c.json({ error: 'not_found' }, 404);
  const result = joinTournament(tournament.code, me.id);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 409;
    return c.json({ error: result.error }, status);
  }
  return c.json({ tournament: summarize(result.tournament) });
});

/**
 * The settings a bot match needs: which difficulty the admin picked, which
 * clock the tournament runs on and which colour the player has. The client
 * cannot choose any of it — that is the admin's decision.
 */
router.get('/matches/:id/info', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const row = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(id) as MatchRow | undefined;
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.white_user_id !== me.id && row.black_user_id !== me.id) return c.json({ error: 'forbidden' }, 403);
  const tournament = getTournament(row.tournament_id);
  if (!tournament) return c.json({ error: 'not_found' }, 404);
  return c.json({
    match_id: row.id,
    tournament_id: tournament.id,
    difficulty: tournament.bot_difficulty,
    time_control: tournament.time_control,
    color: row.white_user_id === me.id ? 'white' : 'black',
  });
});

/**
 * "I'm playing this match" — hands the player the game row the play socket
 * expects. The game pair is created here, the first time somebody opens the
 * match: a pairing nobody has touched yet stays out of the game list.
 */
router.post('/matches/:id/claim', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  const claimed = claimMatch(id, me.id);
  if (!claimed) return c.json({ error: 'cannot_claim' }, 409);
  return c.json({ match: claimed });
});

// ---- shaping ----

function summarize(t: TournamentRow) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    status: publicStatus(t),
    time_control: t.time_control,
    bot_difficulty: t.bot_difficulty,
    participants: participantCount(t.id),
    created_at: t.created_at,
    approved_at: t.approved_at,
    started_at: t.started_at,
    finished_at: t.finished_at,
    winner_user_id: t.winner_user_id,
  };
}

type Profiles = Map<number, { display_name: string; avatar_emoji: string; username: string }>;

function shapeMatch(m: MatchRow, viewerId: number, profiles: Profiles) {
  const side = (userId: number | null, isBot: number) => {
    if (isBot) return { user_id: null, display_name: 'Stockfish', avatar_emoji: '🤖', is_bot: true };
    if (userId === null) return null;
    const p = profiles.get(userId);
    return {
      user_id: userId,
      display_name: p?.display_name ?? `#${userId}`,
      avatar_emoji: p?.avatar_emoji ?? '♟',
      is_bot: false,
    };
  };

  const isBotMatch = m.white_is_bot === 1 || m.black_is_bot === 1;
  // The caller's own game row — the play socket looks a game up by
  // `WHERE id = ? AND user_id = ?`, so each side needs its own id.
  let gameId: number | null = null;
  if (m.game_external_id) {
    const row = db.prepare('SELECT id FROM games WHERE external_id = ? AND user_id = ?')
      .get(m.game_external_id, viewerId) as { id: number } | undefined;
    gameId = row?.id ?? null;
  }

  return {
    id: m.id,
    round: m.round,
    position: m.position,
    white: side(m.white_user_id, m.white_is_bot),
    black: side(m.black_user_id, m.black_is_bot),
    result: m.result,
    status: m.status,
    is_bot_match: isBotMatch,
    game_id: gameId,
    my_color: m.white_user_id === viewerId ? 'white' : m.black_user_id === viewerId ? 'black' : null,
  };
}

export default router;
