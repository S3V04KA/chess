// Tournaments — the list of tournaments on this Patzer.
//
// An admin creates a tournament and shares the invitation link; players open
// it and press "Join". The tournament only starts when the admin gives the
// go-ahead, so this page is mostly a waiting room.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, Users, Clock, ChevronRight, Plus, Link2, Check, UserPlus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { humanizeError } from '../lib/errors';
import { copyText } from '../lib/clipboard';
import { cn } from '../lib/utils';
import type { TournamentSummary } from '../types';

export default function Tournaments() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api.get<{ tournaments: TournamentSummary[] }>('/api/tournaments'),
    refetchInterval: 15_000,
  });

  const tournaments = data?.tournaments ?? [];
  const isAdmin = user?.role === 'admin';

  async function join() {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setJoinError('');
    try {
      await api.post(`/api/tournaments/code/${encodeURIComponent(clean)}/join`, {});
      window.location.href = `/tournaments/join/${clean}`;
    } catch (e) {
      setJoinError(humanizeError(e, t));
    }
  }

  /** Join an open tournament straight from the list. */
  const joinMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/tournaments/${id}/join`, {}),
    onSuccess: (_r, id) => { window.location.href = `/tournaments/${id}`; },
    onError: (e) => setJoinError(humanizeError(e, t)),
  });

  async function copyLink(link: string) {
    if (!(await copyText(link))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <motion.header
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      >
        <h1 className="text-2xl font-bold tracking-tight text-chesscom-900 dark:text-chesscom-100">
          {t('tournament.title')}
        </h1>
        <p className="mt-0.5 text-sm text-chesscom-500">{t('tournament.subtitle')}</p>
      </motion.header>

      {/* Join by code — for players who got the code but not the link. */}
      <div className="card p-4">
        <label className="label mb-1 block" htmlFor="tournament-code">{t('tournament.joinByCode')}</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="tournament-code"
            className="input font-mono uppercase tracking-wider"
            placeholder="ABCDEFGHJK"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void join(); }}
          />
          <button onClick={() => void join()} className="btn-primary">{t('tournament.join')}</button>
        </div>
        {joinError && <p className="mt-2 text-sm text-bad">{joinError}</p>}
      </div>

      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[86px] animate-pulse-soft rounded-xl bg-chesscom-100 dark:bg-chesscom-800" />
          ))}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="card p-8 text-center text-sm text-chesscom-500">
          {t('tournament.empty')}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {tournaments.map((tn) => (
            <TournamentCard
              key={tn.id}
              tn={tn}
              onCopy={copyLink}
              copied={copied}
              onJoin={(target) => joinMutation.mutate(target.id)}
            />
          ))}
        </ul>
      )}

      {isAdmin && (
        <p className="text-xs text-chesscom-400">
          <Plus className="mr-1 inline h-3 w-3" />
          {t('tournament.adminHint')}
        </p>
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

function TournamentCard({ tn, onCopy, copied, onJoin }: {
  tn: TournamentSummary;
  onCopy: (l: string) => void;
  copied: boolean;
  onJoin: (tn: TournamentSummary) => void;
}) {
  const { t } = useTranslation();
  // An open tournament the viewer is not in yet can still be joined — that is
  // the whole point of the invitation link.
  const canJoin = tn.status === 'open' && !tn.joined;
  return (
    <li>
      <Link
        to={`/tournaments/${tn.id}`}
        className="group flex items-center gap-3 rounded-xl border border-chesscom-200 bg-white p-3 shadow-soft transition-all hover:border-board-dark/40 hover:shadow-lift dark:border-chesscom-700 dark:bg-chesscom-800"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
          <Trophy className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-chesscom-900 dark:text-chesscom-100">{tn.name}</span>
            <span className={cn('badge', STATUS_BADGE[tn.status])}>{t(`tournament.status.${tn.status}`)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-chesscom-500">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {t('tournament.players', { count: tn.participants })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t(`play.tc.${tn.time_control}`, { defaultValue: tn.time_control })}
            </span>
          </div>
        </div>
        {canJoin && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onJoin(tn); }}
            className="btn-secondary shrink-0 px-2 py-1 text-xs"
            title={t('tournament.join')}
          >
            <UserPlus className="h-3.5 w-3.5" /> {t('tournament.join')}
          </button>
        )}
        {tn.link && (
          <button
            onClick={(e) => { e.preventDefault(); onCopy(tn.link!); }}
            className="btn-ghost p-1.5 text-chesscom-500"
            title={t('tournament.copyLink')}
            aria-label={t('tournament.copyLink')}
          >
            {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          </button>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-300 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}
