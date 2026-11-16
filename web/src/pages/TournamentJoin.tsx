// The invitation link's landing page: /tournaments/join/<code>.
//
// A guest sees what the tournament is and is asked to sign in; a signed-in
// player joins with one click. Joining does not start anything — the admin
// still has to approve the start — and once the admin has, this door closes
// for newcomers.

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Trophy, Users, Clock, Bot, LogIn, UserPlus, Lock } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { humanizeError } from '../lib/errors';
import type { TournamentSummary } from '../types';

export default function TournamentJoin() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tournament', 'code', code],
    queryFn: () => api.get<{ tournament: TournamentSummary }>(`/api/tournaments/code/${encodeURIComponent(code)}`),
    retry: false,
  });

  const tournament = data?.tournament;

  async function join() {
    setBusy(true); setError('');
    try {
      await api.post(`/api/tournaments/code/${encodeURIComponent(code)}/join`, {});
      nav(`/tournaments/${tournament!.id}`, { replace: true });
    } catch (e) {
      setError(humanizeError(e, t));
      setBusy(false);
    }
  }

  // The door is closed: the admin started the tournament and the bracket is
  // built. Say so plainly instead of failing with an error code. A paused
  // tournament is closed too — it is frozen until the admin resumes it.
  const closed = tournament && tournament.status !== 'open';

  return (
    <div className="mx-auto max-w-lg py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="card p-6 text-center"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-600">
          <Trophy className="h-7 w-7" />
        </div>

        {isLoading || loading ? (
          <p className="text-sm text-chesscom-500">{t('common.loading')}</p>
        ) : isError || !tournament ? (
          <>
            <h1 className="text-lg font-semibold">{t('tournament.notFound')}</h1>
            <p className="mt-1 text-sm text-chesscom-500">{t('tournament.notFoundHint')}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold tracking-tight text-chesscom-900 dark:text-chesscom-100">
              {tournament.name}
            </h1>
            {tournament.description && (
              <p className="mt-1 text-sm text-chesscom-500">{tournament.description}</p>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-chesscom-500">
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

            {closed ? (
              // Started, finished or cancelled — no seat is free any more.
              <div className="mt-5 space-y-3">
                <div className="flex items-start gap-2 rounded-xl bg-ink-100 px-3 py-2.5 text-left text-sm text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('tournament.closedToNewcomers')}</span>
                </div>
                <Link to={`/tournaments/${tournament.id}`} className="btn-secondary w-full justify-center">
                  {t('tournament.viewTournament')}
                </Link>
              </div>
            ) : !user ? (
              <div className="mt-5 space-y-2">
                <p className="text-sm text-chesscom-500">{t('tournament.signInToJoin')}</p>
                <Link to="/login" className="btn-primary w-full justify-center">
                  <LogIn className="h-4 w-4" /> {t('login.submit')}
                </Link>
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                {error ? (
                  <p className="text-sm text-bad">{error}</p>
                ) : (
                  <p className="text-sm text-chesscom-500">{t('tournament.joinHint')}</p>
                )}
                <button onClick={() => void join()} disabled={busy} className="btn-primary w-full justify-center">
                  <UserPlus className="h-4 w-4" /> {busy ? t('tournament.joining') : t('tournament.join')}
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
