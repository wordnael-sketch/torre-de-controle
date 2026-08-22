import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobDetailPage } from '../src/pages/JobDetail';
import { AuthProvider } from '../src/auth/AuthContext';
import { api, ApiError } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      setBoardDensity: vi.fn(),
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setAtendimento: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getTrelloCandidates: vi.fn(),
      getAllTrelloCards: vi.fn(),
      setTrelloLink: vi.fn(),
      syncTrello: vi.fn(),
      deleteJob: vi.fn(),
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

const jobDetail = {
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
  atendimentoPersonId: 7,
  atendimentoPersonName: 'Wilka',
  bolaCom: 'ilha' as const,
  lastWhatsappActivityAt: null,
  actionRequired: 'Preenchimento do Briefing Padronizado.',
  triggerLabel: 'Avançar para: Briefing Recebido',
  trelloCardId: null,
  trelloAutoUnlinkedAt: null,
  trelloStatusUpdates: [],
  trelloChecklistItems: [],
  bolaComDayCounts: { ilhaDays: 3, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 3 },
  roleAssignments: [
    { area: 'Comercial', personId: 5, personName: 'Anne' },
    { area: 'Produção Executiva', personId: null, personName: null },
  ],
  statusHistory: [
    { id: 1, fromStatusId: null, toStatusId: 10, changedAt: '2026-08-18T00:00:00.000Z', note: null },
  ],
};

const referencePhases = [
  {
    id: 1,
    order: 1,
    name: 'Comercial e Orçamento',
    roles: ['Comercial', 'Produção Executiva'],
    statuses: [
      { id: 10, phaseId: 1, order: 1, name: 'Prospecção', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
      { id: 11, phaseId: 1, order: 2, name: 'Briefing Recebido', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
    ],
  },
];

function renderJobDetail() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/jobs/1']}>
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    mockedApi.me.mockReset();
    mockedApi.me.mockResolvedValue({ user: loggedInUser });
    mockedApi.setBoardDensity.mockReset();
    mockedApi.setBoardDensity.mockResolvedValue({ user: loggedInUser });
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setAtendimento.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.getTrelloCandidates.mockReset();
    mockedApi.getAllTrelloCards.mockReset();
    mockedApi.setTrelloLink.mockReset();
    mockedApi.syncTrello.mockReset();
    mockedApi.deleteJob.mockReset();
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true, title: null },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true, title: null },
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' },
      ],
    });
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
  });

  it('shows a breadcrumb back to the Dashboard, with the job name as the current page', async () => {
    const user = userEvent.setup();
    renderJobDetail();

    const breadcrumb = await screen.findByRole('navigation', { name: 'Navegação' });
    expect(within(breadcrumb).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(within(breadcrumb).getByText('Colgate - Color Correct Wave 2')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(within(breadcrumb).getByRole('link', { name: 'Dashboard' }));

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('shows the job name, phase, and checklist for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' })).toBeInTheDocument();
    expect(await screen.findByText(/FASE 1/)).toBeInTheDocument();
    expect(await screen.findByText('1/2')).toBeInTheDocument();
  });

  it('moves keyboard focus to the job title once the page has loaded', async () => {
    renderJobDetail();

    const heading = await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });

    expect(heading).toHaveFocus();
  });

  it('advances the status when an unchecked checklist item is clicked', async () => {
    // referencePhases has a single phase, so its last status (11) would otherwise be
    // treated as the final status of the whole flow (see isFinalStatus in JobDetail.tsx)
    // and require confirmation. Add a trailing phase so this test exercises the plain,
    // non-final status advance it's meant to cover.
    mockedApi.getReference.mockResolvedValue({
      phases: [
        ...referencePhases,
        {
          id: 2,
          order: 2,
          name: 'Produção',
          roles: [],
          statuses: [
            { id: 20, phaseId: 2, order: 1, name: 'Em produção', actionRequired: '', triggerLabel: '', primaryRole: '' },
          ],
        },
      ],
    });
    mockedApi.setJobStatus.mockResolvedValue({ job: { ...jobDetail, statusId: 11 } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Briefing Recebido'));

    await waitFor(() => expect(mockedApi.setJobStatus).toHaveBeenCalledWith(1, 11));
  });

  it('shows the role assignment dropdowns for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByLabelText('Comercial')).toBeInTheDocument();
    expect(await screen.findByLabelText('Produção Executiva')).toBeInTheDocument();
  });

  it('shows the Atendimento responsável name and title', async () => {
    renderJobDetail();

    expect(await screen.findByLabelText('Atendimento responsável')).toHaveValue('7');
    expect(screen.getByRole('option', { name: 'Wilka · Head' })).toBeInTheDocument();
  });

  it('shows a warning when no Atendimento responsável is assigned', async () => {
    mockedApi.getJob.mockResolvedValue({
      job: { ...jobDetail, atendimentoPersonId: null, atendimentoPersonName: null },
    });

    renderJobDetail();

    expect(
      await screen.findByText('Nenhum Atendimento responsável atribuído — selecione um acima.'),
    ).toBeInTheDocument();
  });

  it('shows a warning when the job was auto-unlinked from Trello (card archived/deleted)', async () => {
    mockedApi.getJob.mockResolvedValue({
      job: { ...jobDetail, trelloAutoUnlinkedAt: '2026-08-21T00:00:00.000Z' },
    });

    renderJobDetail();

    expect(await screen.findByText(/Desvinculado do Trello automaticamente/)).toBeInTheDocument();
  });

  it('does not show the auto-unlink warning for a job that was never auto-unlinked', async () => {
    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    expect(screen.queryByText(/Desvinculado do Trello automaticamente/)).not.toBeInTheDocument();
  });

  it('reassigns the Atendimento responsável via the select', async () => {
    mockedApi.setAtendimento.mockResolvedValue({ job: { ...jobDetail, atendimentoPersonId: 7 } });
    const user = userEvent.setup();

    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    await user.selectOptions(screen.getByLabelText('Atendimento responsável'), '7');

    await waitFor(() => expect(mockedApi.setAtendimento).toHaveBeenCalledWith(1, 7));
  });

  it('toggles bola-com when a toggle button is clicked', async () => {
    mockedApi.setBolaCom.mockResolvedValue({
      job: { ...jobDetail, bolaCom: 'cliente' },
      bolaComDayCounts: { ilhaDays: 3, clienteDays: 0, currentSide: 'cliente', currentStreakDays: 0 },
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByRole('button', { name: /Bola com o cliente/ }));

    await waitFor(() => expect(mockedApi.setBolaCom).toHaveBeenCalledWith(1, 'cliente'));
  });

  it('shows the stuck warning only when alertLevel is red', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, alertLevel: 'red' } });

    renderJobDetail();

    const warning = await screen.findByText(/dias com a Ilha/);
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).not.toMatch(/parado/);
  });

  it('does not show the stuck warning when alertLevel is yellow', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, alertLevel: 'yellow' } });

    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    expect(screen.queryByText(/dias com a Ilha/)).not.toBeInTheDocument();
  });

  it('does not show the WhatsApp inactivity line when lastWhatsappActivityAt is null', async () => {
    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    expect(screen.queryByText(/Grupo sem movimento/)).not.toBeInTheDocument();
  });

  it('shows the WhatsApp inactivity line when lastWhatsappActivityAt is set', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, lastWhatsappActivityAt: twoHoursAgo } });

    renderJobDetail();

    expect(await screen.findByText(/Grupo sem movimento há/)).toBeInTheDocument();
  });

  it('classifies pasted text and shows suggestions', async () => {
    mockedApi.classifyJob.mockResolvedValue({
      suggestions: [
        { tipo: 'checklist_item', valor: 'Briefing Recebido', confidence: 0.7, evidencia: 'texto', outcome: 'pendente' },
      ],
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.type(await screen.findByLabelText('Colar mensagens do WhatsApp'), 'Briefing recebido ontem');
    await user.click(screen.getByRole('button', { name: 'Analisar com IA' }));

    await waitFor(() => expect(mockedApi.classifyJob).toHaveBeenCalledWith(1, 'Briefing recebido ontem'));
    expect(await screen.findByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
  });

  it('shows a specific message when the AI classifier is not configured (503)', async () => {
    mockedApi.classifyJob.mockRejectedValue(new ApiError(503, 'ia_nao_configurada'));
    const user = userEvent.setup();

    renderJobDetail();

    await user.type(await screen.findByLabelText('Colar mensagens do WhatsApp'), 'Briefing recebido ontem');
    await user.click(screen.getByRole('button', { name: 'Analisar com IA' }));

    expect(
      await screen.findByText('A classificação por IA ainda não está configurada neste ambiente.'),
    ).toBeInTheDocument();
  });

  it('shows a confirmation dialog before completing the job at the final status', async () => {
    const finalPhaseReference = [
      ...referencePhases,
      {
        id: 2,
        order: 2,
        name: 'Encerramento',
        roles: [],
        statuses: [
          { id: 99, phaseId: 2, order: 1, name: 'Arquivamento', actionRequired: '', triggerLabel: '', primaryRole: '' },
        ],
      },
    ];
    mockedApi.getReference.mockResolvedValue({ phases: finalPhaseReference });
    mockedApi.setJobStatus.mockResolvedValue({ job: { ...jobDetail, statusId: 99 } });
    const user = userEvent.setup();

    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    await user.click(screen.getByText('Encerramento'));
    await user.click(screen.getByText('Arquivamento'));

    expect(await screen.findByText('Concluir job')).toBeInTheDocument();
    expect(mockedApi.setJobStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(mockedApi.setJobStatus).toHaveBeenCalledWith(1, 99));
  });

  it('pressing Escape while the completion confirmation is open only dismisses the confirmation, not the page', async () => {
    const finalPhaseReference = [
      ...referencePhases,
      {
        id: 2,
        order: 2,
        name: 'Encerramento',
        roles: [],
        statuses: [
          { id: 99, phaseId: 2, order: 1, name: 'Arquivamento', actionRequired: '', triggerLabel: '', primaryRole: '' },
        ],
      },
    ];
    mockedApi.getReference.mockResolvedValue({ phases: finalPhaseReference });
    const user = userEvent.setup();

    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    await user.click(screen.getByText('Encerramento'));
    await user.click(screen.getByText('Arquivamento'));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockedApi.setJobStatus).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Colgate - Color Correct Wave 2' })).toBeInTheDocument();
  });

  it('shows the Trello card faithfully: description with a clickable link, labels, people, and a link to open it', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026', strongMatch: true },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: {
        name: 'WPP:: COLGATE:: CAMPANHA',
        listName: 'Em Captação 2026',
        description: 'Briefing: https://drive.google.com/drive/folders/abc123',
        url: 'https://trello.com/c/card1',
        labels: [{ name: 'Vicky Salles', color: 'purple' }],
        members: ['Wilka Nepomoceno'],
        people: ['Wilka Nepomoceno', 'Vicky Salles'],
      },
    });

    renderJobDetail();

    expect(await screen.findByRole('link', { name: 'abrir no Trello' })).toHaveAttribute(
      'href',
      'https://trello.com/c/card1',
    );
    expect(screen.getByText('Vicky Salles')).toBeInTheDocument();
    expect(screen.getByText(/Pessoas envolvidas:/).closest('p')).toHaveTextContent(
      'Wilka Nepomoceno, Vicky Salles',
    );
    expect(screen.getByRole('link', { name: 'https://drive.google.com/drive/folders/abc123' })).toHaveAttribute(
      'href',
      'https://drive.google.com/drive/folders/abc123',
    );
  });

  it('auto-links when exactly one strong Trello match is found', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026', strongMatch: true },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });

    renderJobDetail();

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card1'));
    expect(await screen.findByText(/Vinculado ao card: WPP:: COLGATE:: CAMPANHA/)).toBeInTheDocument();
  });

  it('auto-links to the candidate whose name exactly matches the job name, even with other ambiguous candidates', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card-parecido', name: 'Colgate - Color Correct Wave 2 Extra', listName: 'Em Orçamento 2026', strongMatch: false },
        { id: 'card-exato', name: '  colgate - color correct wave 2  ', listName: 'Em Captação 2026', strongMatch: false },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card-exato' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: '  colgate - color correct wave 2  ', listName: 'Em Captação 2026' },
    });

    renderJobDetail();

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card-exato'));
    expect(screen.queryByText('Vincular ao card do Trello')).not.toBeInTheDocument();
  });

  it('shows a picker when multiple Trello candidates are found', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA A', listName: 'Em Captação 2026', strongMatch: false },
        { id: 'card2', name: 'WPP:: COLGATE:: CAMPANHA B', listName: 'Concluído', strongMatch: false },
      ],
    });

    renderJobDetail();

    expect(await screen.findByText('Vincular ao card do Trello')).toBeInTheDocument();
    expect(screen.getByText(/CAMPANHA A/)).toBeInTheDocument();
    expect(screen.getByText(/CAMPANHA B/)).toBeInTheDocument();
  });

  it('links to the chosen card when a picker option is clicked', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA A', listName: 'Em Captação 2026', strongMatch: false },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText(/CAMPANHA A/));

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card1'));
  });

  it('syncs automatically and shows the linked card indicator when already linked', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.9,
          evidencia: 'Trello',
          outcome: 'auto_aplicado',
        },
      ],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });

    renderJobDetail();

    await waitFor(() => expect(mockedApi.syncTrello).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Vinculado ao card: WPP:: COLGATE:: CAMPANHA/)).toBeInTheDocument();
  });

  it('still refreshes the job after an already-linked auto-sync fails, so partially-saved data (comments etc.) is not hidden', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockRejectedValue(new ApiError(502, 'trello_api_error'));

    renderJobDetail();

    await waitFor(() => expect(mockedApi.syncTrello).toHaveBeenCalledWith(1));
    // getJob: uma vez no carregamento inicial, outra depois da tentativa de
    // sync (mesmo tendo falhado) — é exatamente o refresh que faltava.
    await waitFor(() => expect(mockedApi.getJob).toHaveBeenCalledTimes(2));
  });

  it('unlinks the Trello card when the unlink action is clicked', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: null } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('desvincular'));

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, null));
  });

  it('shows every board card when "Vincular ao Trello" is clicked, even with zero scored candidates', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
    mockedApi.getAllTrelloCards.mockResolvedValue({
      cards: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
        { id: 'card2', name: 'NOVA :: SESCOOP :: LICITAÇÃO', listName: 'Concluído' },
      ],
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Vincular ao Trello'));

    await waitFor(() => expect(mockedApi.getAllTrelloCards).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/WPP:: COLGATE:: CAMPANHA/)).toBeInTheDocument();
    expect(screen.getByText(/NOVA :: SESCOOP :: LICITAÇÃO/)).toBeInTheDocument();
  });

  it('filters the full card list as the search field is typed into', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
    mockedApi.getAllTrelloCards.mockResolvedValue({
      cards: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
        { id: 'card2', name: 'NOVA :: SESCOOP :: LICITAÇÃO', listName: 'Concluído' },
      ],
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Vincular ao Trello'));
    await screen.findByText(/WPP:: COLGATE:: CAMPANHA/);

    await user.type(screen.getByLabelText('Buscar card do Trello'), 'sescoop');

    expect(screen.queryByText(/WPP:: COLGATE:: CAMPANHA/)).not.toBeInTheDocument();
    expect(screen.getByText(/NOVA :: SESCOOP :: LICITAÇÃO/)).toBeInTheDocument();
  });

  it('links and immediately syncs when a card is picked from the full list', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
    mockedApi.getAllTrelloCards.mockResolvedValue({
      cards: [{ id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' }],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Vincular ao Trello'));
    await user.click(await screen.findByText(/WPP:: COLGATE:: CAMPANHA/));

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card1'));
    await waitFor(() => expect(mockedApi.syncTrello).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Vinculado ao card: WPP:: COLGATE:: CAMPANHA/)).toBeInTheDocument();
  });

  it('shows an "Excluir job" button for an admin, and deletes the job on confirmation', async () => {
    mockedApi.deleteJob.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Excluir job'));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(mockedApi.deleteJob).toHaveBeenCalledWith(1));
    expect(screen.queryByRole('heading', { name: 'Colgate - Color Correct Wave 2' })).not.toBeInTheDocument();
  });

  it('does not delete the job when the confirmation is cancelled', async () => {
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('Excluir job'));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mockedApi.deleteJob).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Colgate - Color Correct Wave 2' })).toBeInTheDocument();
  });

  it('does not show the "Excluir job" button for a non-admin member', async () => {
    mockedApi.me.mockResolvedValue({ user: { ...loggedInUser, role: 'member' } });

    renderJobDetail();

    await screen.findByRole('heading', { name: 'Colgate - Color Correct Wave 2' });
    expect(screen.queryByText('Excluir job')).not.toBeInTheDocument();
  });
});
