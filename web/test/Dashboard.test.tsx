import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../src/pages/Dashboard';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

describe('Dashboard', () => {
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
  });

  it('shows a message when there are no jobs', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    render(<Dashboard />);

    expect(await screen.findByText('Nenhum job cadastrado ainda.')).toBeInTheDocument();
  });

  it('lists jobs returned by the API', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        {
          id: 1,
          name: 'Colgate - Color Correct Wave 2',
          code: '0307-2026',
          client: 'Colgate',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    });

    render(<Dashboard />);

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
  });

  it('creates a job and refreshes the list', async () => {
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
      },
    });

    const user = userEvent.setup();
    render(<Dashboard />);

    await screen.findByText('Nenhum job cadastrado ainda.');

    await user.type(screen.getByLabelText('Nome'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar job' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText(/Novo job/)).toBeInTheDocument();
  });
});
