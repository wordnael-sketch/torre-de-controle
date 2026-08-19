import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Board } from '../src/pages/Board';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getReference: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const twoPhases = [
  { id: 1, order: 1, name: 'Comercial e Orçamento', roles: ['Comercial'], statuses: [] },
  { id: 2, order: 2, name: 'Dotação Financeira e Burocracia (Set-up)', roles: ['Financeiro'], statuses: [] },
];

function renderBoard() {
  return render(
    <MemoryRouter>
      <Board />
    </MemoryRouter>,
  );
}

describe('Board', () => {
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
  });

  it('shows a column per phase and no jobs message when empty', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    renderBoard();

    expect(await screen.findByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Dotação Financeira e Burocracia (Set-up)')).toBeInTheDocument();
  });

  it('places a job card under its phase column with status and highlighted person', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        {
          id: 1,
          name: 'Colgate - Color Correct Wave 2',
          code: '0307-2026',
          client: 'Colgate',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
          statusId: 10,
          statusName: 'Prospecção',
          phaseId: 1,
          phaseName: 'Comercial e Orçamento',
          completedAt: null,
          alertLevel: 'green',
          highlightedPersonName: 'Anne',
        },
      ],
    });

    renderBoard();

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
    expect(await screen.findByText('Prospecção')).toBeInTheDocument();
    expect(await screen.findByText('Anne')).toBeInTheDocument();
  });

  it('creates a job and refreshes the board', async () => {
    mockedApi.listJobs
      .mockResolvedValueOnce({ jobs: [] })
      .mockResolvedValueOnce({
        jobs: [
          {
            id: 1,
            name: 'Novo job',
            code: null,
            client: null,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
            statusId: 10,
            statusName: 'Prospecção',
            phaseId: 1,
            phaseName: 'Comercial e Orçamento',
            completedAt: null,
            alertLevel: 'green',
            highlightedPersonName: null,
          },
        ],
      });
    mockedApi.createJob.mockResolvedValue({
      job: {
        id: 1,
        name: 'Novo job',
        code: null,
        client: null,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
        statusId: 10,
        statusName: 'Prospecção',
        phaseId: 1,
        phaseName: 'Comercial e Orçamento',
        completedAt: null,
        alertLevel: 'green',
        highlightedPersonName: null,
      },
    });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');

    await user.type(screen.getByLabelText('Nome'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar job' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText(/Novo job/)).toBeInTheDocument();
  });

  it('does not show a completed job on the board', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        {
          id: 1,
          name: 'Job Concluído Teste',
          code: null,
          client: null,
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
          statusId: 30,
          statusName: 'Arquivamento',
          phaseId: 2,
          phaseName: 'Dotação Financeira e Burocracia (Set-up)',
          completedAt: '2026-08-18T00:00:00.000Z',
          alertLevel: 'green',
          highlightedPersonName: null,
        },
      ],
    });

    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    expect(screen.queryByText('Job Concluído Teste')).not.toBeInTheDocument();
  });
});
