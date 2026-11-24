// The tournament itself: the bracket (rounds × matches), the standings table
// and — for the players involved — the game to play right now.
//
// The bracket is read from the server, which owns it. The page polls while
// the tournament runs, because the bracket moves on when somebody finishes a
// game — possibly in another tab, possibly on another device.

import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, Users, Clock, Bot, Play, ArrowLeft, Swords, Flag, UserPlus, Lock, Pause } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useLobby } from '../state/lobby';
import { humanizeError } from '../lib/errors';
import { cn } from '../lib/utils';
import type { TournamentDetail, TournamentMatch, TournamentPlayer, TournamentRound } from '../types';

export default function Tournament() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const lobby = useLobby();
  const [error, setError] = useState('');
  const [busyMatch, setBusyMatch] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api.get<TournamentDetail>(`/api/tournaments/${id}`),
    enabled: !!id,
    // The bracket moves on when somebody finishes a game — poll while it runs.
    refetchInterval: (q) => {
      const st = q.state.data?.tournament.status;
      return st === 'running' ? 4000 : 15_000;
    },
  });

  // The lobby pushes a message when a player's match is created. Refetch
  // straight away instead of waiting for the next poll.
  useEffect(() => {
    const unsub = lobby.onTournamentChange(() => {
      void qc.invalidateQueries({ queryKey: ['tournament', id] });
    });
    return unsub;
  }, [lobby, qc, id]);

  const tournament = data?.tournament;
  const rounds = data?.rounds ?? [];
  const players = data?.players ?? [];
  const myMatches = data?.my_matches ?? [];
  // Is the viewer one of the participants? A player who is not in the
  // tournament may still join it — while the admin has not started it.
  const joined = !!user && players.some((p) => p.user_id === user.id);
  // A paused tournament is frozen — nobody plays in it until the admin resumes.
  const paused = tournament?.status === 'paused';

  const liveMatch = useMemo(
    () => myMatches.find((m) => m.status !== 'finished') ?? null,
    [myMatches],
  );

  const claim = useMutation({
    mutationFn: (matchId: number) =>
      api.post<{ match: { game_id: number } }>(`/api/tournaments/matches/${matchId}/claim`),
    onSuccess: (r) => nav(`/play?game=${r.match.game_id}`),
    onError: (e) => { setError(humanizeError(e, t)); setBusyMatch(null); },
  });

  const join = useMutation({
    mutationFn: () => api.post(`/api/tournaments/${id}/join`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tournament', id] }),
    onError: (e) => setError(humanizeError(e, t)),
  });
  const joining = join.isPending;

  async function playHuman(m: TournamentMatch) {
    setBusyMatch(m.id);
    setError('');
    // The game row is created on the first claim — a pairing nobody has
    // touched yet stays out of the game list.
    if (m.game_id) { nav(`/play?game=${m.game_id}`); return; }
    claim.mutate(m.id);
  }

  async function playBot(m: TournamentMatch) {
    // The bot game runs on the ordinary bot socket; the match id tells the
    // server which difficulty and colour to use.
    nav(`/play?tournament=${m.id}`);
  }

  if (isLoading) {
    return <p className="py-16 text-center text-sm text-chesscom-500">{t('common.loading')}</p>;
  }
  if (isError || !tournament) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold">{t('tournament.notFound')}</h1>
        <Link to="/tournaments" className="btn-secondary mt-4">{t('tournament.backToList')}</Link>
      </div>
    );
  }

  const champion = players.find((p) => p.status === 'champion');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <Link to="/tournaments" className="mb-1 inline-flex items-center gap-1 text-xs text-chesscom-500 hover:underline">
            <ArrowLeft className="h-3 w-3" /> {t('tournament.backToList')}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-chesscom-900 dark:text-chesscom-100">
            {tournament.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-chesscom-500">
            <span className={cn('badge', STATUS_BADGE[tournament.status])}>{t(`tournament.status.${tournament.status}`)}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {t('tournament.players', { count: tournament.participants })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {t(`play.tc.${tournament.time_control}`, { defaultValue: tournament.time_control })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bot className="h-3.5 w-3.5" />
              {t(`play.diff.${tournament.bot_difficulty}`, { defaultValue: tournament.bot_difficulty })}
            </span>
          </div>
        </div>
        {champion && (
          <div className="flex items-center gap-2 rounded-xl bg-gold-500/15 px-3 py-2 text-sm font-semibold text-gold-700 dark:text-gold-300">
            <Trophy className="h-4 w-4" />
            {t('tournament.champion', { name: champion.display_name })}
          </div>
        )}
      </motion.header>

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {/* Still open: the admin has not started it yet. People can still join —
          until the moment the bracket is built. */}
      {tournament.status === 'open' && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600">
            <UserPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t('tournament.waitingForAdminTitle')}</div>
            <div className="text-xs text-chesscom-500">
              {joined ? t('tournament.youAreIn') : t('tournament.waitingForAdmin')}
            </div>
          </div>
          {!joined && (
            <button onClick={() => join.mutate()} disabled={joining} className="btn-primary shrink-0">
              <UserPlus className="h-4 w-4" /> {joining ? t('tournament.joining') : t('tournament.join')}
            </button>
          )}
        </div>
      )}

      {/* Paused: the tournament stands still between the sittings. */}
      {tournament.status === 'paused' && (
        <div className="card flex items-start gap-3 border-amber-500/40 p-4">
          <Pause className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="text-sm font-semibold">{t('tournament.paused')}</div>
            <div className="text-xs text-chesscom-500">{t('tournament.pausedNotice')}</div>
          </div>
        </div>
      )}

      {/* Started: the seats are taken, a newcomer cannot join any more. */}
      {tournament.status !== 'open' && tournament.status !== 'paused' && !joined && (
        <div className="card flex items-start gap-3 p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-chesscom-400" />
          <div>
            <div className="text-sm font-semibold">{t('tournament.closedTitle')}</div>
            <div className="text-xs text-chesscom-500">{t('tournament.closedToNewcomers')}</div>
          </div>
        </div>
      )}

      {/* Your match */}
      {liveMatch && (
        <div className="card flex flex-wrap items-center gap-3 border-board-dark/30 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark">
            <Swords className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t('tournament.yourMatch')}</div>
            <div className="text-xs text-chesscom-500">
              {t('tournament.round', { round: liveMatch.round })}
              {liveMatch.is_bot_match
                ? ` · ${t('tournament.versusBot')}`
                : ` · ${liveMatch.white?.display_name ?? '—'} – ${liveMatch.black?.display_name ?? '—'}`}
            </div>
          </div>
          <button
            onClick={() => (liveMatch.is_bot_match ? playBot(liveMatch) : playHuman(liveMatch))}
            disabled={busyMatch === liveMatch.id || paused}
            className="btn-primary shrink-0"
            title={paused ? t('tournament.pausedBanner') : undefined}
          >
            <Play className="h-4 w-4" /> {paused ? t('tournament.paused') : t('tournament.play')}
          </button>
        </div>
      )}

      {/* The bracket: rounds as columns, pairs joined by the lines that show
          who plays whom and who moves on. */}
      {rounds.length === 0 ? (
        <p className="card p-8 text-center text-sm text-chesscom-500">{t('tournament.bracketEmpty')}</p>
      ) : (
        <Bracket
          rounds={rounds}
          champion={champion}
          viewerId={user?.id ?? 0}
          onPlay={playHuman}
          onPlayBot={playBot}
          busy={busyMatch}
          paused={paused}
        />
      )}

      {/* Standings */}
      {players.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-chesscom-500">
            {t('tournament.standings')}
          </h2>
          <Standings players={players} />
        </section>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-accent-100 text-accent-700',
  running: 'bg-green-500/15 text-green-600',
  paused: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  finished: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
  cancelled: 'bg-bad/10 text-bad',
};

// ---- bracket geometry ----
//
// One number drives the whole picture: every first-round pairing takes a slot
// of SLOT pixels, and every later pairing sits exactly halfway between the two
// pairings whose winners meet in it. That is what makes the bracket read as a
// tree — the lines between the columns are drawn from the same coordinates.
const CARD_W = 240;
const CARD_H = 72;
const ROW_GAP = 14;
const SLOT = CARD_H + ROW_GAP;
const COL_GAP = 72; // room between two columns for the connector lines
const HEADER_H = 24;

const colX = (col: number) => col * (CARD_W + COL_GAP);

/** One positioned pairing: which match, which column, which vertical centre. */
interface BracketNode {
  m: TournamentMatch;
  col: number;
  y: number;
}

/**
 * Places every pairing on the canvas. Round 1 stacks its pairings down the
 * page; a pairing of a later round is centred on the two earlier pairings it
 * is fed by (match j of round i takes the winners of matches 2j and 2j+1 of
 * round i-1 — the server pairs the survivors in seed order, which is exactly
 * that order).
 */
function layoutBracket(rounds: TournamentRound[]): BracketNode[][] {
  let prevCenters: number[] = [];
  return rounds.map((r, col) => {
    const nodes = r.matches.map((m, j) => {
      let y: number;
      if (col === 0) {
        y = j * SLOT + CARD_H / 2;
      } else {
        const feeders = [prevCenters[j * 2], prevCenters[j * 2 + 1]].filter((v): v is number => v !== undefined);
        // The last pairing of an odd round hangs on its single feeder (the
        // other seat belongs to the bot).
        y = feeders.length > 0
          ? feeders.reduce((sum, v) => sum + v, 0) / feeders.length
          : (j + 0.5) * SLOT * 2 ** col;
      }
      return { m, col, y };
    });
    prevCenters = nodes.map((n) => n.y);
    return nodes;
  });
}

/** The elbow lines from a pairing to the pairing that follows it. */
function connectorPaths(cols: BracketNode[][]): string[] {
  const paths: string[] = [];
  for (let col = 1; col < cols.length; col++) {
    const prev = cols[col - 1]!;
    for (const [j, node] of cols[col]!.entries()) {
      for (const feeder of [prev[j * 2], prev[j * 2 + 1]]) {
        if (!feeder) continue;
        const x1 = colX(col - 1) + CARD_W;
        const x2 = colX(col);
        const mid = x1 + COL_GAP / 2;
        paths.push(`M ${x1} ${feeder.y} H ${mid} V ${node.y} H ${x2}`);
      }
    }
  }
  return paths;
}

function Bracket({
  rounds, champion, viewerId, onPlay, onPlayBot, busy, paused,
}: {
  rounds: TournamentRound[];
  champion: TournamentPlayer | undefined;
  viewerId: number;
  onPlay: (m: TournamentMatch) => void;
  onPlayBot: (m: TournamentMatch) => void;
  busy: number | null;
  paused: boolean;
}) {
  const { t } = useTranslation();
  const cols = useMemo(() => layoutBracket(rounds), [rounds]);
  const paths = useMemo(() => connectorPaths(cols), [cols]);
  const champX = colX(rounds.length);
  const last = cols[cols.length - 1]?.[0];
  const width = (champion && last ? champX + CARD_W : colX(rounds.length - 1) + CARD_W);
  const height = Math.max(
    SLOT,
    ...cols.flat().map((n) => n.y + CARD_H / 2),
    champion && last ? last.y + CARD_H / 2 : 0,
  );

  return (
    <section className="space-y-2">
      {/* Round titles sit above their own column. */}
      <div className="relative overflow-x-auto pb-1">
        <div className="relative" style={{ width, height: HEADER_H }}>
          {rounds.map((r, col) => (
            <h2
              key={r.round}
              className="absolute top-0 text-xs font-semibold uppercase tracking-wide text-chesscom-500"
              style={{ left: colX(col), width: CARD_W }}
            >
              {t('tournament.round', { round: r.round })}
            </h2>
          ))}
          {champion && last && (
            <h2
              className="absolute top-0 text-xs font-semibold uppercase tracking-wide text-gold-600"
              style={{ left: champX, width: CARD_W }}
            >
              {t('tournament.championBadge')}
            </h2>
          )}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="relative" style={{ width, height }}>
          {/* The lines: drawn first, so the pairings sit on top of them. */}
          <svg
            className="pointer-events-none absolute inset-0 text-chesscom-300 dark:text-chesscom-600"
            width={width}
            height={height}
            aria-hidden
            data-testid="bracket-lines"
          >
            {paths.map((d) => (
              <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2} />
            ))}
            {champion && last && (
              <path
                d={`M ${colX(rounds.length - 1) + CARD_W} ${last.y} H ${champX}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              />
            )}
          </svg>

          {cols.flat().map((n) => (
            <BracketCard
              key={n.m.id}
              node={n}
              viewerId={viewerId}
              onPlay={onPlay}
              onPlayBot={onPlayBot}
              busy={busy}
              paused={paused}
            />
          ))}

          {champion && last && (
            <div
              className="absolute flex items-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/10 px-3"
              style={{ left: champX, top: last.y - CARD_H / 2, width: CARD_W, height: CARD_H }}
            >
              <Trophy className="h-4 w-4 shrink-0 text-gold-600" />
              <span className="truncate text-sm font-semibold text-gold-700 dark:text-gold-300">
                {champion.display_name}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One pairing of the bracket: the two seats, the score, the way to play it. */
function BracketCard({
  node, viewerId, onPlay, onPlayBot, busy, paused,
}: {
  node: BracketNode;
  viewerId: number;
  onPlay: (m: TournamentMatch) => void;
  onPlayBot: (m: TournamentMatch) => void;
  busy: number | null;
  paused: boolean;
}) {
  const { t } = useTranslation();
  const m = node.m;
  const mine = m.white?.user_id === viewerId || m.black?.user_id === viewerId;
  const winner = m.result === '1-0' ? m.white : m.result === '0-1' ? m.black : null;

  return (
    <div
      className={cn(
        'absolute flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-soft dark:bg-chesscom-800',
        mine ? 'border-board-dark/40 ring-1 ring-board-dark/10' : 'border-chesscom-200 dark:border-chesscom-700',
      )}
      style={{ left: colX(node.col), top: node.y - CARD_H / 2, width: CARD_W, height: CARD_H }}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <Side side={m.white} win={winner?.user_id != null && winner.user_id === m.white?.user_id} />
        <Side side={m.black} win={winner?.user_id != null && winner.user_id === m.black?.user_id} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-mono text-xs text-chesscom-400">{m.result ?? '–'}</span>
        {m.status !== 'finished' && mine && (
          <button
            onClick={() => (m.is_bot_match ? onPlayBot(m) : onPlay(m))}
            disabled={busy === m.id || paused}
            className="btn-primary px-2 py-1 text-xs"
            title={paused ? t('tournament.pausedBanner') : undefined}
          >
            <Play className="h-3 w-3" /> {paused ? t('tournament.paused') : t('tournament.play')}
          </button>
        )}
      </div>
    </div>
  );
}

function Side({ side, win }: { side: TournamentMatch['white']; win: boolean }) {
  if (!side) return <span className="block truncate text-sm text-chesscom-400">—</span>;
  return (
    <span className={cn(
      'flex w-full min-w-0 items-center gap-1.5 text-sm',
      win ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-600 dark:text-chesscom-300',
    )}>
      <span className="shrink-0">{side.avatar_emoji}</span>
      <span className="min-w-0 truncate">{side.display_name}</span>
    </span>
  );
}

function Standings({ players }: { players: TournamentPlayer[] }) {
  const { t } = useTranslation();
  const sorted = [...players].sort((a, b) => {
    if (a.status === 'champion' && b.status !== 'champion') return -1;
    if (b.status === 'champion' && a.status !== 'champion') return 1;
    if (b.points !== a.points) return b.points - a.points;
    return a.seed - b.seed;
  });
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-chesscom-200 text-left text-xs uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{t('tournament.player')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('tournament.points')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('tournament.state')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.user_id} className="border-b border-chesscom-100 last:border-0 dark:border-chesscom-800">
              <td className="px-3 py-2 font-mono text-xs text-chesscom-500">{i + 1}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <span>{p.avatar_emoji}</span>
                  <span className="font-medium">{p.display_name}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{p.points}</td>
              <td className="px-3 py-2 text-right">
                {p.status === 'champion' ? (
                  <span className="badge bg-gold-500/15 text-gold-700 dark:text-gold-300">
                    <Trophy className="mr-1 inline h-3 w-3" /> {t('tournament.championBadge')}
                  </span>
                ) : p.status === 'eliminated' ? (
                  <span className="text-xs text-chesscom-400">
                    <Flag className="mr-1 inline h-3 w-3" /> {t('tournament.eliminated')}
                  </span>
                ) : (
                  <span className="text-xs text-green-600">{t('tournament.inTheGame')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
