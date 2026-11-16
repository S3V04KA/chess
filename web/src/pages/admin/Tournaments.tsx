// Admin → Users → Tournaments: create a tournament, share the invitation link,
// watch who joins and give the go-ahead.
//
// The link is the whole point of this screen: the admin creates the
// tournament, sends the link to the players, and the players join through it.
// Until the admin presses "Start" the bracket does not exist — and once it
// does, the door is closed for newcomers.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Plus, Copy, Check, Play, X, Flag, Link2, Users, Clock, Bot, Share2, UserPlus, Pause } from 'lucide-react';
import { api } from '../../api';
import { humanizeError } from '../../lib/errors';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/utils';
import type { Difficulty } from '../../types';

interface AdminPlayer {
  user_id: number;
  display_name: string;
  avatar_emoji: string;
  username: string;
}

interface AdminTournament {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: 'open' | 'running' | 'paused' | 'finished' | 'cancelled';
  time_control: string;
  bot_difficulty: string;
  participants: number;
  players: AdminPlayer[];
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  winner_user_id: number | null;
  link: string;
}

const QUERY_KEY = ['admin', 'tournaments'];
const DIFFICULTIES: Difficulty[] = ['kid', 'beginner', 'easy', 'medium', 'hard', 'master', 'stockfish'];
const TIME_CONTROLS = ['untimed', 'bullet', 'blitz', 'rapid', 'classical'] as const;

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-accent-100 text-accent-700',
  running: 'bg-green-500/15 text-green-600',
  paused: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  finished: 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700 dark:text-chesscom-200',
  cancelled: 'bg-bad/10 text-bad',
};

export default function AdminTournaments() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<{ tournaments: AdminTournament[] }>('/api/admin/tournaments'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const start = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/tournaments/${id}/start`, {}),
    onSuccess: refresh,
    onError: (e) => window.alert(humanizeError(e, t)),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/tournaments/${id}/cancel`, {}),
    onSuccess: refresh,
    onError: (e) => window.alert(humanizeError(e, t)),
  });

  const pause = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/tournaments/${id}/pause`, {}),
    onSuccess: refresh,
    onError: (e) => window.alert(humanizeError(e, t)),
  });

  const resume = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/tournaments/${id}/resume`, {}),
    onSuccess: refresh,
    onError: (e) => window.alert(humanizeError(e, t)),
  });

  async function copy(tn: AdminTournament) {
    if (!(await copyText(tn.link))) return;
    setCopiedId(tn.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  /** The native share sheet on a phone, the clipboard everywhere else. */
  async function share(tn: AdminTournament) {
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: tn.name, text: t('tournament.shareText', { name: tn.name }), url: tn.link });
        return;
      } catch {
        // The sheet was dismissed — fall through to copying.
      }
    }
    await copy(tn);
  }

  const tournaments = data?.tournaments ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.tournaments')}</h1>
          <p className="text-sm text-chesscom-500">{t('admin.tournamentsIntro')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" /> {t('admin.newTournament')}
        </button>
      </div>

      <div className="card divide-y divide-ink-100 dark:divide-ink-800">
        {tournaments.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">{t('admin.noTournaments')}</p>}
        {tournaments.map((tn) => (
          <div key={tn.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{tn.name}</span>
                  <span className={cn('badge', STATUS_BADGE[tn.status])}>{t(`tournament.status.${tn.status}`)}</span>
                </div>
                {tn.description && <div className="mt-0.5 text-sm text-ink-600 dark:text-ink-300">{tn.description}</div>}
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-500">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> {t('tournament.players', { count: tn.participants })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {t(`play.tc.${tn.time_control}`, { defaultValue: tn.time_control })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Bot className="h-3 w-3" /> {t(`play.diff.${tn.bot_difficulty}`, { defaultValue: tn.bot_difficulty })}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {tn.status === 'open' && (
                  <button
                    onClick={() => setExpanded(expanded === tn.id ? null : tn.id)}
                    className="btn-ghost p-1.5 text-chesscom-500"
                    title={t('admin.joinedPlayers')}
                    aria-label={t('admin.joinedPlayers')}
                  >
                    <UserPlus className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => void share(tn)}
                  className="btn-ghost p-1.5 text-chesscom-500"
                  title={t('tournament.shareLink')}
                  aria-label={t('tournament.shareLink')}
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => void copy(tn)}
                  className="btn-ghost p-1.5 text-chesscom-500"
                  title={t('tournament.copyLink')}
                  aria-label={t('tournament.copyLink')}
                >
                  {copiedId === tn.id ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                </button>
                <Link
                  to={`/tournaments/${tn.id}`}
                  className="btn-ghost p-1.5 text-chesscom-500"
                  title={t('admin.openTournament')}
                  aria-label={t('admin.openTournament')}
                >
                  <Flag className="h-4 w-4" />
                </Link>
                {tn.status === 'open' && (
                  <>
                    <button
                      onClick={() => start.mutate(tn.id)}
                      disabled={tn.participants < 2}
                      className="btn-secondary px-2 py-1 text-xs"
                      title={tn.participants < 2 ? t('admin.needTwoPlayers') : t('admin.startTournament')}
                    >
                      <Play className="h-3 w-3" /> {t('admin.startTournament')}
                    </button>
                    <button
                      onClick={() => { if (confirm(t('admin.cancelTournamentConfirm'))) cancel.mutate(tn.id); }}
                      className="btn-ghost p-1.5 text-bad"
                      title={t('admin.cancelTournament')}
                      aria-label={t('admin.cancelTournament')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                )}
                {/* Pause / resume — a tournament that runs over a few days
                    stands still between the sittings. */}
                {tn.status === 'paused' ? (
                  <button
                    onClick={() => { if (confirm(t('admin.resumeTournamentConfirm'))) resume.mutate(tn.id); }}
                    className="btn-secondary px-2 py-1 text-xs"
                    title={t('admin.resumeTournament')}
                  >
                    <Play className="h-3 w-3" /> {t('admin.resumeTournament')}
                  </button>
                ) : (tn.status === 'running' || tn.status === 'open') && (
                  <button
                    onClick={() => { if (confirm(t('admin.pauseTournamentConfirm'))) pause.mutate(tn.id); }}
                    className="btn-ghost p-1.5 text-amber-600"
                    title={t('admin.pauseTournament')}
                    aria-label={t('admin.pauseTournament')}
                  >
                    <Pause className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* The link itself, so the admin can copy it without a click. */}
            {tn.status === 'open' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-50 px-2 py-1 font-mono text-xs text-ink-600 dark:bg-ink-900 dark:text-ink-300">
                  {tn.link}
                </code>
              </div>
            )}

            {/* Who has joined so far. */}
            {expanded === tn.id && tn.status === 'open' && (
              <div className="mt-2 rounded-xl bg-ink-50 p-3 dark:bg-ink-900">
                <div className="label mb-2">{t('admin.joinedPlayers')}</div>
                {tn.players.length === 0 ? (
                  <p className="text-sm text-ink-500">{t('admin.noPlayersYet')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {tn.players.map((p) => (
                      <li key={p.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs dark:bg-ink-800">
                        <span>{p.avatar_emoji}</span>
                        <span className="font-medium">{p.display_name}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-ink-500">{t('admin.shareLinkHint')}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {showCreate && <CreateTournamentModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </div>
  );
}

function CreateTournamentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    description: '',
    time_control: 'blitz' as (typeof TIME_CONTROLS)[number],
    bot_difficulty: 'medium' as Difficulty,
  });
  const [created, setCreated] = useState<{ name: string; code: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ tournament: { id: number; code: string; name: string; link: string } }>(
        '/api/admin/tournaments',
        {
          name: form.name,
          description: form.description,
          time_control: form.time_control,
          bot_difficulty: form.bot_difficulty,
        },
      );
      setCreated({ name: r.tournament.name, code: r.tournament.code, link: r.tournament.link });
      onCreated();
    } catch (e) {
      setErr(humanizeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created || !(await copyText(created.link))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function share() {
    if (!created) return;
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: created.name, text: t('tournament.shareText', { name: created.name }), url: created.link });
        return;
      } catch {
        // Dismissed — fall through to copying.
      }
    }
    await copy();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-full w-full max-w-md overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {created ? t('admin.tournamentCreated') : t('admin.newTournament')}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label={t('common.close')}><X className="h-4 w-4" /></button>
        </div>

        {created ? (
          <div className="grid gap-4">
            <p className="text-sm text-ink-500">{t('admin.tournamentCreatedBody')}</p>
            <div>
              <label className="label mb-1 block" htmlFor="tournament-link">{t('tournament.inviteLink')}</label>
              <div className="flex gap-2">
                <input id="tournament-link" className="input font-mono text-xs" readOnly value={created.link} onFocus={(e) => e.target.select()} />
                <button onClick={() => void copy()} className="btn-secondary shrink-0 px-2" aria-label={t('common.copy')} title={t('common.copy')}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
                <button onClick={() => void share()} className="btn-secondary shrink-0 px-2" aria-label={t('tournament.shareLink')} title={t('tournament.shareLink')}>
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <label className="label mb-1 block">{t('tournament.code')}</label>
              <span className="font-mono text-lg font-semibold tracking-wider">{created.code}</span>
            </div>
            <p className="text-xs text-ink-400">{t('admin.afterStartNoNewPlayers')}</p>
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="btn-primary">{t('common.close')}</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <label className="label mb-1 block" htmlFor="tournament-name">{t('admin.tournamentName')}</label>
              <input id="tournament-name" className="input" maxLength={80} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label mb-1 block" htmlFor="tournament-desc">{t('admin.tournamentDescription')}</label>
              <input id="tournament-desc" className="input" maxLength={300} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label mb-1 block" htmlFor="tournament-tc">{t('play.timeControl')}</label>
                <select id="tournament-tc" className="input" value={form.time_control}
                  onChange={(e) => setForm({ ...form, time_control: e.target.value as (typeof TIME_CONTROLS)[number] })}>
                  {TIME_CONTROLS.map((tc) => <option key={tc} value={tc}>{t(`play.tc.${tc}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="tournament-diff">{t('play.difficulty')}</label>
                <select id="tournament-diff" className="input" value={form.bot_difficulty}
                  onChange={(e) => setForm({ ...form, bot_difficulty: e.target.value as Difficulty })}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{t(`play.diff.${d}`)}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-ink-400">{t('admin.tournamentBotHint')}</p>
            {err && <div className="text-sm text-bad">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
              <button onClick={() => void submit()} disabled={busy || !form.name.trim()} className="btn-primary">
                {t('admin.createTournament')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
