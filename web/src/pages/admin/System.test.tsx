// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, put, patch: put, del: vi.fn() } }));

import i18n from '../../i18n';
import AdminSystem from './System';

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => path === '/api/admin/system'
    ? { stockfish_path: '/usr/local/bin/stockfish' }
    : {});
  post.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminSystem /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin → System', () => {
  it('loads the saved Stockfish path and writes a change back', async () => {
    renderPage();
    const input = await screen.findByDisplayValue('/usr/local/bin/stockfish') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/opt/stockfish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledWith('/api/admin/system', expect.objectContaining({ stockfish_path: '/opt/stockfish' }));
    });
  });
});
