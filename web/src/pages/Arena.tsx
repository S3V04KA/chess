// The arena page: real-time leaderboard and matchmaking.
// Players join, play against free players or bot, earn points 2/1/0.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, Users, Clock, Bot, Play, ArrowLeft, Swords, Flag, Pause, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useLobby } from '../state/lobby';
import { humanizeError } from '../lib/errors';
import { cn } from '../lib/utils';
import type { ArenaDetail, ArenaPlayer, ArenaMatch } from '../types';

export default function Arena() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { code } = useParams<{ code: string }>();
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  const { data: detail } = useQuery<ArenaDetail | undefined>({
    queryKey: ['/api/arenas', code],
    enabled: !!code && !!user,
  });

  const joinMutation = useMutation({
    mutationFn: () => api.post(`/api/arenas/code/${code}/join`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas', code] });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => api.post(`/api/arenas/${detail?.arena.id}/leave`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas', code] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: (arenaId: number) => api.post('/api/arenas/matches/claim', { arena_id: arenaId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas', code] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (arenaId: number) => api.post(`/api/arenas/${arenaId}/pause`, {}),
  });

  const resumeMutation = useMutation({
    mutationFn: (arenaId: number) => api.post(`/api/arenas/${arenaId}/resume`, {}),
  });

  const closeMutation = useMutation({
    mutationFn: (arenaId: number) => api.post(`/api/arenas/${arenaId}/close`, {}),
  });

  const joined = !!detail && detail.arena.status !== 'closed';
  const paused = detail?.arena.status === 'paused';
  const isOwner = user?.id === detail?.arena.created_by;

  function claimMatch() {
    if (!detail || claiming) return;
    setClaiming(true);
    claimMutation.mutate(detail.arena.id, {
      onSuccess: () => {
        setClaiming(false);
      },
      onError: () => {
        setClaiming(false);
      },
    });
  }

  const freePlayers = detail?.players.filter(p => p.status === 'free').length ?? 0;
  const playingPlayers = detail?.players.filter(p => p.status === 'playing').length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/arenas" className="text-chesscom-500 hover:text-chesscom-700 dark:hover:text-chesscom-300">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-chesscom-900 dark:text-chesscom-100">
              {detail?.arena.name}
            </h1>
            <p className="text-sm text-chesscom-600 dark:text-chesscom-400">
              {t('arena.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && detail?.arena.status === 'running' && (
            <button
              onClick={() => pauseMutation.mutate(detail.arena.id)}
              className="btn-secondary flex items-center gap-2"
            >
              <Pause className="h-4 w-4" /> {t('arena.pause')}
            </button>
          )}
          {isOwner && detail?.arena.status === 'paused' && (
            <button
              onClick={() => resumeMutation.mutate(detail.arena.id)}
              className="btn-primary flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" /> {t('arena.resume')}
            </button>
          )}
          {isOwner && detail?.arena.status !== 'closed' && (
            <button
              onClick={() => detail && closeMutation.mutate(detail.arena.id)}
              className="btn-danger flex items-center gap-2"
            >
              <Flag className="h-4 w-4" /> {t('arena.close')}
            </button>
          )}
        </div>
      </header>

      {paused && (
        <div className="card border-amber-500/30 bg-amber-50 p-4 text-center dark:bg-amber-900/10">
          <Pause className="mx-auto h-6 w-6 text-amber-600" />
          <p className="mt-2 font-semibold text-amber-700 dark:text-amber-300">
            {t('arena.paused')}
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t('arena.pausedNotice')}
          </p>
        </div>
      )}

      {!joined ? (
        detail?.arena.status === 'closed' ? (
          <div className="card p-8 text-center">
            <Flag className="mx-auto h-12 w-12 text-chesscom-400" />
            <p className="mt-4 font-semibold">{t('arena.closed')}</p>
            <p className="mt-1 text-sm text-chesscom-500">
              {t('arena.closedHint')}
            </p>
          </div>
        ) : (
          <div className="card p-8 text-center">
            <Swords className="mx-auto h-12 w-12 text-gold-600" />
            <h2 className="mt-4 font-semibold">{t('arena.joinTitle')}</h2>
            <p className="mt-1 text-sm text-chesscom-500">
              {t('arena.joinHint')}
            </p>
            <button
              onClick={() => joinMutation.mutate()}
              disabled={joinMutation.isPending}
              className="btn-primary mt-4 px-6 py-2"
            >
              {joinMutation.isPending ? t('joining') : t('arena.join')}
            </button>
          </div>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Leaderboard */}
          <section className="lg:col-span-2">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-chesscom-900 dark:text-chesscom-100">
              <Trophy className="h-5 w-5" /> {t('arena.standings')}
            </h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-chesscom-200 text-left text-xs uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700">
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">{t('arena.player')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('arena.points')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('arena.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.players ?? []).sort((a, b) => {
                    if (b.points !== a.points) return b.points - a.points;
                    return a.user_id - b.user_id;
                  }).map((p, i) => (
                    <tr key={p.user_id} className="border-b border-chesscom-100 last:border-0 dark:border-chesscom-800">
                      <td className="px-3 py-2 font-mono text-xs text-chesscom-500">{i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span>{p.avatar_emoji}</span>
                          <span className="font-medium">{p.display_name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-chesscom-700 dark:text-chesscom-300">
                        {p.points}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`badge ${STATUS_BADGE[p.status]}`}>
                          {t(`arena.playerStatus.${p.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* My status and matchmaking */}
          <section>
            <div className="card space-y-4">
              <h3 className="font-semibold">{t('arena.myStatus')}</h3>
              {(() => {
                const me = detail?.players.find(p => p.user_id === user?.id);
                if (!me) return null;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-chesscom-600 dark:text-chesscom-400">
                        {t('arena.points')}
                      </span>
                      <span className="font-mono font-semibold">{me.points}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-chesscom-600 dark:text-chesscom-400">
                        {t('arena.state')}
                      </span>
                      <span className={`badge ${STATUS_BADGE[me.status]}`}>
                        {t(`arena.playerStatus.${me.status}`)}
                      </span>
                    </div>
                  </>
                );
              })()}
              
              {detail?.arena.status === 'running' && !paused && (
                <button
                  onClick={claimMatch}
                  disabled={claiming || claiming}
                  className="btn-primary flex w-full items-center justify-center gap-2"
                >
                  <Play className="h-4 w-4" /> {claiming ? t('arena.matchmaking') : t('arena.findMatch')}
                </button>
              )}

              <div className="border-t border-chesscom-200 pt-4 dark:border-chesscom-700">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-chesscom-500">{t('arena.freePlayers')}</span>
                  <span className="font-mono">{freePlayers}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="text-chesscom-500">{t('arena.playingPlayers')}</span>
                  <span className="font-mono">{playingPlayers}</span>
                </div>
              </div>

              <button
                onClick={() => leaveMutation.mutate()}
                disabled={leaveMutation.isPending || playingPlayers > 0}
                className="btn-secondary w-full"
              >
                {t('arena.leave')}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Recent matches */}
      {joined && detail?.matches.length !== 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-chesscom-900 dark:text-chesscom-100">
            <Swords className="h-5 w-5" /> {t('arena.recentMatches')}
          </h2>
          <ul className="space-y-2">
            {(detail.matches ?? []).slice(0, 10).map((m) => (
              <li key={m.id} className="card flex items-center gap-3 p-3">
                <div className="flex items-center gap-2">
                  {m.white?.is_bot ? (
                    <Bot className="h-5 w-5 text-chesscom-400" />
                  ) : (
                    <span className="text-lg">{m.white?.avatar_emoji ?? '♟'}</span>
                  )}
                  <span className="font-medium">{m.white?.display_name ?? '—'}</span>
                </div>
                <span className="shrink-0 font-mono text-xs text-chesscom-400">
                  {m.result ?? '–'}
                </span>
                <div className="flex items-center gap-2">
                  {m.black?.is_bot ? (
                    <Bot className="h-5 w-5 text-chesscom-400" />
                  ) : (
                    <span className="text-lg">{m.black?.avatar_emoji ?? '♟'}</span>
                  )}
                  <span className="font-medium">{m.black?.display_name ?? '—'}</span>
                </div>
                <div className="ml-auto">
                  <span className={`badge ${MATCH_STATUS_BADGE[m.status]}`}>
                    {t(`arena.matchStatus.${m.status}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  free: 'bg-green-500/15 text-green-600',
  playing: 'bg-blue-500/15 text-blue-600',
  spectating: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
};

const MATCH_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-600',
  active: 'bg-green-500/15 text-green-600',
  finished: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
};
