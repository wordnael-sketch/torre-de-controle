import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { GlobalSearch } from '../src/components/GlobalSearch';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      searchJobs: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

function renderGlobalSearch() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<GlobalSearch />} />
        <Route path="/jobs/:id" element={<p>Página do job aberta</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    mockedApi.searchJobs.mockReset();
    mockedApi.searchJobs.mockResolvedValue({ results: [] });
  });

  it('does not call the API for a query shorter than 2 characters', async () => {
    const user = userEvent.setup();
    renderGlobalSearch();

    await user.type(screen.getByRole('combobox', { name: 'Pesquisar no sistema' }), 'a');

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(mockedApi.searchJobs).not.toHaveBeenCalled();
  });

  it('shows matching results in a dropdown after typing, with client and match context', async () => {
    mockedApi.searchJobs.mockResolvedValue({
      results: [
        { id: 1, name: 'Colgate - Wave 2', client: 'Colgate', code: '0307-2026', matchContext: null },
        {
          id: 2,
          name: 'Prefeitura do Rio - Campanha',
          client: null,
          code: null,
          matchContext: 'Comentário do Trello: "…entrega marcada para sexta…"',
        },
      ],
    });
    const user = userEvent.setup();
    renderGlobalSearch();

    await user.type(screen.getByRole('combobox', { name: 'Pesquisar no sistema' }), 'campanha');

    await waitFor(() => expect(mockedApi.searchJobs).toHaveBeenCalledWith('campanha'));
    expect(await screen.findByRole('option', { name: /Colgate - Wave 2/ })).toBeInTheDocument();
    expect(screen.getByText('Colgate · 0307-2026')).toBeInTheDocument();
    expect(screen.getByText('Comentário do Trello: "…entrega marcada para sexta…"')).toBeInTheDocument();
  });

  it('shows a "no results" message when the search comes back empty', async () => {
    mockedApi.searchJobs.mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    renderGlobalSearch();

    await user.type(screen.getByRole('combobox', { name: 'Pesquisar no sistema' }), 'inexistente');

    expect(await screen.findByText('Nenhum resultado.')).toBeInTheDocument();
  });

  it('navigates to the job page when a result is clicked', async () => {
    mockedApi.searchJobs.mockResolvedValue({
      results: [{ id: 42, name: 'Colgate - Wave 2', client: 'Colgate', code: null, matchContext: null }],
    });
    const user = userEvent.setup();
    renderGlobalSearch();

    await user.type(screen.getByRole('combobox', { name: 'Pesquisar no sistema' }), 'colgate');
    const result = await screen.findByRole('button', { name: /Colgate - Wave 2/ });
    await user.click(result);

    expect(await screen.findByText('Página do job aberta')).toBeInTheDocument();
  });

  it('navigates to the highlighted result on ArrowDown + Enter', async () => {
    mockedApi.searchJobs.mockResolvedValue({
      results: [
        { id: 1, name: 'Job Um', client: null, code: null, matchContext: null },
        { id: 2, name: 'Job Dois', client: null, code: null, matchContext: null },
      ],
    });
    const user = userEvent.setup();
    renderGlobalSearch();

    const input = screen.getByRole('combobox', { name: 'Pesquisar no sistema' });
    await user.type(input, 'job');
    await screen.findByRole('option', { name: 'Job Um' });

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(await screen.findByText('Página do job aberta')).toBeInTheDocument();
  });

  it('closes the dropdown on Escape', async () => {
    mockedApi.searchJobs.mockResolvedValue({
      results: [{ id: 1, name: 'Job Um', client: null, code: null, matchContext: null }],
    });
    const user = userEvent.setup();
    renderGlobalSearch();

    const input = screen.getByRole('combobox', { name: 'Pesquisar no sistema' });
    await user.type(input, 'job');
    await screen.findByRole('option', { name: 'Job Um' });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('option', { name: 'Job Um' })).not.toBeInTheDocument();
  });
});
