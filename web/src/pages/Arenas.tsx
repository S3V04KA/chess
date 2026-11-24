// The arena list page: open PvP matchmaking where players join and play immediately.
// Points are awarded 2/1/0 (win/draw/loss). Only admins can create arenas.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trophy, Users, Sword, Plus, Play, Flag, Pause, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useLobby } from '../state/lobby';
import { humanizeError } from '../lib/errors';
import type { ArenaSummary, ArenaPlayer, ArenaMatch } from '../types';

interface ArenaDetail {
  arena: ArenaSummary;
  players: ArenaPlayer[];
  matches: ArenaMatch[];
}

export default function Arenas() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  interface ArenaListResponse {
    arenas: ArenaSummary[];
  }

  const { data: arenas, isLoading, error } = useQuery<ArenaListResponse | undefined>({
    queryKey: ['/api/arenas'],
    enabled: !!user,
    queryFn: async () => {
      const res = await api.get('/api/arenas');
      return res as ArenaListResponse;
    },
  });

  const joinMutation = useMutation({
    mutationFn: (code: string) => api.post(`/api/arenas/code/${code}/join`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas'] });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: ({ arenaId }: { arenaId: number }) => api.post(`/api/arenas/${arenaId}/leave`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) => 
      api.post('/api/arenas', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/arenas'] });
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    },
  });

  const STATUS_BADGE: Record<string, string> = {
    open: 'bg-accent-100 text-accent-700',
    running: 'bg-green-500/15 text-green-600',
    paused: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    closed: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
  };

  function copyLink(arena: ArenaSummary) {
    const url = `${window.location.origin}/arenas/${arena.code}`;
    navigator.clipboard.writeText(url);
    alert('Link copied to clipboard!');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-chesscom-900 dark:text-chesscom-100">
            {t('arena.title')}
          </h1>
          <p className="mt-1 text-sm text-chesscom-600 dark:text-chesscom-400">
            {t('arena.subtitle')}
          </p>
        </div>
        {user && (
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> {t('arena.create')}
          </button>
        )}
      </header>

      {showCreate && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">{t('arena.create')}</h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder={t('arena.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-chesscom-300 bg-white px-3 py-2 text-sm dark:border-chesscom-700 dark:bg-chesscom-800"
            />
            <textarea
              placeholder={t('arena.descriptionPlaceholder')}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full rounded-lg border border-chesscom-300 bg-white px-3 py-2 text-sm dark:border-chesscom-700 dark:bg-chesscom-800"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate({ name: newName, description: newDesc })}
                disabled={!newName || createMutation.isPending}
                className="btn-primary px-4 py-2 text-sm"
              >
                {createMutation.isPending ? t('arena.creating') : t('arena.create')}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                disabled={createMutation.isPending}
                className="btn-secondary px-4 py-2 text-sm"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="card p-8 text-center text-sm text-chesscom-500">
          Loading arenas...
        </p>
      )}

      {!isLoading && arenas?.arenas.length === 0 ? (
        <p className="card p-8 text-center text-sm text-chesscom-500">
          {t('arena.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {arenas?.arenas.map((tn) => (
            <li key={tn.id}>
              <Link
                to={`/arenas/${tn.code}`}
                className="group flex items-center gap-3 rounded-xl border border-chesscom-200 bg-white p-3 shadow-soft transition-all hover:border-board-dark/40 hover:shadow-lift dark:border-chesscom-700 dark:bg-chesscom-800"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/15">
                  <Trophy className="h-6 w-6 text-gold-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-chesscom-900 dark:text-chesscom-100">
                      {tn.name}
                    </h3>
                    <span className={`badge ${STATUS_BADGE[tn.status]}`}>
                      {t(`arena.status.${tn.status}`)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-chesscom-500">
                    {t('arena.players', { count: tn.participants })} • {t(`arena.timeControl.${tn.time_control}`)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.preventDefault(); copyLink(tn); }}
                    className="text-xs text-chesscom-500 hover:text-chesscom-700 dark:hover:text-chesscom-300"
                  >
                    {t('arena.copyLink')}
                  </button>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
