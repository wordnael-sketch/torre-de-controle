import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Board } from '../src/pages/Board';
import { JobDetailPage } from '../src/pages/JobDetail';
import { AuthProvider } from '../src/auth/AuthContext';
import { ToastHost } from '../src/components/Toast';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      setBoardDensity: vi.fn(),
      listJobs: vi.fn(),
      searchJobs: vi.fn(),
      createJob: vi.fn(),
      setJobName: vi.fn(),
      getReference: vi.fn(),
      getJob: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setAtendimento: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
      getTrelloCandidates: vi.fn(),
      setTrelloLink: vi.fn(),
      syncTrello: vi.fn(),
      linkAllTrelloJobs: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const loggedInUser = {
  id: 1,
  email: 'wilka@ilhacrossmidia.com.br',
  name: 'Wilka',
  role: 'admin' as const,
  status: 'active' as const,
  boardDensity: 'agrupado' as const,
};

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
    atendimentoBackupPersonId: null,
    atendimentoBackupPersonName: null,
    bolaCom: 'ilha' as const,
    lastWhatsappActivityAt: null,
    actionRequired: null,
    triggerLabel: 'Avançar para: Briefing Recebido',
    trelloCardId: null,
    trelloAutoUnlinkedAt: null,
    trelloStatusUpdates: [],
    trelloChecklistItems: [],
    bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 1 },
    ...overrides,
  };
}

async function openFiltersPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Filtros e ações' }));
}

function renderBoard(initialEntries: string[] = ['/']) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Board />
      </MemoryRouter>
      <ToastHost />
    </AuthProvider>,
  );
}

describe('Board', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.me.mockResolvedValue({ user: loggedInUser });
    mockedApi.setBoardDensity.mockReset();
    mockedApi.setBoardDensity.mockResolvedValue({ user: loggedInUser });
    mockedApi.listJobs.mockReset();
    mockedApi.searchJobs.mockReset();
    mockedApi.searchJobs.mockResolvedValue({ results: [] });
    mockedApi.createJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
    mockedApi.getJob.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.listPeople.mockResolvedValue({ people: [] });
    mockedApi.setJobStatus.mockReset();
    mockedApi.setJobName.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setAtendimento.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
    mockedApi.getTrelloCandidates.mockReset();
    mockedApi.setTrelloLink.mockReset();
    mockedApi.syncTrello.mockReset();
    mockedApi.linkAllTrelloJobs.mockReset();
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
  });

  it('shows a fase filter row per phase and no jobs when empty', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
    const user = userEvent.setup();

    renderBoard();
    await openFiltersPanel(user);

    expect(await screen.findByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Dotação e Burocracia')).toBeInTheDocument();
  });

  it('lists a job in the table with its name, phase, and bola-com tag', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });

    renderBoard();

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
    // Visão agrupada (padrão): o nome da fase é o título do grupo, não repete na linha.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Anne')).toBeInTheDocument();
  });

  it('links all jobs to Trello and refreshes the board when "Vincular todos ao Trello" is clicked', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });
    mockedApi.linkAllTrelloJobs.mockResolvedValue({ linkedCount: 2, syncedCount: 5 });
    const user = userEvent.setup();

    renderBoard();
    await screen.findByText(/Colgate - Color Correct Wave 2/);
    await openFiltersPanel(user);

    await user.click(screen.getByRole('button', { name: 'Vincular todos ao Trello' }));

    await waitFor(() => expect(mockedApi.linkAllTrelloJobs).toHaveBeenCalled());
    await waitFor(() => expect(mockedApi.listJobs).toHaveBeenCalledTimes(2));
  });

  it('shows "F{n} · fase" per row in the flat table view', async () => {
    mockedApi.me.mockResolvedValue({ user: { ...loggedInUser, boardDensity: 'plano' } });
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });

    renderBoard();

    expect(await screen.findByText(/F1 · Comercial e Orçamento/)).toBeInTheDocument();
  });

  it('creates a job via the new-job form and refreshes the board', async () => {
    mockedApi.listJobs.mockResolvedValueOnce({ jobs: [] }).mockResolvedValueOnce({ jobs: [makeJob({ name: 'Novo job', client: null, highlightedPersonName: null })] });
    mockedApi.listPeople.mockResolvedValue({
      people: [{ id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' }],
    });
    mockedApi.createJob.mockResolvedValue({ job: makeJob({ name: 'Novo job' }) });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByRole('table');
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

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
    await user.type(screen.getByLabelText('Nome do job'), 'Job Sem Atendimento');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(screen.getByText('Selecione o Atendimento responsável.')).toBeInTheDocument();
    expect(mockedApi.createJob).not.toHaveBeenCalled();
  });

  it('navigates to a full job page (replacing the board) when a job row is clicked', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 42, name: 'Job Aberto Teste' })] });
    mockedApi.getJob.mockResolvedValue({
      job: {
        ...makeJob({ id: 42, name: 'Job Aberto Teste' }),
        roleAssignments: [],
        statusHistory: [],
      },
    });
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Board />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await user.click(await screen.findByRole('link', { name: /Job Aberto Teste/ }));

    expect(await screen.findByRole('heading', { name: 'Job Aberto Teste' })).toBeInTheDocument();
    // O board saiu de cena — não é mais um overlay por cima dele.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('does not show a completed job on the board', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ name: 'Job Concluído Teste', completedAt: '2026-08-18T00:00:00.000Z' })] });

    renderBoard();

    await screen.findByRole('table');
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
    await openFiltersPanel(user);

    const fasePills = screen.getByRole('group', { name: 'Filtro por fase' });
    await user.click(within(fasePills).getByText('Dotação e Burocracia'));

    expect(screen.queryByText('Job Fase 1')).not.toBeInTheDocument();
    expect(screen.getByText('Job Fase 2')).toBeInTheDocument();
  });

  it('seeds the farol filter from a ?farol= URL param, so a Painel card link lands already filtered', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job Travado', alertLevel: 'red' }),
        makeJob({ id: 2, name: 'Job Fluindo', alertLevel: 'green' }),
      ],
    });

    renderBoard(['/?farol=red']);

    await screen.findByText('Job Travado');
    expect(screen.queryByText('Job Fluindo')).not.toBeInTheDocument();
    // O painel de filtros fica fechado mesmo chegando via link filtrado —
    // é grande demais (principalmente no celular) pra abrir sozinho; o chip
    // de "filtro ativo" abaixo é quem avisa que o filtro está aplicado.
    expect(screen.getByRole('button', { name: 'Filtros e ações' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Travado/ })).toBeInTheDocument();
  });

  it('seeds the fase and atendimento filters from URL params the same way', async () => {
    mockedApi.listPeople.mockResolvedValue({
      people: [{ id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' }],
    });
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job da Wilka', phaseId: 2, phaseName: 'Dotação e Burocracia', atendimentoPersonId: 7 }),
        makeJob({ id: 2, name: 'Job de Outra Fase' }),
      ],
    });

    renderBoard(['/?fase=2&atendimento=7']);

    await screen.findByText('Job da Wilka');
    expect(screen.queryByText('Job de Outra Fase')).not.toBeInTheDocument();
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

    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Comercial e Orçamento');
    await openFiltersPanel(user);

    const atendimentosNav = await screen.findByRole('group', { name: 'Filtro por atendimento' });
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
    await openFiltersPanel(user);

    const atendimentosNav = screen.getByRole('group', { name: 'Filtro por atendimento' });
    await user.click(within(atendimentosNav).getByRole('button', { name: /Camila/ }));

    expect(screen.queryByText('Job da Wilka')).not.toBeInTheDocument();
    expect(screen.getByText('Job da Camila')).toBeInTheDocument();
  });

  it('shows a common triggerLabel once in the group header when every job in the phase shares it, hiding it from each row', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job Igual A', triggerLabel: 'Avançar para: Briefing Recebido' }),
        makeJob({ id: 2, name: 'Job Igual B', triggerLabel: 'Avançar para: Briefing Recebido' }),
      ],
    });

    renderBoard();

    await screen.findByText('Job Igual A');
    await screen.findByText('Job Igual B');

    // Aparece uma vez no cabeçalho do grupo...
    expect(screen.getAllByText('Avançar para: Briefing Recebido')).toHaveLength(1);
  });

  it('keeps each row showing its own triggerLabel when jobs in the same phase differ, instead of collapsing to the header', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, name: 'Job Diferente A', triggerLabel: 'Avançar para: Briefing Recebido' }),
        makeJob({ id: 2, name: 'Job Diferente B', triggerLabel: 'Avançar para: Aprovação Interna' }),
      ],
    });

    renderBoard();

    await screen.findByText('Job Diferente A');
    await screen.findByText('Job Diferente B');

    expect(screen.getByText('Avançar para: Briefing Recebido')).toBeInTheDocument();
    expect(screen.getByText('Avançar para: Aprovação Interna')).toBeInTheDocument();
  });

  it('collapses a phase group, hiding its rows, and expands it again', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 1, name: 'Job Colapsável' })] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job Colapsável');

    const table = screen.getByRole('table');
    const groupToggle = within(table).getByRole('button', { name: /Comercial e Orçamento/ });
    await user.click(groupToggle);

    expect(screen.queryByText('Job Colapsável')).not.toBeInTheDocument();

    await user.click(groupToggle);

    expect(await screen.findByText('Job Colapsável')).toBeInTheDocument();
  });

  it('switches to the flat table view and persists the choice via the API', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob()] });
    mockedApi.setBoardDensity.mockResolvedValue({ user: { ...loggedInUser, boardDensity: 'plano' } });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Colgate - Color Correct Wave 2');
    await user.click(screen.getByRole('button', { name: 'Tabela plana' }));

    await waitFor(() => expect(mockedApi.setBoardDensity).toHaveBeenCalledWith('plano'));
    expect(await screen.findByText(/F1 · Comercial e Orçamento/)).toBeInTheDocument();
  });

  it('toggles high-contrast mode on the board container', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByRole('table');
    await openFiltersPanel(user);
    const toggle = screen.getByRole('button', { name: /Alto contraste/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('renames a job inline via the edit button, Enter to confirm, with a toast offering undo', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 1, name: 'Nome Original' })] });
    mockedApi.setJobName.mockResolvedValue({ job: makeJob({ id: 1, name: 'Nome Editado' }) });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Nome Original');
    await user.click(screen.getByRole('button', { name: 'Editar nome do job' }));

    const input = screen.getByLabelText('Editar nome do job');
    await user.clear(input);
    await user.type(input, 'Nome Editado{Enter}');

    await waitFor(() => expect(mockedApi.setJobName).toHaveBeenCalledWith(1, 'Nome Editado'));
    expect(await screen.findByText('Nome Editado')).toBeInTheDocument();
    expect(await screen.findByText('Nome do job atualizado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeInTheDocument();
  });

  it('cancels an inline rename with Escape, without calling the API', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 1, name: 'Nome Original' })] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Nome Original');
    await user.click(screen.getByRole('button', { name: 'Editar nome do job' }));

    const input = screen.getByLabelText('Editar nome do job');
    await user.type(input, ' alterado{Escape}');

    expect(mockedApi.setJobName).not.toHaveBeenCalled();
    expect(await screen.findByText('Nome Original')).toBeInTheDocument();
  });

  it('undoes an inline rename when the toast\'s "Desfazer" button is clicked', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 1, name: 'Nome Original' })] });
    mockedApi.setJobName.mockResolvedValue({ job: makeJob({ id: 1, name: 'Nome Editado' }) });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Nome Original');
    await user.click(screen.getByRole('button', { name: 'Editar nome do job' }));
    const input = screen.getByLabelText('Editar nome do job');
    await user.clear(input);
    await user.type(input, 'Nome Editado{Enter}');
    await screen.findByText('Nome Editado');

    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));

    await waitFor(() => expect(mockedApi.setJobName).toHaveBeenCalledWith(1, 'Nome Original'));
    expect(await screen.findByText('Nome Original')).toBeInTheDocument();
  });

  it('does not enter edit mode on a single click of the job name (only the edit button does)', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [makeJob({ id: 42, name: 'Job Clique Único' })] });
    const user = userEvent.setup();

    renderBoard();

    await screen.findByText('Job Clique Único');
    // A single click just follows the link (no assertion on navigation here —
    // that's covered by the drawer-opening tests elsewhere); what this test
    // guards is that it never triggers the inline editor.
    await user.click(screen.getByText('Job Clique Único'));

    expect(screen.queryByRole('textbox', { name: 'Editar nome do job' })).not.toBeInTheDocument();
  });
});
