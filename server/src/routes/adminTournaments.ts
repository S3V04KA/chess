// Admin console for tournaments.
//
// The admin creates a tournament, shares the invitation link, waits for the
// players to join and then gives the go-ahead. Nothing starts before that —
// the bracket is built in `startTournament`, so an approval is exactly the
// moment the tournament becomes real.

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin } from '../auth/middleware.js';
import { publicBaseUrl } from '../publicUrl.js';
import {
  cancelTournament,
  createTournament,
  getTournament,
  listMatches,
  listPlayers,
  participantCount,
  publicStatus,
  resolveMatch,
  resumeTournament,
  pauseTournament,
  startTournament,
  type TournamentRow,
} from '../tournament/engine.js';

const router = new Hono();
router.use('*', requireAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  time_control: z.enum(['untimed', 'bullet', 'blitz', 'rapid', 'classical']).default('blitz'),
  bot_difficulty: z.enum(['kid', 'beginner', 'easy', 'medium', 'hard', 'master', 'stockfish']).default('medium'),
});

router.get('/', (c) => {
  const rows = db.prepare(`
    SELECT * FROM tournaments t ORDER BY t.created_at DESC LIMIT 100
  `).all() as TournamentRow[];
  const base = publicBaseUrl(c);

  // Who joined each tournament — the admin needs to see the guest list
  // before pressing start.
  const participants = new Map<number, { user_id: number; display_name: string; avatar_emoji: string; username: string }[]>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    const joined = db.prepare(`
      SELECT tp.tournament_id, u.id AS user_id, p.display_name, p.avatar_emoji, u.username
      FROM tournament_players tp
      JOIN users u ON u.id = tp.user_id
      JOIN profiles p ON p.user_id = u.id
      WHERE tp.tournament_id IN (${placeholders})
      ORDER BY tp.joined_at ASC
    `).all(...rows.map((r) => r.id)) as {
      tournament_id: number; user_id: number; display_name: string; avatar_emoji: string; username: string;
    }[];
    for (const p of joined) {
      const list = participants.get(p.tournament_id) ?? [];
      list.push({ user_id: p.user_id, display_name: p.display_name, avatar_emoji: p.avatar_emoji, username: p.username });
      participants.set(p.tournament_id, list);
    }
  }

  const tournaments = rows.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    status: publicStatus(t),
    time_control: t.time_control,
    bot_difficulty: t.bot_difficulty,
    participants: participantCount(t.id),
    players: participants.get(t.id) ?? [],
    created_at: t.created_at,
    approved_at: t.approved_at,
    started_at: t.started_at,
    finished_at: t.finished_at,
    winner_user_id: t.winner_user_id,
    link: `${base}/tournaments/join/${t.code}`,
  }));
  return c.json({ tournaments });
});

router.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  const tournament = createTournament({ ...parsed.data, created_by: c.get('user').id });
  const base = publicBaseUrl(c);
  return c.json({
    tournament: {
      id: tournament.id,
      code: tournament.code,
      name: tournament.name,
      status: tournament.status,
      link: `${base}/tournaments/join/${tournament.code}`,
    },
  });
});

/** The green light: the bracket is built and the players are notified. */
router.post('/:id/start', (c) => {
  const id = Number(c.req.param('id'));
  const result = startTournament(id, c.get('user').id);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 409;
    return c.json({ error: result.error }, status);
  }
  return c.json({ ok: true, rounds: result.rounds });
});

router.post('/:id/cancel', (c) => {
  const id = Number(c.req.param('id'));
  if (!cancelTournament(id)) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

/**
 * Freeze the tournament for a few days. Games in progress wait where they
 * are; nobody can join, start a game or move a piece until it resumes.
 */
router.post('/:id/pause', (c) => {
  const id = Number(c.req.param('id'));
  if (!pauseTournament(id)) return c.json({ error: 'cannot_pause' }, 409);
  return c.json({ ok: true });
});

router.post('/:id/resume', (c) => {
  const id = Number(c.req.param('id'));
  if (!resumeTournament(id)) return c.json({ error: 'cannot_resume' }, 409);
  return c.json({ ok: true });
});

/**
 * The admin decides a match that cannot be played — one player never turned
 * up. Same effect as a played game: the winner gets the point, the loser is
 * out, and the bracket moves on.
 */
router.post('/:id/matches/:matchId/resolve', async (c) => {
  const tournamentId = Number(c.req.param('id'));
  const matchId = Number(c.req.param('matchId'));
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ winner_user_id: z.number().int().positive() }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const match = db.prepare('SELECT tournament_id FROM tournament_matches WHERE id = ?').get(matchId) as { tournament_id: number } | undefined;
  if (!match || match.tournament_id !== tournamentId) return c.json({ error: 'not_found' }, 404);
  if (!resolveMatch(matchId, parsed.data.winner_user_id)) return c.json({ error: 'cannot_resolve' }, 409);
  return c.json({ ok: true });
});

/** The admin's view of one tournament: players and every match. */
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const tournament = getTournament(id);
  if (!tournament) return c.json({ error: 'not_found' }, 404);
  const players = listPlayers(id);
  const matches = listMatches(id);
  return c.json({
    tournament: {
      id: tournament.id,
      code: tournament.code,
      name: tournament.name,
      description: tournament.description,
      status: tournament.status,
      time_control: tournament.time_control,
      bot_difficulty: tournament.bot_difficulty,
      created_at: tournament.created_at,
      approved_at: tournament.approved_at,
      started_at: tournament.started_at,
      finished_at: tournament.finished_at,
      winner_user_id: tournament.winner_user_id,
      link: `${publicBaseUrl(c)}/tournaments/join/${tournament.code}`,
    },
    players,
    matches,
  });
});

export default router;
