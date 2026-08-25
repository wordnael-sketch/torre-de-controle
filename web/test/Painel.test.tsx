import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Painel } from '../src/pages/Painel';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getReference: vi.fn(),
      listJobs: vi.fn(),
      listPeople: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const twoPhases = [
  { id: 1, order: 1, name: 'Comercial e Orçamento', roles: [], statuses: [] },
  { id: 2, order: 4, name: 'Captação', roles: [], statuses: [] },
];

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Job Teste',
    code: null,
    client: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    statusId: 10,
    statusName: 'Prospecção',
    phaseId: 1,
    phaseName: 'Comercial e Orçamento',
    completedAt: null,
    alertLevel: 'green' as const,
    highlightedPersonName: null,
    atendimentoPersonId: null,
    atendimentoPersonName: null,
    atendimentoBackupPersonId: null,
    atendimentoBackupPersonName: null,
    bolaCom: 'ilha' as const,
    lastWhatsappActivityAt: null,
    actionRequired: null,
    triggerLabel: null,
    trelloCardId: null,
    trelloAutoUnlinkedAt: null,
    trelloStatusUpdates: [],
    trelloChecklistItems: [],
    bolaComDayCounts: { ilhaDays: 1, clienteDays: 0, currentSide: 'ilha' as const, currentStreakDays: 1 },
    ...overrides,
  };
}

/** Cada card também tem uma linha equivalente na lista de barras logo abaixo,
 * com o mesmo texto/aria-label — as consultas que testam o card específico
 * (não a lista de barras) precisam se restringir ao grid de cards. */
function cardGridFor(headingName: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingName });
  const section = heading.closest('section') as HTMLElement;
  return section.querySelector('.painel-card-grid') as HTMLElement;
}

function barListFor(headingName: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: headingName });
  const section = heading.closest('section') as HTMLElement;
  return section.querySelector('.painel-bar-list') as HTMLElement;
}

function renderPainel() {
  return render(
    <MemoryRouter>
      <Painel />
    </MemoryRouter>,
  );
}

describe('Painel', () => {
  beforeEach(() => {
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
    mockedApi.listJobs.mockReset();
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
    mockedApi.listPeople.mockReset();
    mockedApi.listPeople.mockResolvedValue({ people: [] });
  });

  it('shows the KPI cards derived from active jobs', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, bolaCom: 'ilha' }),
        makeJob({
          id: 2,
          bolaCom: 'cliente',
          bolaComDayCounts: { ilhaDays: 0, clienteDays: 4, currentSide: 'cliente', currentStreakDays: 4 },
        }),
        makeJob({ id: 3, phaseId: 2, phaseName: 'Captação' }),
        makeJob({ id: 4, completedAt: '2026-08-18T00:00:00.000Z' }),
      ],
    });

    renderPainel();

    expect(await screen.findByRole('heading', { name: 'Painel' })).toBeInTheDocument();
    const kpis = screen.getByLabelText('Indicadores gerais');

    function cardFor(label: string): HTMLElement {
      return within(kpis).getByText(label).closest('.painel-kpi-card') as HTMLElement;
    }

    // ativos: 3 (job 4 está concluído e fica de fora)
    expect(within(cardFor('Em produção')).getByText(/3/)).toBeInTheDocument();
    expect(within(cardFor('Bola com o cliente')).getByText(/1/)).toBeInTheDocument();
    expect(within(cardFor('Retenção do cliente')).getByText(/4/)).toBeInTheDocument();
    expect(within(cardFor('Entram em set')).getByText(/1/)).toBeInTheDocument();
  });

  it('shows a Farol card per level with the active-job count and a link that filters the board', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ id: 1, alertLevel: 'red' }), makeJob({ id: 2, alertLevel: 'red' }), makeJob({ id: 3, alertLevel: 'green' })],
    });

    renderPainel();

    const travadoCard = await screen.findByRole('link', { name: /Ver jobs com farol Travado \(2\)/ });
    expect(travadoCard).toHaveAttribute('href', '/?farol=red');
    const fluindoCard = screen.getByRole('link', { name: /Ver jobs com farol Fluindo \(1\)/ });
    expect(fluindoCard).toHaveAttribute('href', '/?farol=green');
    expect(screen.getByRole('link', { name: /Ver jobs com farol Atenção \(0\)/ })).toHaveAttribute('href', '/?farol=yellow');
  });

  it('shows a Fase card and bar per phase, linking to the board filtered by phase', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [makeJob({ id: 1, phaseId: 2, phaseName: 'Captação' })],
    });

    renderPainel();
    await screen.findByRole('heading', { name: 'Fase' });

    const grid = within(cardGridFor('Fase'));
    const captacaoCard = grid.getByRole('link', { name: /Ver jobs na fase Captação \(1\)/ });
    expect(captacaoCard).toHaveAttribute('href', '/?fase=2');
    const comercialCard = grid.getByRole('link', { name: /Ver jobs na fase Comercial e Orçamento \(0\)/ });
    expect(comercialCard).toHaveAttribute('href', '/?fase=1');
  });

  it('shows an Atendimento card per active person (counting active and completed jobs), hiding inactive people', async () => {
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: 'Head' },
        { id: 8, name: 'Camila', area: 'Atendimento', active: true, title: null },
        { id: 9, name: 'Ex-Atendimento', area: 'Atendimento', active: false, title: null },
      ],
    });
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, atendimentoPersonId: 7 }),
        makeJob({ id: 2, atendimentoPersonId: 7, completedAt: '2026-08-18T00:00:00.000Z' }),
        makeJob({ id: 3, atendimentoPersonId: 8 }),
      ],
    });

    renderPainel();
    await screen.findByRole('heading', { name: 'Atendimento' });

    const grid = within(cardGridFor('Atendimento'));
    const wilkaCard = grid.getByRole('link', { name: /Ver jobs de Wilka \(2\)/ });
    expect(wilkaCard).toHaveAttribute('href', '/?atendimento=7');
    expect(grid.getByRole('link', { name: /Ver jobs de Camila \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByText('Ex-Atendimento')).not.toBeInTheDocument();
  });

  it('lists Atendimento bar rows sorted by count, descending', async () => {
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 7, name: 'Wilka', area: 'Atendimento', active: true, title: null },
        { id: 8, name: 'Camila', area: 'Atendimento', active: true, title: null },
      ],
    });
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        makeJob({ id: 1, atendimentoPersonId: 8 }),
        makeJob({ id: 2, atendimentoPersonId: 7 }),
        makeJob({ id: 3, atendimentoPersonId: 7 }),
      ],
    });

    renderPainel();
    await screen.findByRole('heading', { name: 'Atendimento' });

    const list = barListFor('Atendimento');
    const rowLabels = within(list).getAllByText(/^(Wilka|Camila)$/);
    expect(rowLabels.map((el) => el.textContent)).toEqual(['Wilka', 'Camila']);
  });

  it('shows an empty-state message for the Farol distribution bar when there are no active jobs', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    renderPainel();

    expect(await screen.findByText('Nenhum job ativo.')).toBeInTheDocument();
  });
});
