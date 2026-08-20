import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Board } from '../src/pages/Board';
import { api, ApiError } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
      listJobs: vi.fn(),
      createJob: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

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
  bolaCom: 'ilha' as const,
  lastWhatsappActivityAt: null,
  actionRequired: 'Preenchimento do Briefing Padronizado.',
  triggerLabel: 'Avançar para: Briefing Recebido',
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
    <MemoryRouter initialEntries={['/jobs/1']}>
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/jobs/:id" element={<Board />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true },
      ],
    });
  });

  it('shows the job name, phase, and checklist for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByText('Colgate - Color Correct Wave 2')).toBeInTheDocument();
    expect(await screen.findByText(/FASE 1/)).toBeInTheDocument();
    expect(await screen.findByText('1/2')).toBeInTheDocument();
  });

  it('moves keyboard focus to the close button once the job has loaded', async () => {
    renderJobDetail();

    await screen.findByText('Colgate - Color Correct Wave 2');

    expect(screen.getByRole('button', { name: 'Fechar' })).toHaveFocus();
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

    await screen.findByText('Colgate - Color Correct Wave 2');
    expect(screen.queryByText(/dias com a Ilha/)).not.toBeInTheDocument();
  });

  it('does not show the WhatsApp inactivity line when lastWhatsappActivityAt is null', async () => {
    renderJobDetail();

    await screen.findByText('Colgate - Color Correct Wave 2');
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

    // Scope queries to the JobDetail panel: Board's sidebar also renders a phase
    // filter button named "Encerramento" from the same reference data.
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByText('Encerramento'));
    await user.click(within(panel).getByText('Arquivamento'));

    expect(await screen.findByText('Concluir job')).toBeInTheDocument();
    expect(mockedApi.setJobStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(mockedApi.setJobStatus).toHaveBeenCalledWith(1, 99));
  });
});
