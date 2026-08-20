import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
      getJob: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const twoPhases = [
  { id: 1, order: 1, name: 'Comercial e Orçamento', roles: ['Comercial'], statuses: [] },
  { id: 2, order: 2, name: 'Dotação e Burocracia', roles: ['Financeiro'], statuses: [] },
];

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
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
    alertLevel: 'green' as const,
    highlightedPersonName: 'Anne',
    bolaCom: 'ilha' as const,
    lastWhatsappActivityAt: null,
    actionRequired: null,
    triggerLabel: 'Avançar para: Briefing Recebido',
    bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 1 },
    ...overrides,
  };
}

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
    mockedApi.getJob.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
  });

  it('shows a fase filter row per phase and no jobs when empty', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    renderBoard();

    expect(await screen.findByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Dotação e Burocracia')).toBeInTheDocument();
  });

  it('lists a job in the table with its name, phase, and bola-com tag', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });

    renderBoard();

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
    expect(await screen.findByText(/F1 · Comercial e Orçamento/)).toBeInTheDocument();
    expect(await screen.findByText('Anne')).toBeInTheDocument();
  });

  it('creates a job via the new-job form and refreshes the board', async () => {
    mockedApi.listJobs.mockResolvedValueOnce({ jobs: [] }).mockResolvedValueOnce({ jobs: [makeJob({ name: 'Novo job', client: null, highlightedPersonName: null })] });
    mockedApi.createJob.mockResolvedValue({ job: makeJob({ name: 'Novo job' }) });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText('Novo job')).toBeInTheDocument();
  });

  it('does not show a completed job on the board', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ name: 'Job Concluído Teste', completedAt: '2026-08-18T00:00:00.000Z' })] });

    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    expect(screen.queryByText('Job Concluído Teste')).not.toBeInTheDocument();
  });

  it('shows a stuck-jobs banner for jobs with a red alertLevel', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ alertLevel: 'red', bolaCom: 'cliente', bolaComDayCounts: { ilhaDays: 2, clienteDays: 9, currentSide: 'cliente', currentStreakDays: 9 } })],
    });

    renderBoard();

    expect(await screen.findByText(/JOB TRAVADO/)).toBeInTheDocument();
    expect(await screen.findByText(/9 dias com o cliente/)).toBeInTheDocument();
  });

  it('filters the table when a fase filter row is clicked', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ id: 1, name: 'Job Fase 1' }), makeJob({ id: 2, name: 'Job Fase 2', phaseId: 2, phaseName: 'Dotação e Burocracia' })],
    });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job Fase 1');
    await screen.findByText('Job Fase 2');

    await user.click(screen.getByText('Dotação e Burocracia'));

    expect(screen.queryByText('Job Fase 1')).not.toBeInTheDocument();
    expect(screen.getByText('Job Fase 2')).toBeInTheDocument();
  });

  it('keeps the job table visible when a job is open in the drawer', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 42, name: 'Job Aberto Teste' })] });
    mockedApi.getJob.mockResolvedValue({
      job: {
        id: 42,
        name: 'Job Aberto Teste',
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
        bolaCom: 'ilha',
        lastWhatsappActivityAt: null,
        actionRequired: null,
        triggerLabel: null,
        bolaComDayCounts: { ilhaDays: 0, clienteDays: 0, currentSide: 'ilha', currentStreakDays: 0 },
        roleAssignments: [],
        statusHistory: [],
      },
    });

    render(
      <MemoryRouter initialEntries={['/jobs/42']}>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/jobs/:id" element={<Board />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const matches = await screen.findAllByText('Job Aberto Teste');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('cell', { name: /Job Aberto Teste/ })).toBeInTheDocument();
  });

  it('refetches the job list when the drawer closes, so edits made inside it are reflected', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 42, name: 'Job Aberto Teste' })] });
    mockedApi.getJob.mockResolvedValue({
      job: {
        id: 42,
        name: 'Job Aberto Teste',
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
        bolaCom: 'ilha',
        lastWhatsappActivityAt: null,
        actionRequired: null,
        triggerLabel: null,
        bolaComDayCounts: { ilhaDays: 0, clienteDays: 0, currentSide: 'ilha', currentStreakDays: 0 },
        roleAssignments: [],
        statusHistory: [],
      },
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/jobs/42']}>
        <Routes>
          <Route path="/" element={<Board />} />
          <Route path="/jobs/:id" element={<Board />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('dialog');
    expect(mockedApi.listJobs).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Fechar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(mockedApi.listJobs).toHaveBeenCalledTimes(2));
  });
});
