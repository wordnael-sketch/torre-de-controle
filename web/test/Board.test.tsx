import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
      setAtendimento: vi.fn(),
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
    atendimentoPersonId: null,
    atendimentoPersonName: null,
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
    mockedApi.listPeople.mockResolvedValue({ people: [] });
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setAtendimento.mockReset();
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
    mockedApi.listPeople.mockResolvedValue({
      people: [{ id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' }],
    });
    mockedApi.createJob.mockResolvedValue({ job: makeJob({ name: 'Novo job' }) });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Novo job');
    await user.selectOptions(screen.getByLabelText('Atendimento responsável'), '7');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job', atendimentoPersonId: 7 }),
    );
    expect(await screen.findByText('Novo job')).toBeInTheDocument();
  });

  it('does not submit the new-job form without an Atendimento responsável selected', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Comercial e Orçamento');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Job Sem Atendimento');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(screen.getByText('Selecione o Atendimento responsável.')).toBeInTheDocument();
    expect(mockedApi.createJob).not.toHaveBeenCalled();
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
        atendimentoPersonId: null,
        atendimentoPersonName: null,
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
        atendimentoPersonId: null,
        atendimentoPersonName: null,
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

  it('shows an Atendimentos row per active person, counting active and completed jobs together', async () => {
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' },
        { id: 8, name: 'Camila', area: 'Atendimento', active: true, title: 'Executiva de Contas' },
        { id: 9, name: 'Ex-Atendimento', area: 'Atendimento', active: false, title: null },
      ],
    });
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, atendimentoPersonId: 7, atendimentoPersonName: 'Wilka' }),
        makeJob({ id: 2, atendimentoPersonId: 7, atendimentoPersonName: 'Wilka', completedAt: '2026-08-18T00:00:00.000Z' }),
        makeJob({ id: 3, atendimentoPersonId: 8, atendimentoPersonName: 'Camila' }),
      ],
    });

    renderBoard();

    const atendimentosNav = await screen.findByRole('navigation', { name: 'Filtro por atendimento' });
    expect(within(atendimentosNav).getByText('Wilka')).toBeInTheDocument();
    expect(within(atendimentosNav).getByRole('button', { name: /Wilka/ })).toHaveTextContent('2');
    expect(within(atendimentosNav).getByRole('button', { name: /Camila/ })).toHaveTextContent('1');
    expect(within(atendimentosNav).queryByText('Ex-Atendimento')).not.toBeInTheDocument();
  });

  it('filters the table to one Atendimento responsável when their row is clicked', async () => {
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' },
        { id: 8, name: 'Camila', area: 'Atendimento', active: true, title: 'Executiva de Contas' },
      ],
    });
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job da Wilka', atendimentoPersonId: 7, atendimentoPersonName: 'Wilka' }),
        makeJob({ id: 2, name: 'Job da Camila', atendimentoPersonId: 8, atendimentoPersonName: 'Camila' }),
      ],
    });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job da Wilka');
    await screen.findByText('Job da Camila');

    const atendimentosNav = screen.getByRole('navigation', { name: 'Filtro por atendimento' });
    await user.click(within(atendimentosNav).getByRole('button', { name: /Camila/ }));

    expect(screen.queryByText('Job da Wilka')).not.toBeInTheDocument();
    expect(screen.getByText('Job da Camila')).toBeInTheDocument();
  });

  it('matches jobs by Atendimento responsável name in the search box', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job A', client: null, highlightedPersonName: null, atendimentoPersonName: 'Larissa (Brasília)' }),
        makeJob({ id: 2, name: 'Job B', client: null, highlightedPersonName: null, atendimentoPersonName: 'Karina' }),
      ],
    });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job A');
    await user.type(screen.getByLabelText('Buscar'), 'Larissa');

    expect(screen.getByText('Job A')).toBeInTheDocument();
    expect(screen.queryByText('Job B')).not.toBeInTheDocument();
  });
});
