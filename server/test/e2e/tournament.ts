// End-to-end drive of a tournament against a real server on a throwaway
// database. Not part of `npm test` — it binds a port and starts the whole
// server — run it with `npm run test:tournament`. It proves the whole flow:
// the admin creates a tournament and shares a link, the players join by link,
// the admin's go-ahead builds the bracket, a played game moves the bracket on,
// and the odd player out meets the bot instead of sitting the round out.

import WebSocket from 'ws';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8907);
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
const dbPath = process.env.DB_PATH ?? join(tmpdir(), `patzer-tournament-e2e-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ } }

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

async function api(
  path: string,
  body?: unknown,
  cookie?: string,
  method: string = body === undefined ? 'GET' : 'POST',
): Promise<{ status: number; json: any; cookie?: string }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : undefined };
}

class Client {
  msgs: any[] = [];
  ws: WebSocket;
  constructor(gameId: number, cookie: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/play?game=${gameId}`, { headers: { Cookie: cookie } });
    this.ws.on('message', (raw) => this.msgs.push(JSON.parse(raw.toString())));
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(type: string, extra: Record<string, unknown> = {}) { this.ws.send(JSON.stringify({ type, ...extra })); }
  async wait(type: string, timeoutMs = 4000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const i = this.msgs.findIndex((m) => m.type === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(25);
    }
    throw new Error(`timeout waiting for ${type}; have ${JSON.stringify(this.msgs)}`);
  }
  close() { this.ws.close(); }
}

async function main() {
  // Importing the server module starts it (it listens on PORT).
  await import('../../src/index.js');
  await sleep(1200);

  console.log('setup: an admin and three players');
  const admin = await api('/api/setup/init', { username: 'boss', password: 'bosspassword12', display_name: 'Boss' });
  check(admin.status === 200 && !!admin.cookie, 'the first account is the admin');
  const adminCookie = admin.cookie!;

  async function player(name: string) {
    const created = await api('/api/admin/users', { username: name, password: 'playpassword12', display_name: name }, adminCookie);
    check(created.status === 200, `${name} created`);
    const login = await api('/api/auth/login', { username: name, password: 'playpassword12' });
    return { id: created.json.id as number, cookie: login.cookie! };
  }

  const anna = await player('anna');
  const ben = await player('ben');
  const cleo = await player('cleo');

  console.log('the admin creates a tournament and shares the link');
  const created = await api('/api/admin/tournaments', {
    name: 'Family Cup',
    description: 'Sunday afternoon',
    time_control: 'blitz',
    bot_difficulty: 'easy',
  }, adminCookie);
  check(created.status === 200, 'the tournament is created');
  const code = created.json.tournament.code as string;
  const link = created.json.tournament.link as string;
  check(link.endsWith(`/tournaments/join/${code}`), `the link carries the code (${link})`);

  console.log('the players join by link');
  const publicView = await api(`/api/tournaments/code/${code}`);
  check(publicView.status === 200 && publicView.json.tournament.name === 'Family Cup',
    'a guest opening the link sees what the tournament is');

  for (const p of [anna, ben, cleo]) {
    const joined = await api(`/api/tournaments/code/${code}/join`, {}, p.cookie);
    check(joined.status === 200, 'a player joined');
  }
  const listed = await api('/api/tournaments', undefined, anna.cookie);
  check(listed.json.tournaments.some((t: any) => t.code === code && t.joined), 'the tournament shows up in the player\'s list');

  console.log('nothing happens before the admin says so');
  const beforeStart = await api(`/api/tournaments/${created.json.tournament.id}`, undefined, anna.cookie);
  check(beforeStart.json.rounds.length === 0, 'there is no bracket yet');
  check(beforeStart.json.tournament.status === 'open', 'the tournament is waiting for the start');

  console.log('the admin gives the go-ahead');
  const started = await api(`/api/admin/tournaments/${created.json.tournament.id}/start`, {}, adminCookie);
  check(started.status === 200, 'the tournament started');

  const detail = await api(`/api/tournaments/${created.json.tournament.id}`, undefined, anna.cookie);
  check(detail.json.tournament.status === 'running', 'it is running');
  const matches = detail.json.rounds.flatMap((r: any) => r.matches);
  check(matches.length === 2, `two matches for three players (got ${matches.length})`);
  const botMatch = matches.find((m: any) => m.is_bot_match);
  const humanMatch = matches.find((m: any) => !m.is_bot_match);
  check(!!botMatch, 'the unpaired player got the bot instead of a bye');
  check(!!humanMatch, 'the other two play each other');

  console.log('the two humans play their match');
  const claimA = await api(`/api/tournaments/matches/${humanMatch.id}/claim`, {}, anna.cookie);
  const claimB = await api(`/api/tournaments/matches/${humanMatch.id}/claim`, {}, ben.cookie);
  check(claimA.status === 200 && claimB.status === 200, 'both players got their game');

  const A = new Client(claimA.json.match.game_id, anna.cookie);
  const B = new Client(claimB.json.match.game_id, ben.cookie);
  await Promise.all([A.open(), B.open()]);
  const helloA = await A.wait('pvp_hello');
  const helloB = await B.wait('pvp_hello');
  check(helloA.your_color !== helloB.your_color, 'the players got different colours');

  A.send('move', { uci: 'e2e4' }); await B.wait('move_made');
  B.send('move', { uci: 'e7e5' }); await A.wait('move_made');
  A.send('resign');
  await A.wait('game_over');
  await B.wait('game_over');
  await sleep(400);

  const afterGame = await api(`/api/tournaments/${created.json.tournament.id}`, undefined, anna.cookie);
  const afterMatches = afterGame.json.rounds.flatMap((r: any) => r.matches);
  const decided = afterMatches.find((m: any) => m.id === humanMatch.id);
  check(decided.status === 'finished', 'the match is decided');
  const standings = afterGame.json.players as any[];
  check(standings.some((p: any) => p.status === 'eliminated'), 'the loser is out');
  check(standings.some((p: any) => p.points === 2), 'the winner has two points');

  console.log('the bot match');
  // The player who is not in the human-vs-human match sits the bot one.
  const humanIds = [humanMatch.white?.user_id, humanMatch.black?.user_id];
  const botPlayerId = [anna.id, ben.id, cleo.id].find((id) => !humanIds.includes(id))!;
  const botPlayerCookie = [anna, ben, cleo].find((p) => p.id === botPlayerId)!.cookie;

  const botInfo = await api(`/api/tournaments/matches/${botMatch.id}/info`, undefined, botPlayerCookie);
  check(botInfo.status === 200, 'the bot player gets the settings');
  check(botInfo.json.difficulty === 'easy', 'the admin\'s difficulty is used');
  check(botInfo.json.time_control === 'blitz', 'the tournament clock is used');

  const outsider = await api(`/api/tournaments/matches/${botMatch.id}/info`, undefined, anna.cookie);
  check(outsider.status === 403, 'a player who is not in the bot match cannot open it');

  const detail2 = await api(`/api/tournaments/${created.json.tournament.id}`, undefined, anna.cookie);
  check(detail2.json.players.length === 3, 'everybody is on the score table');

  console.log(failures === 0 ? '\nAll tournament checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
