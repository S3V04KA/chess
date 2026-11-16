// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post, patch: vi.fn(), del: vi.fn() } }));
// happy-dom cancels framer-motion's entrance animation on unmount with an
// unhandled AbortError. The animation isn't under test: render plain tags.
vi.mock('framer-motion', () => {
  const tag = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  );
  return { motion: new Proxy({}, { get: () => tag }) };
});
// The lobby opens a WebSocket on mount — there is no server in the test.
vi.mock('../state/lobby', () => ({
  useLobby: () => ({ onTournamentChange: () => () => {} }),
}));
// The viewer: Cleo (id 3) by default — the page marks her own matches with
// that. A test can switch to a guest (null) to see the signed-out screens.
const { viewer } = vi.hoisted(() => ({ viewer: { current: { id: 3, role: 'user' } as { id: number; role: string } | null } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: viewer.current, loading: false }),
}));

import i18n from '../i18n';
import Tournaments from './Tournaments';
import Tournament from './Tournament';
import TournamentJoin from './TournamentJoin';

// Real German strings rather than keys, so a missing or misspelt key shows up
// here as a failed lookup.
beforeAll(async () => { await i18n.changeLanguage('de'); });

const summary = (over: Record<string, unknown> = {}) => ({
  id: 1, code: 'ABCDEFGHJK', name: 'Familienpokal', description: null,
  status: 'open', time_control: 'blitz', bot_difficulty: 'easy', participants: 3,
  created_at: '2026-09-25T12:00:00.000Z', approved_at: null, started_at: null,
  finished_at: null, winner_user_id: null, joined: true, ...over,
});

const side = (name: string, id: number) => ({ user_id: id, display_name: name, avatar_emoji: '♟', is_bot: false });
const botSide = { user_id: null, display_name: 'Stockfish', avatar_emoji: '🤖', is_bot: true };

beforeEach(() => {
  vi.clearAllMocks();
  viewer.current = { id: 3, role: 'user' };
});
afterEach(cleanup);

function renderWith(ui: React.ReactElement, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The tournament page reads the id from the route, so it needs a route. */
function renderTournament() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tournaments/1']}>
        <Routes>
          <Route path="/tournaments/:id" element={<Tournament />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the tournament list', () => {
  it('lists the tournaments with their state and the number of players', async () => {
    get.mockResolvedValue({
      tournaments: [
        summary({ id: 1, name: 'Familienpokal', status: 'open', participants: 3 }),
        summary({ id: 2, name: 'Vereinscup', status: 'running', participants: 8 }),
      ],
    });
    renderWith(<Tournaments />);

    expect(await screen.findByText('Familienpokal')).toBeTruthy();
    expect(screen.getByText('Vereinscup')).toBeTruthy();
    expect(screen.getByText('Wartet auf den Start')).toBeTruthy();
    expect(screen.getByText('Läuft')).toBeTruthy();
    expect(screen.getAllByText(/3 Spieler/)).toHaveLength(1);
  });

  it('says so when there is nothing yet', async () => {
    get.mockResolvedValue({ tournaments: [] });
    renderWith(<Tournaments />);
    expect(await screen.findByText(/Noch keine Turniere/)).toBeTruthy();
  });

  it('joins with a code the player typed', async () => {
    get.mockResolvedValue({ tournaments: [] });
    post.mockResolvedValue({ tournament: summary() });
    renderWith(<Tournaments />);

    fireEvent.change(await screen.findByLabelText('Mit Code beitreten'), { target: { value: 'abcdefghjk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tournaments/code/ABCDEFGHJK/join', {}));
  });
});

describe('the tournament page', () => {
  // The viewer is Cleo — she is in the bracket, so her match has a "Play" button.
  const detail = {
    tournament: summary({ status: 'running' }),
    players: [
      { user_id: 1, display_name: 'Anna', avatar_emoji: '♟', username: 'anna', seed: 1, points: 1, status: 'joined' },
      { user_id: 2, display_name: 'Ben', avatar_emoji: '♞', username: 'ben', seed: 2, points: 0, status: 'eliminated' },
      { user_id: 3, display_name: 'Cleo', avatar_emoji: '♛', username: 'cleo', seed: 3, points: 0, status: 'joined' },
    ],
    rounds: [{
      round: 1,
      matches: [
        {
          id: 11, round: 1, position: 0, white: side('Anna', 1), black: side('Ben', 2),
          result: '1-0', status: 'finished', is_bot_match: false, game_id: 5, my_color: null,
        },
        {
          id: 12, round: 1, position: 1, white: side('Cleo', 3), black: botSide,
          result: null, status: 'pending', is_bot_match: true, game_id: null, my_color: 'white',
        },
      ],
    }],
    my_matches: [
      {
        id: 12, round: 1, position: 1, white: side('Cleo', 3), black: botSide,
        result: null, status: 'pending', is_bot_match: true, game_id: null, my_color: 'white',
      },
    ],
  };

  it('shows the bracket and the standings', async () => {
    get.mockResolvedValue(detail);
    renderTournament();

    expect(await screen.findByText('Familienpokal')).toBeTruthy();
    expect(screen.getByText('Runde 1')).toBeTruthy();
    expect(screen.getAllByText('Anna').length).toBeGreaterThan(0);
    expect(screen.getByText('Stockfish')).toBeTruthy();
    expect(screen.getByText('Tabelle')).toBeTruthy();
    expect(screen.getByText('Ausgeschieden')).toBeTruthy();
  });

  it('offers the match that is still open', async () => {
    get.mockResolvedValue(detail);
    renderTournament();

    expect(await screen.findByText('Deine Partie')).toBeTruthy();
    expect(screen.getByText(/gegen den Bot/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Spielen/ }).length).toBeGreaterThan(0);
  });

  it('claims the game before opening it, so an untouched pairing stays out of the game list', async () => {
    const humanMatch = {
      id: 13, round: 2, position: 0, white: side('Cleo', 3), black: side('Anna', 1),
      result: null, status: 'pending', is_bot_match: false, game_id: null, my_color: 'white',
    };
    get.mockResolvedValue({
      ...detail,
      rounds: [{ round: 2, matches: [humanMatch] }],
      my_matches: [humanMatch],
    });
    post.mockResolvedValue({ match: { match_id: 13, game_id: 77, color: 'white', opponent_name: 'Anna' } });
    renderTournament();

    const buttons = await screen.findAllByRole('button', { name: /Spielen/ });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tournaments/matches/13/claim'));
  });

  it('waits for the admin before the bracket appears', async () => {
    get.mockResolvedValue({
      ...detail,
      tournament: summary({ status: 'open' }),
      rounds: [],
      my_matches: [],
    });
    renderTournament();

    expect(await screen.findByText('Warten auf den Start')).toBeTruthy();
    expect(screen.getByText(/Die Tabelle erscheint hier/)).toBeTruthy();
  });

  it('offers a seat while the tournament has not started', async () => {
    get.mockResolvedValue({
      ...detail,
      tournament: summary({ status: 'open' }),
      rounds: [],
      my_matches: [],
      // Cleo is not in it yet.
      players: [
        { user_id: 1, display_name: 'Anna', avatar_emoji: '♟', username: 'anna', seed: 0, points: 0, status: 'joined' },
      ],
    });
    renderTournament();

    expect(await screen.findByText('Warten auf den Start')).toBeTruthy();
    const joinButton = screen.getByRole('button', { name: /Beitreten/ });
    fireEvent.click(joinButton);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tournaments/1/join', {}));
  });

  it('says that a started tournament takes no new players', async () => {
    get.mockResolvedValue({
      ...detail,
      tournament: summary({ status: 'running' }),
      rounds: [],
      my_matches: [],
      players: [
        { user_id: 1, display_name: 'Anna', avatar_emoji: '♟', username: 'anna', seed: 1, points: 0, status: 'joined' },
      ],
    });
    renderTournament();

    expect(await screen.findByText('Keine neuen Spieler')).toBeTruthy();
    expect(screen.getByText(/die Plätze sind vergeben/)).toBeTruthy();
    // And no way to join.
    expect(screen.queryByRole('button', { name: /Beitreten/ })).toBeNull();
  });
});

describe('the invitation link', () => {
  /** The join page reads the tournament by code and joins the viewer. */
  function renderJoin() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/tournaments/join/ABCDEFGHJK']}>
          <Routes>
            <Route path="/tournaments/join/:code" element={<TournamentJoin />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('lets a signed-in player join with one click', async () => {
    get.mockResolvedValue({ tournament: summary({ status: 'open', participants: 2 }) });
    post.mockResolvedValue({ tournament: summary({ status: 'open' }) });
    renderJoin();

    expect(await screen.findByText('Familienpokal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Beitreten/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tournaments/code/ABCDEFGHJK/join', {}));
  });

  it('asks a guest to sign in first', async () => {
    viewer.current = null;
    get.mockResolvedValue({ tournament: summary({ status: 'open' }) });
    renderJoin();

    expect(await screen.findByText(/Melde dich an/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Anmelden/ })).toBeTruthy();
  });

  it('tells a guest that the tournament has already started', async () => {
    viewer.current = null;
    get.mockResolvedValue({ tournament: summary({ status: 'running' }) });
    renderJoin();

    expect(await screen.findByText(/die Plätze sind vergeben/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Turnier ansehen/ })).toBeTruthy();
  });
});
