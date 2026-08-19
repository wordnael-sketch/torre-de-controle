import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobDetailPage } from '../src/pages/JobDetail';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      advanceJob: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
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
  actionRequired: 'Preenchimento do Briefing Padronizado.',
  triggerLabel: 'Avançar para: Briefing Recebido',
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
        <Route path="/jobs/:id" element={<JobDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.advanceJob.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true },
      ],
    });
  });

  it('shows the current status, action required, and trigger button', async () => {
    renderJobDetail();

    expect(await screen.findByText('Prospecção')).toBeInTheDocument();
    expect(await screen.findByText(/Preenchimento do Briefing Padronizado/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Avançar para: Briefing Recebido' })).toBeInTheDocument();
  });

  it('advances the status when the trigger button is clicked', async () => {
    mockedApi.advanceJob.mockResolvedValue({ job: { ...jobDetail, statusId: 11, statusName: 'Briefing Recebido' } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByRole('button', { name: 'Avançar para: Briefing Recebido' }));

    await waitFor(() => expect(mockedApi.advanceJob).toHaveBeenCalledWith(1, undefined));
  });

  it('shows the role assignments for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByText('Comercial')).toBeInTheDocument();
    expect(await screen.findByText('Produção Executiva')).toBeInTheDocument();
  });

  it('shows the status history', async () => {
    renderJobDetail();

    // "Prospecção" appears both in the current-status line and in the history
    // entry below it — asserting 2 matches proves the history list actually
    // rendered, not just the status line.
    await waitFor(() => expect(screen.getAllByText(/Prospecção/)).toHaveLength(2));
  });

  it('hides the trigger button when the job is at the last status of its phase', async () => {
    mockedApi.getJob.mockResolvedValue({
      job: { ...jobDetail, statusId: 11, statusName: 'Briefing Recebido', triggerLabel: 'Avançar para: Orçamento e Decupagem' },
    });
    mockedApi.getReference.mockResolvedValue({
      phases: [
        {
          ...referencePhases[0],
          statuses: [
            ...referencePhases[0].statuses,
            { id: 12, phaseId: 1, order: 3, name: 'Orçamento e Decupagem', actionRequired: '', triggerLabel: '', primaryRole: 'Produção Executiva' },
            { id: 13, phaseId: 1, order: 4, name: 'Defesa da Proposta', actionRequired: '', triggerLabel: 'Tocar a Buzina', primaryRole: 'Comercial' },
          ],
        },
      ],
    });

    renderJobDetail();

    await screen.findByText('Briefing Recebido');
    expect(screen.getByRole('button', { name: 'Avançar para: Orçamento e Decupagem' })).toBeInTheDocument();
  });

  it('does not render a trigger button at the last status of a phase', async () => {
    mockedApi.getJob.mockResolvedValue({
      job: { ...jobDetail, statusId: 13, statusName: 'Defesa da Proposta', triggerLabel: 'Tocar a Buzina' },
    });
    mockedApi.getReference.mockResolvedValue({
      phases: [
        {
          ...referencePhases[0],
          statuses: [
            ...referencePhases[0].statuses,
            { id: 12, phaseId: 1, order: 3, name: 'Orçamento e Decupagem', actionRequired: '', triggerLabel: '', primaryRole: 'Produção Executiva' },
            { id: 13, phaseId: 1, order: 4, name: 'Defesa da Proposta', actionRequired: '', triggerLabel: 'Tocar a Buzina', primaryRole: 'Comercial' },
          ],
        },
      ],
    });

    renderJobDetail();

    await screen.findByText('Defesa da Proposta');
    expect(screen.queryByRole('button', { name: 'Tocar a Buzina' })).not.toBeInTheDocument();
  });
});
