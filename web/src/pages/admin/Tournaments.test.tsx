// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, patch: vi.fn(), del: vi.fn() } }));
// happy-dom cancels framer-motion's entrance animation on unmount with an
// unhandled AbortError. The animation isn't under test: render plain tags.
vi.mock('framer-motion', () => {
  const tag = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  );
  return { motion: new Proxy({}, { get: () => tag }) };
});

import i18n from '../../i18n';
import AdminTournaments from './Tournaments';

beforeAll(async () => { await i18n.changeLanguage('de'); });

const tournament = (over: Record<string, unknown> = {}) => ({
  id: 1, code: 'ABCDEFGHJK', name: 'Familienpokal', description: null,
  status: 'open', time_control: 'blitz', bot_difficulty: 'easy',
  participants: 2,
  players: [
    { user_id: 2, display_name: 'Anna', avatar_emoji: '♟', username: 'anna' },
    { user_id: 3, display_name: 'Ben', avatar_emoji: '♞', username: 'ben' },
  ],
  created_at: '2026-09-25T12:00:00.000Z', approved_at: null, started_at: null,
  finished_at: null, winner_user_id: null,
  link: 'https://chess.example.org/tournaments/join/ABCDEFGHJK',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ tournaments: [tournament()] });
  post.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminTournaments /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin → Tournaments', () => {
  it('shows the invitation link so the admin can send it on', async () => {
    renderSection();

    expect(await screen.findByText('Familienpokal')).toBeTruthy();
    const link = screen.getByText('https://chess.example.org/tournaments/join/ABCDEFGHJK');
    expect(link).toBeTruthy();
  });

  it('has the create button right at the top, where the admin looks for it', async () => {
    renderSection();

    // The button is on the page itself, not buried under a table further down.
    const create = await screen.findByRole('button', { name: /Neues Turnier/ });
    expect(create).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Turniere' })).toBeTruthy();
  });

  it('lists who has joined', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Wer dabei ist/ }));
    expect(await screen.findByText('Anna')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
  });

  it('starts the tournament', async () => {
    renderSection();

    const start = await screen.findByRole('button', { name: /Starten/ });
    fireEvent.click(start);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/tournaments/1/start', {}));
  });

  it('will not start a tournament with fewer than two players', async () => {
    get.mockResolvedValue({ tournaments: [tournament({ participants: 1, players: [] })] });
    renderSection();

    const start = await screen.findByRole('button', { name: /Starten/ });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    // And pressing it anyway does nothing.
    fireEvent.click(start);
    expect(post).not.toHaveBeenCalled();
  });

  it('creates a tournament and hands out the link', async () => {
    get.mockResolvedValue({ tournaments: [] });
    post.mockResolvedValue({ tournament: { id: 2, code: 'NEWCODE12', name: 'Vereinscup', link: 'https://chess.example.org/tournaments/join/NEWCODE12' } });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Neues Turnier/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vereinscup' } });
    fireEvent.click(screen.getByRole('button', { name: /Turnier anlegen/ }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/tournaments', expect.objectContaining({ name: 'Vereinscup' })));
    expect(await screen.findByText('Turnier bereit')).toBeTruthy();
    // The link is in a field, so the admin can select it and copy it.
    const field = screen.getByLabelText('Einladungslink') as HTMLInputElement;
    expect(field.value).toBe('https://chess.example.org/tournaments/join/NEWCODE12');
    expect(screen.getByText('NEWCODE12')).toBeTruthy();
  });

  it('says that the link stops taking players once the tournament starts', async () => {
    get.mockResolvedValue({ tournaments: [] });
    post.mockResolvedValue({ tournament: { id: 2, code: 'NEWCODE12', name: 'Vereinscup', link: 'https://chess.example.org/tournaments/join/NEWCODE12' } });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Neues Turnier/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Vereinscup' } });
    fireEvent.click(screen.getByRole('button', { name: /Turnier anlegen/ }));

    const dialog = (await screen.findByText('Turnier bereit')).closest('.card') as HTMLElement;
    expect(dialog.textContent).toContain('nimmt der Link keine neuen Spieler mehr an');
  });
});
