// Arena API — player-facing endpoints for open PvP matchmaking
//
// Arenas are always running: players join and play immediately. Only admins
// can create arenas. Points are 2/1/0 (win/draw/loss).

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import {
  createArena,
  startArena,
  closeArena,
  pauseArena,
  resumeArena,
  getArena,
  getArenaByCode,
  listArenas,
  participantCount,
  joinArena,
  leaveArena,
  listFreePlayers,
  createMatch,
  getMatch,
  listMatches,
  reportMatchResult,
  listPlayers,
  summarize,
  type ArenaRow,
  type ArenaMatchRow,
} from '../arena/engine.js';

const router = new Hono();

// ---- public: list arenas ----

router.get('/', (c) => {
  const arenas = listArenas();
  return c.json({ arenas: arenas.map(summarize) });
});

// ---- public: arena landing ----

router.get('/code/:code', (c) => {
  const arena = getArenaByCode(c.req.param('code'));
  if (!arena) return c.json({ error: 'not_found' }, 404);
  return c.json({ arena: summarize(arena) });
});

// ---- admin: create/manage arenas ----

router.post('/', requireAdmin, async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    name: z.string(),
    description: z.string().optional(),
    time_control: z.string().default('blitz'),
    bot_difficulty: z.string().default('medium'),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const arena = createArena(
    parsed.data.name,
    parsed.data.description ?? null,
    parsed.data.time_control,
    parsed.data.bot_difficulty,
    me.id,
  );
  return c.json({ arena: summarize(arena) });
});

router.post('/:id/start', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!startArena(id)) return c.json({ error: 'cannot_start' }, 409);
  const arena = getArena(id)!;
  return c.json({ arena: summarize(arena) });
});

router.post('/:id/close', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!closeArena(id)) return c.json({ error: 'cannot_close' }, 409);
  const arena = getArena(id)!;
  return c.json({ arena: summarize(arena) });
});

router.post('/:id/pause', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!pauseArena(id)) return c.json({ error: 'cannot_pause' }, 409);
  const arena = getArena(id)!;
  return c.json({ arena: summarize(arena) });
});

router.post('/:id/resume', requireAdmin, (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!resumeArena(id)) return c.json({ error: 'cannot_resume' }, 409);
  const arena = getArena(id)!;
  return c.json({ arena: summarize(arena) });
});

// ---- player: list/join arenas ----

router.get('/', requireAuth, (c) => {
  const rows = listArenas();
  const arenas = rows.map((a) => ({
    ...summarize(a),
    joined: false, // will be set per-user
  }));
  return c.json({ arenas });
});

router.post('/code/:code/join', requireAuth, async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({}).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const result = joinArena(c.req.param('code'), me.id);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 409;
    return c.json({ error: result.error }, status);
  }
  return c.json({ arena: summarize(result.arena) });
});

router.post('/:id/leave', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);
  if (!leaveArena(id, me.id)) return c.json({ error: 'cannot_leave' }, 409);
  return c.json({ ok: true });
});

// ---- player: my arena info ----

router.get('/:id', requireAuth, (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);

  const arena = getArena(id);
  if (!arena) return c.json({ error: 'not_found' }, 404);

  const players = listPlayers(id).map((p) => {
    const row = db.prepare(
      'SELECT p.display_name, p.avatar_emoji, u.username FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?',
    ).get(p.user_id) as { display_name: string; avatar_emoji: string; username: string } | undefined;
    return {
      user_id: p.user_id,
      display_name: row?.display_name ?? `#${p.user_id}`,
      avatar_emoji: row?.avatar_emoji ?? '♟',
      username: row?.username ?? '',
      points: p.points,
      status: p.status,
    };
  });

  const matches = listMatches(id).map((m) => shapeMatch(m, me.id));

  return c.json({
    arena: summarize(arena),
    players,
    matches,
  });
});

// ---- matchmaking: claim a match ----

router.post('/matches/claim', requireAuth, async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    arena_id: z.number().int().positive(),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const arenaId = parsed.data.arena_id;
  const arena = getArena(arenaId);
  if (!arena || arena.status !== 'running') {
    return c.json({ error: 'arena_not_running' }, 409);
  }

  // Find another free player or create bot match
  const freePlayers = listFreePlayers(arenaId);
  
  // Remove current user from list if present
  const otherPlayers = freePlayers.filter(p => p.user_id !== me.id);
  
  let whiteUserId: number | null = null;
  let blackUserId: number | null = null;

  if (otherPlayers.length > 0) {
    // Pair with another human
    const opponent = otherPlayers[0];
    whiteUserId = me.id;
    blackUserId = opponent.user_id;
  } else {
    // No other players: play against bot
    whiteUserId = me.id;
    blackUserId = null; // bot seat
  }

  const match = createMatch(arenaId, whiteUserId, blackUserId);
  if (!match) {
    return c.json({ error: 'cannot_create_match' }, 500);
  }

  return c.json({ match: shapeMatch(match, me.id) });
});

// ---- game result reporting ----

router.post('/matches/:id/report', requireAuth, async (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({
    result: z.enum(['1-0', '0-1', '1/2-1/2']),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const match = getMatch(id);
  if (!match) return c.json({ error: 'not_found' }, 404);
  if (match.white_user_id !== me.id && match.black_user_id !== me.id) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const winnerId = parsed.data.result === '1-0' ? match.white_user_id : 
                   parsed.data.result === '0-1' ? match.black_user_id : null;

  if (!reportMatchResult(id, parsed.data.result, winnerId)) {
    return c.json({ error: 'cannot_report' }, 500);
  }

  return c.json({ ok: true });
});

// ---- shaping ----

function shapeMatch(m: ArenaMatchRow, viewerId: number) {
  const side = (userId: number | null, isBot: number) => {
    if (isBot) {
      return { user_id: null, display_name: 'Stockfish', avatar_emoji: '🤖', is_bot: true };
    }
    if (userId === null) return null;
    const row = db.prepare(
      'SELECT p.display_name, p.avatar_emoji FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?',
    ).get(userId) as { display_name: string; avatar_emoji: string } | undefined;
    return {
      user_id: userId,
      display_name: row?.display_name ?? `#${userId}`,
      avatar_emoji: row?.avatar_emoji ?? '♟',
      is_bot: false,
    };
  };

  const gameId = m.game_external_id ? (db.prepare('SELECT id FROM games WHERE external_id = ? AND user_id = ?')
    .get(m.game_external_id, viewerId) as { id: number } | undefined)?.id ?? null : null;

  return {
    id: m.id,
    white: side(m.white_user_id, m.white_is_bot),
    black: side(m.black_user_id, m.black_is_bot),
    result: m.result,
    status: m.status,
    game_id: gameId,
    my_color: m.white_user_id === viewerId ? 'white' : m.black_user_id === viewerId ? 'black' : null,
  };
}

export default router;
