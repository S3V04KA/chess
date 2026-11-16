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
import type { TournamentDetail, TournamentMatch, TournamentPlayer } from '../types';

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

      {/* The bracket */}
      {rounds.length === 0 ? (
        <p className="card p-8 text-center text-sm text-chesscom-500">{t('tournament.bracketEmpty')}</p>
      ) : (
        <section className="space-y-4">
          {rounds.map((r) => (
            <div key={r.round}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-chesscom-500">
                {t('tournament.round', { round: r.round })}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {r.matches.map((m) => (
                  <MatchRow key={m.id} m={m} viewerId={user?.id ?? 0} onPlay={playHuman} onPlayBot={playBot} busy={busyMatch} paused={paused} />
                ))}
              </ul>
            </div>
          ))}
        </section>
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
  finished: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
  cancelled: 'bg-bad/10 text-bad',
};

function MatchRow({
  m, viewerId, onPlay, onPlayBot, busy, paused,
}: {
  m: TournamentMatch; viewerId: number;
  onPlay: (m: TournamentMatch) => void; onPlayBot: (m: TournamentMatch) => void; busy: number | null;
  paused: boolean;
}) {
  const { t } = useTranslation();
  const mine = m.white?.user_id === viewerId || m.black?.user_id === viewerId;
  const winner = m.result === '1-0' ? m.white : m.result === '0-1' ? m.black : null;

  return (
    <li className={cn(
      'flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 dark:bg-chesscom-800',
      mine ? 'border-board-dark/40' : 'border-chesscom-200 dark:border-chesscom-700',
    )}>
      <Side side={m.white} win={winner?.user_id != null && winner.user_id === m.white?.user_id} />
      <span className="shrink-0 font-mono text-xs text-chesscom-400">
        {m.result ?? '–'}
      </span>
      <Side side={m.black} win={winner?.user_id != null && winner.user_id === m.black?.user_id} />
      {m.status !== 'finished' && mine && (
        <button
          onClick={() => (m.is_bot_match ? onPlayBot(m) : onPlay(m))}
          disabled={busy === m.id || paused}
          className="btn-primary ml-auto shrink-0 px-2 py-1 text-xs"
          title={paused ? t('tournament.pausedBanner') : undefined}
        >
          <Play className="h-3 w-3" /> {paused ? t('tournament.paused') : t('tournament.play')}
        </button>
      )}
    </li>
  );
}

function Side({ side, win }: { side: TournamentMatch['white']; win: boolean }) {
  if (!side) return <span className="min-w-0 flex-1 truncate text-sm text-chesscom-400">—</span>;
  return (
    <span className={cn(
      'flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm',
      win ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-600 dark:text-chesscom-300',
    )}>
      <span className="shrink-0">{side.avatar_emoji}</span>
      <span className="truncate">{side.display_name}</span>
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
