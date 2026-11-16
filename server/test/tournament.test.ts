import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The engine opens the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-tournament-'));
process.env.DB_PATH = join(dir, 'tournament.db');

type EngineModule = typeof import('../src/tournament/engine.js');
type DbModule = typeof import('../src/db.js');
import type { TournamentRow } from '../src/tournament/engine.js';
let engine: EngineModule;
let db: DbModule['db'];

const ADMIN = 1;

function addUser(id: number, name: string, rating = 1200, timeClass = 'blitz') {
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`).run(id, name);
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (?, ?)`).run(id, name);
  db.prepare(`INSERT INTO ratings (user_id, time_class, rating, rd, games_played) VALUES (?, ?, ?, 200, 10)`)
    .run(id, timeClass, rating);
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  engine = await import('../src/tournament/engine.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, 'boss', 'x', 'admin')`).run(ADMIN);
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (?, 'Boss')`).run(ADMIN);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM tournament_matches');
  db.exec('DELETE FROM tournament_players');
  db.exec('DELETE FROM tournaments');
  db.exec('DELETE FROM games');
  db.exec('DELETE FROM ratings');
  db.exec('DELETE FROM profiles');
  db.exec('DELETE FROM users');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, 'boss', 'x', 'admin')`).run(ADMIN);
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (?, 'Boss')`).run(ADMIN);
});

function makeTournament(overrides: Partial<Parameters<EngineModule['createTournament']>[0]> = {}) {
  return engine.createTournament({ name: 'Family Cup', bot_difficulty: 'easy', time_control: 'blitz', ...overrides });
}

function joinTournament(t: TournamentRow, userId: number) {
  return engine.joinTournament(t.code, userId);
}

describe('tournament codes', () => {
  it('are ten characters without look-alikes and differ every time', () => {
    const codes = new Set(Array.from({ length: 200 }, () => engine.generateTournamentCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
  });

  it('survive dashes, spaces and lower case when typed back', () => {
    const code = engine.generateTournamentCode();
    expect(engine.normalizeTournamentCode(code.toLowerCase())).toBe(code);
    expect(engine.normalizeTournamentCode(`${code.slice(0, 5)} ${code.slice(5)}`)).toBe(code);
  });

  it('are ten characters — not the twelve of an account invite, so one can never be spent on a sign-up', () => {
    const t = makeTournament();
    expect(t.code).toHaveLength(10);
  });
});

describe('joining', () => {
  it('puts the player in and lets them in only once', () => {
    addUser(2, 'Anna');
    const t = makeTournament();
    expect(joinTournament(t, 2).ok).toBe(true);
    expect(engine.isParticipant(t.id, 2)).toBe(true);
    expect(joinTournament(t, 2).ok).toBe(true);
    expect(engine.participantCount(t.id)).toBe(1);
  });

  it('refuses an unknown code', () => {
    addUser(2, 'Anna');
    expect(engine.joinTournament('NOPENOPE', 2)).toEqual({ ok: false, error: 'not_found' });
  });

  it('refuses a tournament that already started', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2);
    joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    expect(joinTournament(t, 2)).toEqual({ ok: false, error: 'tournament_started' });
  });

  it('refuses a newcomer once the tournament has started', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Latecomer');
    const t = makeTournament();
    joinTournament(t, 2);
    joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);

    // The door closes when the bracket is built.
    expect(joinTournament(t, 4)).toEqual({ ok: false, error: 'tournament_started' });
    expect(engine.isParticipant(t.id, 4)).toBe(false);
  });

  it('says why the door is closed', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Latecomer');
    const t = makeTournament();
    joinTournament(t, 2);
    joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);

    // Finished and cancelled read differently from "started".
    db.prepare(`UPDATE tournaments SET status = 'finished' WHERE id = ?`).run(t.id);
    expect(joinTournament(t, 4)).toEqual({ ok: false, error: 'tournament_finished' });
    db.prepare(`UPDATE tournaments SET status = 'cancelled' WHERE id = ?`).run(t.id);
    expect(joinTournament(t, 4)).toEqual({ ok: false, error: 'tournament_cancelled' });
  });

  it('lets a player leave before the start', () => {
    addUser(2, 'Anna');
    const t = makeTournament();
    joinTournament(t, 2);
    expect(engine.leaveTournament(t.id, 2)).toBe(true);
    expect(engine.isParticipant(t.id, 2)).toBe(false);
  });
});

describe('starting', () => {
  it('needs players', () => {
    const t = makeTournament();
    expect(engine.startTournament(t.id, ADMIN)).toEqual({ ok: false, error: 'no_players' });
  });

  it('needs at least two — a knockout with one player is not a tournament', () => {
    addUser(2, 'Anna');
    const t = makeTournament();
    joinTournament(t, 2);
    expect(engine.startTournament(t.id, ADMIN)).toEqual({ ok: false, error: 'not_enough_players' });
    // The tournament stays open, so the second player can still arrive.
    expect(engine.getTournament(t.id)!.status).toBe('open');
  });

  it('seeds the players by rating and builds the first round', () => {
    addUser(2, 'Weak', 1000);
    addUser(3, 'Strong', 1600);
    addUser(4, 'Middle', 1300);
    addUser(5, 'Second', 1200);
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4); joinTournament(t, 5);

    expect(engine.startTournament(t.id, ADMIN)).toEqual({ ok: true, rounds: 1 });
    const players = engine.listPlayers(t.id);
    // Strongest first.
    expect(players.map((p) => p.user_id)).toEqual([3, 4, 5, 2]);

    const matches = engine.listMatches(t.id);
    expect(matches).toHaveLength(2);
    // The better seed of each pair takes White.
    expect(matches[0].white_user_id).toBe(3);
    expect(matches[0].black_user_id).toBe(4);
    expect(matches[1].white_user_id).toBe(5);
    expect(matches[1].black_user_id).toBe(2);
  });

  it('refuses to start twice', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    expect(engine.startTournament(t.id, ADMIN)).toEqual({ ok: false, error: 'already_started' });
  });
});

describe('the bracket', () => {
  it('gives the unpaired player the bot instead of a bye', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4);
    engine.startTournament(t.id, ADMIN);

    const matches = engine.listMatches(t.id);
    expect(matches).toHaveLength(2);
    const botMatch = matches.find((m) => m.white_is_bot === 1 || m.black_is_bot === 1)!;
    expect(botMatch).toBeDefined();
    // The bot takes one seat; the human is on the other.
    const humanId = botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id;
    expect([2, 3, 4]).toContain(humanId);
    // And the human-vs-human match is the other one.
    const humanMatch = matches.find((m) => m !== botMatch)!;
    expect(humanMatch.white_is_bot).toBe(0);
    expect(humanMatch.black_is_bot).toBe(0);
  });

  it('creates the game pair only when somebody opens the match', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);

    const match = engine.listMatches(t.id)[0];
    // Nothing played yet — no game rows, so no empty games in anybody's list.
    expect(db.prepare('SELECT COUNT(*) c FROM games').get()).toEqual({ c: 0 });

    const claimed = engine.claimMatch(match.id, 2)!;
    expect(claimed.game_id).toBeGreaterThan(0);
    expect(claimed.color).toBe('white');
    // Both players have their own row — the play socket needs one per side.
    const rows = db.prepare('SELECT user_id FROM games ORDER BY id').all() as { user_id: number }[];
    expect(rows.map((r) => r.user_id).sort()).toEqual([2, 3]);
  });

  it('hands the same game to the second player', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0];

    const first = engine.claimMatch(match.id, 2)!;
    const second = engine.claimMatch(match.id, 3)!;
    expect(second.game_id).not.toBe(first.game_id);
    expect(second.color).toBe('black');
    expect(db.prepare('SELECT COUNT(*) c FROM games').get()).toEqual({ c: 2 });
  });

  it('refuses a claim from somebody who is not in the match', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(9, 'Nosy');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0];
    expect(engine.claimMatch(match.id, 9)).toBeNull();
  });
});

describe('results', () => {
  function twoPlayerTournament() {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    return { t, match: engine.listMatches(t.id)[0]! };
  }

  it('gives the winner a point and knocks the loser out', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    addUser(5, 'Dan');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4); joinTournament(t, 5);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id).find((m) => m.white_is_bot === 0 && m.black_is_bot === 0)!;

    engine.reportMatchResult(match.id, '1-0');

    const players = engine.listPlayers(t.id);
    const winner = players.find((p) => p.user_id === match.white_user_id)!;
    const loser = players.find((p) => p.user_id === match.black_user_id)!;
    expect(winner.points).toBe(1);
    expect(winner.status).toBe('joined');
    expect(loser.points).toBe(0);
    expect(loser.status).toBe('eliminated');
  });

  it('never moves the Glicko rating', () => {
    const { match } = twoPlayerTournament();
    engine.claimMatch(match.id, 2);
    engine.claimMatch(match.id, 3);
    engine.reportMatchResult(match.id, '1-0');
    const row = db.prepare('SELECT rated FROM games LIMIT 1').get() as { rated: number };
    expect(row.rated).toBe(0);
  });

  it('replays a draw instead of eliminating anybody', () => {
    const { t, match } = twoPlayerTournament();
    engine.reportMatchResult(match.id, '1/2-1/2');

    const players = engine.listPlayers(t.id);
    expect(players.every((p) => p.status === 'joined')).toBe(true);
    expect(players.every((p) => p.points === 0)).toBe(true);
    // A fresh game was set up for the replay.
    expect(engine.listMatches(t.id)[0]!.status).toBe('active');
    expect(db.prepare('SELECT COUNT(*) c FROM games').get()).toEqual({ c: 2 });
  });

  it('is idempotent — the same result twice changes nothing', () => {
    const { t, match } = twoPlayerTournament();
    engine.reportMatchResult(match.id, '1-0');
    engine.reportMatchResult(match.id, '1-0');
    const players = engine.listPlayers(t.id);
    expect(players.reduce((sum, p) => sum + p.points, 0)).toBe(1);
  });

  it('advances the winner into the next round', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    addUser(5, 'Dan');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4); joinTournament(t, 5);
    engine.startTournament(t.id, ADMIN);

    const round1 = engine.listMatches(t.id);
    expect(round1).toHaveLength(2);
    for (const m of round1) {
      // The bot match is decided by the human, whoever that is.
      if (m.white_is_bot === 1 || m.black_is_bot === 1) {
        const humanId = m.white_is_bot === 1 ? m.black_user_id : m.white_user_id;
        engine.reportBotMatchResult(m.id, 'win');
      } else {
        engine.reportMatchResult(m.id, '1-0');
      }
    }

    const round2 = engine.listMatches(t.id).filter((m) => m.round === 2);
    expect(round2).toHaveLength(1);
    expect([2, 3, 4, 5]).toContain(round2[0]!.white_user_id);
    expect([2, 3, 4, 5]).toContain(round2[0]!.black_user_id);
  });

  it('crowns a champion when the last match is decided', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0]!;
    engine.reportMatchResult(match.id, '1-0');

    const tournament = engine.getTournament(t.id)!;
    expect(tournament.status).toBe('finished');
    expect(tournament.winner_user_id).toBe(match.white_user_id);
    const players = engine.listPlayers(t.id);
    expect(players.find((p) => p.user_id === match.white_user_id)!.status).toBe('champion');
  });
});

describe('the bot match', () => {
  function botTournament() {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4);
    engine.startTournament(t.id, ADMIN);
    const botMatch = engine.listMatches(t.id).find((m) => m.white_is_bot === 1 || m.black_is_bot === 1)!;
    return { t, botMatch };
  }

  it('always advances the human — the bot fills an empty seat, it does not beat anybody', () => {
    const { t, botMatch } = botTournament();
    engine.reportBotMatchResult(botMatch.id, 'loss');
    const humanId = botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id;
    const human = engine.listPlayers(t.id).find((p) => p.user_id === humanId)!;
    expect(human.status).toBe('joined');
    expect(human.points).toBe(0);
  });

  it('counts the result for the tournament points', () => {
    const { t, botMatch } = botTournament();
    engine.reportBotMatchResult(botMatch.id, 'win');
    const humanId = botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id;
    expect(engine.listPlayers(t.id).find((p) => p.user_id === humanId)!.points).toBe(1);
  });

  it('gives the client the admin\'s settings, not the client\'s', () => {
    const { botMatch } = botTournament();
    const humanId = (botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id)!;
    const settings = engine.tournamentBotMatchSettings(botMatch.id, humanId)!;
    expect(settings.difficulty).toBe('easy');
    expect(settings.timeControl).toBe('blitz');
    expect(settings.color).toBe(botMatch.white_is_bot === 1 ? 'black' : 'white');
    // Nobody else may open it.
    expect(engine.tournamentBotMatchSettings(botMatch.id, 999)).toBeNull();
  });
});

describe('recovery', () => {
  it('re-applies a result that was played but never made it into the bracket', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0]!;
    engine.claimMatch(match.id, 2);
    engine.claimMatch(match.id, 3);

    // The game ended, but the process died before the bracket heard about it.
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
    db.prepare(`UPDATE games SET result = 'win', end_time = datetime('now'), pgn = ? WHERE user_color = 'white'`).run(pgn);
    db.prepare(`UPDATE games SET result = 'loss', end_time = datetime('now'), pgn = ? WHERE user_color = 'black'`).run(pgn);
    expect(engine.listPlayers(t.id).every((p) => p.status === 'joined')).toBe(true);

    engine.recoverTournaments();
    const players = engine.listPlayers(t.id);
    expect(players.find((p) => p.user_id === match.white_user_id)!.points).toBe(1);
    expect(players.find((p) => p.user_id === match.black_user_id)!.status).toBe('eliminated');
  });

  it('leaves a finished match alone', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0]!;
    engine.reportMatchResult(match.id, '1-0');

    engine.recoverTournaments();
    expect(engine.listPlayers(t.id).reduce((sum, p) => sum + p.points, 0)).toBe(1);
  });

  it('re-applies a bot game that was played but never made it into the bracket', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4);
    engine.startTournament(t.id, ADMIN);
    const botMatch = engine.listMatches(t.id).find((m) => m.white_is_bot === 1 || m.black_is_bot === 1)!;
    const humanId = botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id;

    // The bot game ended and was saved, but the process died before the
    // bracket heard about it.
    db.prepare(
      `INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, end_time, user_color, rated, time_class, tournament_match_id)
       VALUES (?, 'tournament', 'local-1', '1. e4 e5 1-0', ?, 'Stockfish (easy)', 'win', '300+0', datetime('now'), 'white', 0, 'blitz', ?)`,
    ).run(humanId, 'Cleo', botMatch.id);

    engine.recoverTournaments();
    const human = engine.listPlayers(t.id).find((p) => p.user_id === humanId)!;
    expect(human.points).toBe(1);
    // And the bot never eliminated the human.
    expect(human.status).toBe('joined');
  });
});

describe('the general record', () => {
  it('leaves the bot game out and keeps the game between two people in', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(4, 'Cleo');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3); joinTournament(t, 4);
    engine.startTournament(t.id, ADMIN);

    const botMatch = engine.listMatches(t.id).find((m) => m.white_is_bot === 1 || m.black_is_bot === 1)!;
    const humanId = botMatch.white_is_bot === 1 ? botMatch.black_user_id : botMatch.white_user_id;
    // The bot game: one row, no human opponent.
    db.prepare(
      `INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, end_time, user_color, rated, time_class, tournament_match_id)
       VALUES (?, 'tournament', 'local-1', '1. e4 e5 1-0', ?, 'Stockfish (easy)', 'win', '300+0', datetime('now'), 'white', 0, 'blitz', ?)`,
    ).run(humanId, 'Cleo', botMatch.id);

    const humanMatch = engine.listMatches(t.id).find((m) => m !== botMatch)!;
    engine.claimMatch(humanMatch.id, humanMatch.white_user_id!);
    engine.claimMatch(humanMatch.id, humanMatch.black_user_id!);
    // The play socket writes the result into the games rows; the bracket
    // follows. Here the result is set directly, which is what the socket does.
    db.prepare(
      `UPDATE games SET result = 'win', end_time = datetime('now') WHERE tournament_match_id = ? AND user_color = 'white'`,
    ).run(humanMatch.id);
    db.prepare(
      `UPDATE games SET result = 'loss', end_time = datetime('now') WHERE tournament_match_id = ? AND user_color = 'black'`,
    ).run(humanMatch.id);
    engine.reportMatchResult(humanMatch.id, '1-0');

    // The stats query: the bot game is out, the game between two people is in.
    const counted = db.prepare(`
      SELECT COUNT(*) c FROM games
      WHERE user_id = ? AND result IS NOT NULL
        AND NOT (source = 'tournament' AND opponent_user_id IS NULL)
    `).get(humanMatch.white_user_id) as { c: number };
    expect(counted.c).toBe(1);

    const botCounted = db.prepare(`
      SELECT COUNT(*) c FROM games
      WHERE user_id = ? AND result IS NOT NULL
        AND NOT (source = 'tournament' AND opponent_user_id IS NULL)
    `).get(humanId) as { c: number };
    expect(botCounted.c).toBe(0);
  });
});

describe('the admin deciding a match', () => {
  it('awards the point and knocks the other player out', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0]!;

    expect(engine.resolveMatch(match.id, match.black_user_id!)).toBe(true);
    const players = engine.listPlayers(t.id);
    expect(players.find((p) => p.user_id === match.black_user_id)!.points).toBe(1);
    expect(players.find((p) => p.user_id === match.white_user_id)!.status).toBe('eliminated');
  });

  it('refuses a winner who is not in the match', () => {
    addUser(2, 'Anna');
    addUser(3, 'Ben');
    addUser(9, 'Nosy');
    const t = makeTournament();
    joinTournament(t, 2); joinTournament(t, 3);
    engine.startTournament(t.id, ADMIN);
    const match = engine.listMatches(t.id)[0]!;
    expect(engine.resolveMatch(match.id, 9)).toBe(false);
  });
});
