// End-to-end: a tournament survives the server going away.
//
// This is the promise the feature makes — "the actual data is saved somewhere,
// so if something goes wrong everything can be restored". The only honest way
// to prove it is to kill the server between two rounds and start it again.
//
// Run it with `npm run test:tournament-restart`.

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT ?? 8913);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = join(tmpdir(), `patzer-tournament-restart-${process.pid}.db`);
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

/** Is something listening on our port? */
async function portBusy(): Promise<boolean> {
  try {
    await fetch(`${BASE}/api/health`);
    return true;
  } catch {
    return false;
  }
}

/** Wait until the port is free — a server from an earlier run may still hold it. */
async function waitForFreePort(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (!(await portBusy())) return;
    await sleep(200);
  }
  throw new Error(`port ${PORT} is still busy`);
}

/**
 * Start the server as its own process, so it can be killed and restarted.
 *
 * It runs in its own process group: `npx` spawns tsx, which spawns node — and
 * killing only the npx wrapper would leave the server holding the port.
 */
async function startServer(): Promise<ChildProcess> {
  await waitForFreePort();
  const child = spawn('npx', ['tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: dbPath },
    stdio: 'ignore',
    detached: true,
  });
  // Wait for it to answer.
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  stopServer(child);
  throw new Error('the server did not come up');
}

async function stopServer(child: ChildProcess): Promise<void> {
  // Kill the whole group, so no tsx/node grandchild keeps the port.
  try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  for (let i = 0; i < 50; i++) {
    if (!(await portBusy())) return;
    await sleep(100);
  }
}

/** A client on the play socket, so a real game can be played. */
class Client {
  msgs: any[] = [];
  ws: WebSocket;
  constructor(gameId: number, cookie: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/play?game=${gameId}`, { headers: { Cookie: cookie } });
    this.ws.on('message', (raw) => this.msgs.push(JSON.parse(raw.toString())));
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(type: string, extra: Record<string, unknown> = {}) { this.ws.send(JSON.stringify({ type, ...extra })); }
  async wait(type: string, timeoutMs = 5000): Promise<any> {
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
  console.log('first run: the admin, two players and a tournament');
  let server = await startServer();

  const admin = await api('/api/setup/init', { username: 'boss', password: 'bosspassword12', display_name: 'Boss' });
  check(admin.status === 200, 'the first account is the admin');
  const adminCookie = admin.cookie!;

  async function player(name: string) {
    await api('/api/admin/users', { username: name, password: 'playpassword12', display_name: name }, adminCookie);
    const login = await api('/api/auth/login', { username: name, password: 'playpassword12' });
    return { id: (login.json as any)?.user?.id as number, cookie: login.cookie! };
  }

  const anna = await player('anna');
  const ben = await player('ben');

  const created = await api('/api/admin/tournaments', {
    name: 'Family Cup', time_control: 'blitz', bot_difficulty: 'easy',
  }, adminCookie);
  check(created.status === 200, 'the tournament is created');
  const code = created.json.tournament.code as string;
  const id = created.json.tournament.id as number;

  await api(`/api/tournaments/code/${code}/join`, {}, anna.cookie);
  await api(`/api/tournaments/code/${code}/join`, {}, ben.cookie);
  await api(`/api/admin/tournaments/${id}/start`, {}, adminCookie);

  const before = await api(`/api/tournaments/${id}`, undefined, anna.cookie);
  check(before.json.tournament.status === 'running', 'the tournament is running');
  check(before.json.rounds.length === 1, 'the first round exists');
  const match = before.json.rounds[0].matches[0];

  console.log('the players open their game');
  const claimA = await api(`/api/tournaments/matches/${match.id}/claim`, {}, anna.cookie);
  const claimB = await api(`/api/tournaments/matches/${match.id}/claim`, {}, ben.cookie);
  check(claimA.status === 200 && claimB.status === 200, 'both got their game');

  console.log('they play it, and one of them resigns');
  const A = new Client(claimA.json.match.game_id, anna.cookie);
  const B = new Client(claimB.json.match.game_id, ben.cookie);
  await Promise.all([A.open(), B.open()]);
  const helloA = await A.wait('pvp_hello');
  await B.wait('pvp_hello');
  A.send('move', { uci: 'e2e4' }); await B.wait('move_made');
  B.send('move', { uci: 'e7e5' }); await A.wait('move_made');
  // Ben resigns — the result is written to the games rows.
  B.send('resign');
  await B.wait('game_over');
  await A.wait('game_over');
  A.close(); B.close();
  await sleep(300);

  console.log('the server goes away mid-tournament');
  await stopServer(server);

  console.log('and comes back');
  server = await startServer();

  const after = await api(`/api/tournaments/${id}`, undefined, anna.cookie);
  check(after.status === 200, 'the tournament is still there');
  // Two players means one match — which is the final, so the tournament is
  // over rather than running. Either way it is not stuck.
  check(['running', 'finished'].includes(after.json.tournament.status), 'it is still going or finished');
  check(after.json.players.length === 2, 'both players are still in it');
  check(after.json.rounds.length === 1, 'the round is still there');
  const matchAfter = after.json.rounds[0].matches[0];
  check(matchAfter.id === match.id, 'the same match');
  check(matchAfter.white?.display_name && matchAfter.black?.display_name, 'both sides are still named');

  console.log('the result of the played game survived too');
  // Ben resigned, so Anna won. The bracket knows.
  const annaId = anna.id;
  const winner = after.json.players.find((p: any) => p.user_id === annaId);
  const loser = after.json.players.find((p: any) => p.user_id !== annaId);
  check(winner?.points === 1, 'the winner kept their point');
  check(loser?.status === 'eliminated', 'the loser is out');
  check(matchAfter.status === 'finished', 'the match is decided');

  console.log('a tournament that never got a decision can still be finished by the admin');
  const second = await api('/api/admin/tournaments', { name: 'Second Cup', time_control: 'blitz' }, adminCookie);
  const secondId = second.json.tournament.id as number;
  await api(`/api/tournaments/code/${second.json.tournament.code}/join`, {}, anna.cookie);
  await api(`/api/tournaments/code/${second.json.tournament.code}/join`, {}, ben.cookie);
  await api(`/api/admin/tournaments/${secondId}/start`, {}, adminCookie);
  const secondBefore = await api(`/api/tournaments/${secondId}`, undefined, anna.cookie);
  const secondMatch = secondBefore.json.rounds[0].matches[0];
  const decided = await api(`/api/admin/tournaments/${secondId}/matches/${secondMatch.id}/resolve`, {
    winner_user_id: secondMatch.white?.user_id,
  }, adminCookie);
  check(decided.status === 200, 'the admin decides the match');

  const finished = await api(`/api/tournaments/${secondId}`, undefined, anna.cookie);
  check(finished.json.tournament.status === 'finished', 'the tournament is finished');
  check(finished.json.tournament.winner_user_id === secondMatch.white?.user_id, 'the winner is recorded');
  const champion = finished.json.players.find((p: any) => p.user_id === secondMatch.white?.user_id);
  check(champion?.points === 1 && champion?.status === 'champion', 'the champion has the point and the crown');

  await stopServer(server);

  console.log(failures === 0 ? '\nAll restart checks passed.' : `\n${failures} check(s) failed.`);
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ } }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
