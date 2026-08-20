# Usabilidade, Acessibilidade e Responsividade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o painel do job virar um overlay de verdade sobre a lista (sem tela branca), tornar a interface inteira responsiva (mobile-first) e acessível (WCAG AA baseline), e adicionar feedback claro (toasts + confirmação em ações menos reversíveis).

**Architecture:** `Board` e `JobDetail` passam a compartilhar a mesma árvore de rota, com `JobDetail` renderizado como uma gaveta (`position: fixed`) por cima da lista em vez de substituí-la. Um sistema de toast global e um modal de confirmação reaproveitável entram como componentes novos em `web/src/components/`. Responsividade e acessibilidade são um passe de CSS/HTML sobre os arquivos já existentes — nenhuma mudança de dado ou API.

**Tech Stack:** React + Vite + TypeScript, `react-router-dom`, Vitest + Testing Library, `lucide-react` (dependência nova, ícones).

**Spec:** [docs/superpowers/specs/2026-08-20-usabilidade-acessibilidade-design.md](../specs/2026-08-20-usabilidade-acessibilidade-design.md)

## Global Constraints

- Nenhuma dependência nova além de `lucide-react` — sem framework de UI, sem Tailwind.
- Três breakpoints usados em todo `@media` deste plano: mobile até 639px, tablet 640–1023px, desktop a partir de 1024px.
- Todo alvo de toque novo ou tocado por este plano recebe `min-height: 48px` (e `min-width: 48px` quando for um botão só-ícone).
- Fonte base sobe de 14px para 16px em `tokens.css` — depois dessa mudança, cada task que mexe numa página deve conferir visualmente que nada quebrou (texto cortado, sobreposição).
- Modal de confirmação (`ConfirmDialog`) só em duas ações: revogar acesso de usuário e marcar job como concluído. Nenhuma outra ação ganha confirmação neste plano.
- Toda rota nova ou componente novo segue o sistema de tokens já existente (`web/src/styles/tokens.css`) — nenhuma cor hexadecimal fora desse arquivo.

---

### Task 1: Board + JobDetail como overlay único

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/Board.tsx`
- Modify: `web/src/pages/JobDetail.tsx`
- Modify: `web/src/pages/JobDetail.css`
- Modify: `web/test/Board.test.tsx`
- Modify: `web/test/JobDetail.test.tsx`

**Interfaces:**
- Consumes: `Board`, `JobDetailPage` (já existentes, sem mudança de props — `JobDetailPage` continua lendo `jobId` via `useParams()` internamente).
- Produces: nenhuma interface nova consumida por outra task.

- [ ] **Step 1: Fazer as duas rotas renderizarem `Board`**

Em `web/src/App.tsx`, remova o import de `JobDetailPage` (linha `import { JobDetailPage } from './pages/JobDetail';`) — não é mais usado aqui.

Substitua o bloco de rotas `/` e `/jobs/:id`:

```tsx
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
```

(o conteúdo já é esse — a mudança real é só remover o import da linha 6 e trocar `<JobDetailPage />` por `<Board />` no elemento da rota `/jobs/:id`.)

- [ ] **Step 2: Renderizar `JobDetailPage` dentro de `Board` quando a URL tiver um job**

Em `web/src/pages/Board.tsx`, atualize o import do topo:

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AlertLevel, type Job, type Phase } from '../api/client';
import { FAROL_COLOR_VARS, FAROL_LABELS, phaseColor } from '../theme/phase';
import { JobDetailPage } from './JobDetail';
import './Board.css';
```

Dentro do componente `Board`, logo depois da linha `export function Board() {`, adicione:

```tsx
  const { id: openJobId } = useParams<{ id?: string }>();
```

No final do JSX retornado, depois da tag de fechamento `</main>` e antes do `</div>` final que fecha `.board`, adicione:

```tsx
      {openJobId && <JobDetailPage />}
```

O `<div className="board">` continua sendo o elemento raiz — `JobDetailPage` vira um irmão de `.board-sidebar`/`.board-main` dentro dele, se sobrepondo via `position: fixed` (Step 4).

- [ ] **Step 3: Fazer o painel do job funcionar como diálogo modal (fechar por fora, Esc, foco)**

Em `web/src/pages/JobDetail.tsx`, atualize o import do topo:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type ClassifySuggestion,
  type JobDetail as JobDetailType,
  type Phase,
  type Person,
} from '../api/client';
import { phaseColor } from '../theme/phase';
import './JobDetail.css';
```

(o `Link` não é mais usado neste arquivo — o botão de fechar agora navega via `useNavigate`.)

Dentro do componente, logo após a linha que lê `jobId` via `useParams`, adicione:

```tsx
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    navigate('/');
  }

  useEffect(() => {
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Substitua **todo o bloco de `return` até o final do componente** (do `if (!job) {` até o `}` que fecha a função `JobDetailPage`) pelo seguinte — é o mesmo JSX de antes, só envolvido por `.job-detail-page`/`.job-detail-panel` com os handlers de fechar, e com `id="job-detail-title"` no `<h1>` e o botão de fechar trocado de `<Link>` pra `<button>`:

```tsx
  if (!job) {
    return (
      <div className="job-detail-page" onClick={handleClose}>
        <div
          className="job-detail-panel"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          {error ? <p role="alert">{error}</p> : <p>Carregando...</p>}
        </div>
      </div>
    );
  }

  const counts = job.bolaComDayCounts;
  const isStuck = job.alertLevel === 'red';
  const pendingSuggestions = suggestions?.filter((s) => s.outcome === 'pendente') ?? [];
  const appliedSuggestions = suggestions?.filter((s) => s.outcome === 'auto_aplicado') ?? [];

  const currentStatusOrder =
    phases.find((p) => p.id === job.phaseId)?.statuses.find((s) => s.id === job.statusId)?.order ?? 0;

  return (
    <div className="job-detail-page" onClick={handleClose}>
      <div
        className="job-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="job-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="job-detail-header">
          <div>
            <p className="label-caps">
              {job.client ?? 'Sem cliente'} · {job.code ?? `J${job.id}`}
            </p>
            <h1 id="job-detail-title">{job.name}</h1>
            <p className="job-detail-phase" style={{ color: phaseColor(currentPhaseOrder) }}>
              FASE {currentPhaseOrder} · {job.phaseName?.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            ref={closeButtonRef}
            className="job-detail-close"
            aria-label="Fechar"
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {isStuck && counts && (
          <p className="job-detail-warning job-detail-warning--red">
            {counts.currentStreakDays} dias com {job.bolaCom === 'cliente' ? 'o cliente' : 'a Ilha'}
          </p>
        )}

        {job.lastWhatsappActivityAt && (
          <p className="job-detail-warning job-detail-warning--amber">
            Grupo sem movimento há {hoursSince(job.lastWhatsappActivityAt)}h{' '}
            <button type="button" className="job-detail-link-btn" onClick={handleClearLastActivity}>
              limpar
            </button>
          </p>
        )}
        {!job.lastWhatsappActivityAt && (
          <button type="button" className="job-detail-link-btn" onClick={handleSetLastActivityNow}>
            Marcar atividade do grupo agora
          </button>
        )}

        {error && (
          <p role="alert" className="job-detail-error">
            {error}
          </p>
        )}

        {counts && (
          <div className="job-detail-bola-toggle">
            <button
              type="button"
              className={`job-detail-bola-btn${job.bolaCom === 'ilha' ? ' is-active' : ''}`}
              onClick={() => handleBolaComToggle('ilha')}
            >
              Bola com a Ilha · {counts.ilhaDays}d
            </button>
            <button
              type="button"
              className={`job-detail-bola-btn job-detail-bola-btn--cliente${job.bolaCom === 'cliente' ? ' is-active' : ''}`}
              onClick={() => handleBolaComToggle('cliente')}
            >
              Bola com o cliente · {counts.clienteDays}d
            </button>
          </div>
        )}

        <div className="job-detail-paste">
          <label htmlFor="paste-text" className="label-caps">
            Colar mensagens do WhatsApp
          </label>
          <textarea
            id="paste-text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="Cole aqui o texto da conversa do grupo..."
          />
          <button type="button" onClick={() => void handleClassify()} disabled={classifying || !pasteText.trim()}>
            {classifying ? 'Analisando...' : 'Analisar com IA'}
          </button>

          {appliedSuggestions.length > 0 && (
            <ul className="job-detail-suggestions job-detail-suggestions--applied">
              {appliedSuggestions.map((s, i) => (
                <li key={i}>
                  <span className="job-detail-suggestion-badge">aplicado pela IA</span> {s.valor}
                </li>
              ))}
            </ul>
          )}

          {pendingSuggestions.length > 0 && (
            <ul className="job-detail-suggestions">
              {pendingSuggestions.map((s, i) => (
                <li key={i}>
                  <span>{s.valor}</span>
                  <button type="button" onClick={() => void handleApplySuggestion(s)}>
                    Aplicar
                  </button>
                  <button type="button" onClick={() => dismissSuggestion(s)}>
                    Descartar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="job-detail-checklist">
          {phases.map((phase) => {
            const isCurrentPhase = phase.id === job.phaseId;
            const phaseIsPast = phase.order < currentPhaseOrder;
            const isExpanded = expandedPhaseId === phase.id;
            const itemsDone = isCurrentPhase
              ? phase.statuses.filter((s) => s.order <= currentStatusOrder).length
              : phaseIsPast
                ? phase.statuses.length
                : 0;

            return (
              <section key={phase.id} className="job-detail-phase-block">
                <button
                  type="button"
                  className="job-detail-phase-header"
                  onClick={() => setExpandedPhaseId(isExpanded ? null : phase.id)}
                >
                  <span className="job-detail-swatch" style={{ background: phaseColor(phase.order) }} />
                  <span className="job-detail-phase-name">{phase.name}</span>
                  <span className="job-detail-phase-count">
                    {itemsDone}/{phase.statuses.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className="job-detail-phase-body">
                    {phase.roles.length > 0 && (
                      <p className="label-caps job-detail-phase-roles">{phase.roles.join(' · ')}</p>
                    )}

                    <ul className="job-detail-checklist-items">
                      {phase.statuses.map((status) => {
                        const checked = isCurrentPhase
                          ? status.order <= currentStatusOrder
                          : phaseIsPast;
                        return (
                          <li key={status.id}>
                            <button
                              type="button"
                              className={`job-detail-checklist-item${checked ? ' is-checked' : ''}`}
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => void handleStatusClick(status.id)}
                            >
                              <span className="job-detail-checkbox">{checked ? '✓' : ''}</span>
                              {status.name}
                            </button>
                          </li>
                        );
                      })}
                    </ul>

                    {isCurrentPhase &&
                      phase.roles.map((area) => {
                        const assignment = job.roleAssignments.find((a) => a.area === area);
                        return (
                          <div key={area} className="job-detail-role-row">
                            <span>{area}</span>
                            <select
                              aria-label={area}
                              value={assignment?.personId ?? ''}
                              onChange={(e) =>
                                void handleAssignRole(area, e.target.value ? Number(e.target.value) : null)
                              }
                            >
                              <option value="">(não atribuído)</option>
                              {peopleByArea(area).map((person) => (
                                <option key={person.id} value={person.id}>
                                  {person.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

Isso substitui, verbatim, todo o resto do arquivo a partir do `if (!job) {` original — as únicas mudanças reais em relação ao que já existia são: as duas `<div>` de abertura (`job-detail-page`/`job-detail-panel`) com seus `onClick`, `id="job-detail-title"` no `<h1>`, o botão de fechar virando `<button ref={closeButtonRef} onClick={handleClose}>` no lugar do `<Link to="/">`, e as duas `</div>` extras fechando no final. Todo o restante (lógica de `counts`, `isStuck`, checklist, sugestões, bola-com) é idêntico ao arquivo atual.

- [ ] **Step 4: Fazer `.job-detail-page` virar a camada de overlay + fundo semi-transparente**

Em `web/src/pages/JobDetail.css`, substitua a regra `.job-detail-page`:

```css
.job-detail-page {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(20, 20, 30, 0.4);
  display: flex;
  justify-content: flex-end;
}
```

- [ ] **Step 5: Atualizar `web/test/Board.test.tsx` e `web/test/JobDetail.test.tsx` pro novo comportamento**

Em `web/test/Board.test.tsx`, o mock de `../src/api/client` precisa incluir também os métodos que `JobDetailPage` usa, já que agora `JobDetailPage` pode ser renderizado dentro dos testes do Board quando a URL tiver um job. Substitua o bloco `vi.mock('../src/api/client', ...)`:

```tsx
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
```

No `beforeEach`, adicione um reset e um default resolvido pros métodos novos (o Board sozinho, sem `id` na URL, nunca os chama de verdade, mas precisam de um valor padrão pra não quebrar caso algum teste futuro navegue pra dentro de um job):

```tsx
    mockedApi.getJob.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();
    mockedApi.setBolaCom.mockReset();
    mockedApi.setLastActivity.mockReset();
    mockedApi.classifyJob.mockReset();
```

Adicione um teste novo verificando que a lista continua visível quando um job está aberto:

```tsx
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
        trelloCardId: null,
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

    expect(await screen.findByText('Job Aberto Teste')).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
```

Adicione `Route, Routes` ao import de `react-router-dom` no topo do arquivo (`import { MemoryRouter, Route, Routes } from 'react-router-dom';`).

Em `web/test/JobDetail.test.tsx`, `renderJobDetail()` precisa envolver `Board` no lugar de `JobDetailPage` diretamente, já que agora `JobDetailPage` só é montado através de `Board`. Substitua a função `renderJobDetail`:

```tsx
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
```

Adicione os imports necessários no topo do arquivo:

```tsx
import { Board } from '../src/pages/Board';
```

E adicione ao mock de `../src/api/client` os métodos que `Board` usa (`listJobs`, `createJob`), já que agora ele é montado junto:

```tsx
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
```

No `beforeEach`, adicione:

```tsx
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });
```

- [ ] **Step 6: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os testes passam, incluindo o novo teste do Board e os já existentes de `JobDetail.test.tsx` (agora montados através de `Board`).

Run: `cd web && npx tsc -b`
Expected: zero erros.

- [ ] **Step 7: Verificação manual**

Suba os servidores (`cd server && npm run dev`, `cd web && npx vite --host 0.0.0.0`) e abra um job pelo navegador. Confirme visualmente: a lista de jobs continua visível atrás do painel; clicar fora do painel (na área escurecida) fecha e volta pra `/`; apertar Esc fecha; o foco do teclado começa no botão de fechar quando o painel abre (dá pra confirmar apertando Tab uma vez e vendo se o próximo elemento focado faz sentido).

- [ ] **Step 8: Commit**

```bash
git add web/src/App.tsx web/src/pages/Board.tsx web/src/pages/JobDetail.tsx web/src/pages/JobDetail.css web/test/Board.test.tsx web/test/JobDetail.test.tsx
git commit -m "feat(web): merge Board and JobDetail into a single overlay layout"
```

---

### Task 2: Responsividade mobile-first

**Files:**
- Modify: `web/src/pages/Board.tsx`
- Modify: `web/src/pages/Board.css`
- Modify: `web/src/pages/JobDetail.css`
- Modify: `web/src/pages/Users.css`
- Modify: `web/src/pages/Login.css`
- Modify: `web/src/App.css`

**Interfaces:**
- Consumes: layout de overlay da Task 1 (o painel de filtros mobile reaproveita o mesmo padrão de `position: fixed` + backdrop).
- Produces: nada consumido por task futura.

- [ ] **Step 1: Sidebar de filtros vira gaveta abaixo de 1024px**

Em `web/src/pages/Board.tsx`, adicione um estado novo (junto aos outros `useState`):

```tsx
  const [showFilters, setShowFilters] = useState(false);
```

No JSX, envolva a abertura do `<aside className="board-sidebar">` com uma classe condicional e adicione um botão "Filtros" no cabeçalho, visível só em telas menores (o CSS do Step 2 cuida de escondê-lo em desktop). Substitua a tag de abertura:

```tsx
      <aside className={`board-sidebar${showFilters ? ' is-open' : ''}`}>
```

Logo depois da tag de fechamento `</aside>`, adicione o backdrop que fecha ao clicar fora (só existe/é visível em telas pequenas via CSS):

```tsx
      {showFilters && <div className="board-sidebar-backdrop" onClick={() => setShowFilters(false)} />}
```

No `<header className="board-header">`, adicione o botão de alternar filtros antes do botão "+ Criar novo job" (o texto do botão de criar job muda no Step 5 da Task 5 — por ora mantenha "+ Novo job", só adicione o botão de filtros ao lado):

```tsx
          <button
            type="button"
            className="board-filters-toggle"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            Filtros
          </button>
```

- [ ] **Step 2: CSS responsivo do Board**

Em `web/src/pages/Board.css`, adicione ao final do arquivo:

```css
.board-filters-toggle {
  display: none;
}

@media (max-width: 1023px) {
  .board-filters-toggle {
    display: inline-flex;
    align-items: center;
    min-height: 48px;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-panel);
    cursor: pointer;
  }

  .board-sidebar {
    display: none;
  }

  .board-sidebar.is-open {
    display: block;
    position: fixed;
    inset: 0 20% 0 0;
    z-index: 60;
    overflow-y: auto;
    box-shadow: var(--shadow-md);
  }

  .board-sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(20, 20, 30, 0.4);
  }

  .board-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .board-sidebar-backdrop {
    display: none;
  }
}

@media (max-width: 639px) {
  .board-sidebar.is-open {
    inset: 0;
  }

  .board-main {
    padding: 1rem;
  }

  .board-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .board-stats {
    grid-template-columns: 1fr;
  }

  .board-table thead {
    display: none;
  }

  .board-table,
  .board-table tbody,
  .board-table tr,
  .board-table td {
    display: block;
    width: 100%;
  }

  .board-table tr {
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 0;
  }

  .board-table td {
    padding: 0.3rem 0;
    border-bottom: none;
  }

  .board-table td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 0.15rem;
  }

  .board-mini-bar,
  .board-timeline {
    width: 100%;
  }
}

/* touch targets — mobile e tablet */
@media (max-width: 1023px) {
  .board-filter-row,
  .board-new-job-btn,
  .board-job-link {
    min-height: 48px;
  }

  .board-filter-row {
    padding: 0.6rem 0.5rem;
  }
}
```

- [ ] **Step 3: Rótulos de coluna pra visualização em cartão no mobile**

Em `web/src/pages/Board.tsx`, dentro do `<tbody>`, adicione `data-label` em cada `<td>` da linha da tabela (o CSS do Step 2 só mostra esses rótulos abaixo de 639px):

```tsx
                <tr key={job.id}>
                  <td data-label="Fases">
```

```tsx
                  <td data-label="Job">
```

```tsx
                  <td data-label="Etapa atual">
```

```tsx
                  <td data-label="Bola com">
```

```tsx
                  <td data-label="Relógio de responsabilidade">
```

(cada `data-label="..."` substitui só o atributo da tag `<td>` já existente naquela posição — o conteúdo interno de cada `<td>` não muda.)

- [ ] **Step 4: Gaveta do JobDetail ocupa a tela cheia no mobile**

Em `web/src/pages/JobDetail.css`, adicione ao final:

```css
@media (max-width: 639px) {
  .job-detail-panel {
    max-width: 100%;
  }
}

@media (max-width: 1023px) {
  .job-detail-checklist-item,
  .job-detail-bola-btn,
  .job-detail-close,
  .job-detail-phase-header {
    min-height: 48px;
  }
}
```

- [ ] **Step 5: CSS responsivo de Users, Login e do cabeçalho do app**

Em `web/src/pages/Users.css`, adicione ao final:

```css
@media (max-width: 639px) {
  .users-invite-form {
    flex-direction: column;
    align-items: stretch;
  }

  .users-table thead {
    display: none;
  }

  .users-table,
  .users-table tbody,
  .users-table tr,
  .users-table td {
    display: block;
    width: 100%;
  }

  .users-table tr {
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0;
  }
}
```

Em `web/src/pages/Login.css`, adicione ao final:

```css
@media (max-width: 639px) {
  .login-card {
    padding: 1.5rem;
    margin: 0 1rem;
  }
}
```

Em `web/src/App.css`, adicione ao final:

```css
@media (max-width: 639px) {
  .app-header {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
  }
}

.app-logout-btn,
.app-nav-link {
  min-height: 48px;
  display: inline-flex;
  align-items: center;
}
```

- [ ] **Step 6: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os testes continuam passando (este step é só CSS + atributos `data-label`, nenhuma mudança de comportamento testável muda).

Run: `cd web && npx tsc -b`
Expected: zero erros.

- [ ] **Step 7: Verificação manual em telas estreitas**

Com os servidores no ar, abra as ferramentas de desenvolvedor do navegador, ative o modo de dispositivo móvel (ex. 375px de largura) e confirme: o botão "Filtros" aparece e abre/fecha a barra lateral; os cards de estatística empilham; a tabela de jobs vira uma lista de cartões com rótulos; a gaveta do job ocupa a tela inteira.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Board.tsx web/src/pages/Board.css web/src/pages/JobDetail.css web/src/pages/Users.css web/src/pages/Login.css web/src/App.css
git commit -m "feat(web): mobile-first responsive layout across Board, JobDetail, Users, and Login"
```

---

### Task 3: Acessibilidade — baseline WCAG AA

**Files:**
- Modify: `web/src/styles/tokens.css`
- Modify: `web/src/pages/Board.tsx`
- Modify: `web/src/pages/Board.css`

**Interfaces:**
- Consumes: nada de tasks anteriores além do que já existe.
- Produces: `--focus-ring` token, usado implicitamente por todo elemento focável (regra global, nenhum componente futuro precisa importar nada).

- [ ] **Step 1: Corrigir a fonte (tinha um erro de digitação) e subir o tamanho base**

Em `web/src/styles/tokens.css`, a variável `--font-heading` está com o nome da fonte errado desde que foi criada — `'Arquivo'` (que não existe, então o navegador usa o fallback `system-ui` o tempo todo) em vez de `'Archivo'` (a fonte carregada de verdade no `index.html`). Corrija:

```css
  --font-heading: 'Archivo', system-ui, -apple-system, sans-serif;
```

Na mesma seção `:root`, adicione um token de foco visível, depois de `--shadow-md`:

```css
  --shadow-md: 0 4px 16px rgba(20, 20, 30, 0.1);
  --focus-ring: 0 0 0 3px rgba(27, 158, 140, 0.5);
```

Troque o tamanho de fonte base do `body`:

```css
body {
  background: var(--bg-subtle);
  color: var(--text-primary);
  font-family: var(--font-heading);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
```

Adicione, no final do arquivo, uma regra global de foco visível:

```css
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 2: Tags semânticas no Board**

Em `web/src/pages/Board.tsx`, o cabeçalho principal já usa `<header>`; a lista de filtros de Farol e Fase hoje são `<div>`s soltas. Substitua a abertura do primeiro `<div className="board-filter-group">` (o de Farol) por uma tag `<nav>` com rótulo:

```tsx
        <nav className="board-filter-group" aria-label="Filtro por farol">
```

E o fechamento correspondente (a `</div>` logo antes do próximo `<div className="board-filter-group">`, do bloco de Fase) por `</nav>`.

Substitua a abertura do segundo `<div className="board-filter-group">` (o de Fase):

```tsx
        <nav className="board-filter-group" aria-label="Filtro por fase">
```

E seu fechamento (a `</div>` logo antes de `</aside>`) por `</nav>`.

- [ ] **Step 3: Auditoria de contraste**

Confira cada par cor-de-texto / cor-de-fundo abaixo usando uma ferramenta de contraste (ex. o cálculo de contraste do WebAIM) e ajuste qualquer tom que não bata 4.5:1 pra texto normal (ou 3:1 pra texto grande/negrito ≥ 18px):

| Texto | Fundo | Onde aparece |
|---|---|---|
| `--text-secondary` (`#6b7280`) | `--bg-panel` (`#ffffff`) | rótulos `label-caps`, texto secundário em quase toda página |
| `--text-inverse` (`#ffffff`) | `--fase-4` (`#1b9e8c`) | badge de sugestão aplicada pela IA, botão "bola com a Ilha" ativo |
| `--text-inverse` (`#ffffff`) | `--farol-atencao` (`#f59e0b`) | botão "bola com o cliente" ativo |
| `--farol-travado` (`#dc2626`) | `--farol-travado-bg` (`#fef2f2`) | banner de jobs travados, aviso "dias com..." |
| `--text-primary` (`#1a1a24`) | `--bg-subtle` (`#f7f7fa`) | fundo geral da aplicação |

Se algum par não passar, ajuste o valor hexadecimal correspondente em `tokens.css` (escurecendo o texto ou o fundo, o que fizer mais sentido visualmente) e confirme de novo. Registre no relatório da task quais pares foram auditados e qual o resultado de cada um, mesmo os que já passavam.

- [ ] **Step 4: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os testes continuam passando.

Run: `cd web && npx tsc -b`
Expected: zero erros.

- [ ] **Step 5: Verificação manual**

Com os servidores no ar, navegue pela interface só com Tab/Shift+Tab e confirme que o contorno de foco aparece em todo elemento interativo. Confirme visualmente que a fonte Archivo agora carrega de verdade (compare o peso/estilo das letras com antes — antes usava a fonte padrão do sistema operacional por causa do erro de digitação).

- [ ] **Step 6: Commit**

```bash
git add web/src/styles/tokens.css web/src/pages/Board.tsx web/src/pages/Board.css
git commit -m "fix(web): correct font-family typo, raise base font size, add focus-visible baseline"
```

---

### Task 4: Toast de feedback e modal de confirmação

**Files:**
- Create: `web/src/components/Toast.tsx`
- Create: `web/src/components/Toast.css`
- Create: `web/src/components/ConfirmDialog.tsx`
- Create: `web/src/components/ConfirmDialog.css`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/Users.tsx`
- Modify: `web/src/pages/Users.css`
- Modify: `web/src/pages/JobDetail.tsx`
- Test: `web/test/Users.test.tsx`
- Test: `web/test/JobDetail.test.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `showToast(text: string, type?: 'success' | 'error'): void` e `<ToastHost />` de `Toast.tsx`; `<ConfirmDialog title message confirmLabel cancelLabel? onConfirm onCancel />` de `ConfirmDialog.tsx`.

- [ ] **Step 1: Criar o sistema de toast**

Crie `web/src/components/Toast.tsx`:

```tsx
import { useEffect, useState } from 'react';
import './Toast.css';

export type ToastType = 'success' | 'error';

interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
}

type ToastListener = (toast: ToastMessage) => void;

let listener: ToastListener | null = null;
let nextId = 1;

export function showToast(text: string, type: ToastType = 'success'): void {
  listener?.({ id: nextId++, type, text });
}

const TOAST_DURATION_MS = 4000;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, TOAST_DURATION_MS);
    };
    return () => {
      listener = null;
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
```

Crie `web/src/components/Toast.css`:

```css
.toast-host {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toast {
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  font-size: 0.9rem;
  color: var(--text-inverse);
  max-width: 320px;
}

.toast--success {
  background: var(--farol-fluindo);
}

.toast--error {
  background: var(--farol-travado);
}

@media (max-width: 639px) {
  .toast-host {
    left: 1rem;
    right: 1rem;
    bottom: 1rem;
  }

  .toast {
    max-width: none;
  }
}
```

- [ ] **Step 2: Criar o modal de confirmação**

Crie `web/src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-dialog-backdrop" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-dialog-confirm" ref={confirmButtonRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Crie `web/src/components/ConfirmDialog.css`:

```css
.confirm-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 30, 0.4);
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.confirm-dialog {
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
}

.confirm-dialog h2 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}

.confirm-dialog p {
  margin: 0 0 1.25rem;
  color: var(--text-secondary);
}

.confirm-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.confirm-dialog-actions button {
  min-height: 48px;
  padding: 0.5rem 1.25rem;
  border-radius: var(--radius);
  cursor: pointer;
}

.confirm-dialog-cancel {
  border: 1px solid var(--border);
  background: var(--bg-panel);
}

.confirm-dialog-confirm {
  border: none;
  background: var(--farol-travado);
  color: var(--text-inverse);
}
```

- [ ] **Step 3: Montar `ToastHost` uma vez, no topo do app**

Em `web/src/App.tsx`, adicione o import:

```tsx
import { ToastHost } from './components/Toast';
```

Substitua o corpo da função `App`:

```tsx
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <ToastHost />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Confirmação ao revogar acesso, em `Users.tsx`**

Em `web/src/pages/Users.tsx`, atualize o import do topo:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { api, type User, type UserRole } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { showToast } from '../components/Toast';
import './Users.css';
```

Adicione um estado novo, junto aos outros `useState`:

```tsx
  const [userPendingRevoke, setUserPendingRevoke] = useState<User | null>(null);
```

Substitua `handleInvite` (só a parte de dentro do `try`, adicionando o toast de sucesso):

```tsx
    try {
      await api.inviteUser({ email: email.trim(), role });
      setEmail('');
      setRole('member');
      await refresh();
      showToast(`Convite enviado para ${email.trim()}.`);
    } catch {
      setError('Não foi possível convidar esse usuário.');
    }
```

Substitua a função `handleStatusChange` inteira:

```tsx
  async function handleStatusChange(id: number, newStatus: 'active' | 'revoked', user: User) {
    if (newStatus === 'revoked') {
      setUserPendingRevoke(user);
      return;
    }
    setError(null);
    try {
      await api.setUserStatus(id, newStatus);
      await refresh();
      showToast(`Acesso de ${user.email} reativado.`);
    } catch {
      setError('Não foi possível mudar o status desse usuário.');
    }
  }

  async function confirmRevoke() {
    if (!userPendingRevoke) return;
    const user = userPendingRevoke;
    setUserPendingRevoke(null);
    setError(null);
    try {
      await api.setUserStatus(user.id, 'revoked');
      await refresh();
      showToast(`Acesso de ${user.email} revogado.`);
    } catch {
      setError('Não foi possível mudar o status desse usuário.');
    }
  }
```

No JSX, atualize as chamadas de `handleStatusChange` pra passar o usuário inteiro:

```tsx
                {u.status === 'revoked' ? (
                  <button type="button" onClick={() => void handleStatusChange(u.id, 'active', u)}>
                    Reativar
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleStatusChange(u.id, 'revoked', u)}>
                    Revogar
                  </button>
                )}
```

Adicione o `ConfirmDialog` condicional logo antes do `</div>` final que fecha `.users-page`:

```tsx
      {userPendingRevoke && (
        <ConfirmDialog
          title="Revogar acesso"
          message={`Revogar acesso de ${userPendingRevoke.email}? Essa pessoa perde acesso ao sistema até ser reativada.`}
          confirmLabel="Revogar"
          onConfirm={() => void confirmRevoke()}
          onCancel={() => setUserPendingRevoke(null)}
        />
      )}
```

- [ ] **Step 5: Confirmação ao concluir um job, em `JobDetail.tsx`**

Em `web/src/pages/JobDetail.tsx`, atualize o import do topo (adicionando `ConfirmDialog` e `showToast`):

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type ClassifySuggestion,
  type JobDetail as JobDetailType,
  type Phase,
  type Person,
} from '../api/client';
import { phaseColor } from '../theme/phase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { showToast } from '../components/Toast';
import './JobDetail.css';
```

Adicione um estado novo, junto aos outros:

```tsx
  const [pendingCompleteStatusId, setPendingCompleteStatusId] = useState<number | null>(null);
```

Adicione, logo antes da função `handleStatusClick`, um helper que identifica o status verdadeiramente final (última fase, último item):

```tsx
  function isFinalStatus(statusId: number): boolean {
    const lastPhase = phases[phases.length - 1];
    if (!lastPhase) return false;
    const lastStatus = lastPhase.statuses[lastPhase.statuses.length - 1];
    return lastStatus?.id === statusId;
  }
```

Substitua `handleStatusClick` inteira:

```tsx
  async function handleStatusClick(statusId: number) {
    if (!job || statusId === job.statusId) return;
    if (isFinalStatus(statusId)) {
      setPendingCompleteStatusId(statusId);
      return;
    }
    await applyStatusChange(statusId);
  }

  async function applyStatusChange(statusId: number, successMessage = 'Status atualizado.') {
    setError(null);
    try {
      await api.setJobStatus(jobId, statusId);
      await refresh();
      showToast(successMessage);
    } catch {
      setError('Não foi possível mudar o status.');
    }
  }

  async function confirmComplete() {
    if (pendingCompleteStatusId === null) return;
    const statusId = pendingCompleteStatusId;
    setPendingCompleteStatusId(null);
    await applyStatusChange(statusId, 'Job concluído!');
  }
```

No JSX, adicione o `ConfirmDialog` condicional logo antes do fechamento final (`</div>\n    </div>\n  );`):

```tsx
        {pendingCompleteStatusId !== null && (
          <ConfirmDialog
            title="Concluir job"
            message="Marcar job como concluído? Isso completa o ciclo do job."
            confirmLabel="Concluir"
            onConfirm={() => void confirmComplete()}
            onCancel={() => setPendingCompleteStatusId(null)}
          />
        )}
```

- [ ] **Step 6: Testes**

Em `web/test/Users.test.tsx`, leia o arquivo primeiro (pra confirmar o padrão de mock já usado) e adicione um teste verificando que revogar abre a confirmação antes de chamar a API:

```tsx
  it('shows a confirmation dialog before revoking access', async () => {
    mockedApi.listUsers.mockResolvedValue({
      users: [{ id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'active' }],
    });
    const user = userEvent.setup();

    render(<UsersPage />);

    await user.click(await screen.findByRole('button', { name: 'Revogar' }));

    expect(await screen.findByText(/Revogar acesso de revogavel@ilhacrossmidia.com.br/)).toBeInTheDocument();
    expect(mockedApi.setUserStatus).not.toHaveBeenCalled();

    mockedApi.setUserStatus.mockResolvedValue({
      user: { id: 3, email: 'revogavel@ilhacrossmidia.com.br', name: 'Pessoa', role: 'member', status: 'revoked' },
    });
    await user.click(screen.getByRole('button', { name: 'Revogar' }));

    await waitFor(() => expect(mockedApi.setUserStatus).toHaveBeenCalledWith(3, 'revoked'));
  });
```

(esse teste clica em "Revogar" duas vezes — a primeira abre o modal de confirmação, que também tem um botão "Revogar"; a segunda, dentro do modal já aberto, de fato confirma.)

Em `web/test/JobDetail.test.tsx`, adicione um teste verificando a confirmação ao concluir. Isso exige uma fase final com um único item no fixture `referencePhases` — adicione uma segunda fase ao array já existente (mantendo a primeira como está):

```tsx
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

    await user.click(await screen.findByText('Encerramento'));
    await user.click(await screen.findByText('Arquivamento'));

    expect(await screen.findByText('Concluir job')).toBeInTheDocument();
    expect(mockedApi.setJobStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(mockedApi.setJobStatus).toHaveBeenCalledWith(1, 99));
  });
```

- [ ] **Step 7: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os testes passam, incluindo os 2 novos.

Run: `cd web && npx tsc -b`
Expected: zero erros.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/Toast.tsx web/src/components/Toast.css web/src/components/ConfirmDialog.tsx web/src/components/ConfirmDialog.css web/src/App.tsx web/src/pages/Users.tsx web/src/pages/JobDetail.tsx web/test/Users.test.tsx web/test/JobDetail.test.tsx
git commit -m "feat(web): add toast feedback and confirmation dialog for revoke/complete actions"
```

---

### Task 5: Ícones e textos de botão

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/pages/Board.tsx`
- Modify: `web/src/pages/JobDetail.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nada consumido por task futura (última task do plano).

- [ ] **Step 1: Adicionar a dependência**

Em `web/package.json`, adicione ao objeto `dependencies` (ordem alfabética com as demais):

```json
    "lucide-react": "^0.460.0",
```

Run: `cd web && npm install`
Expected: instala sem erro.

- [ ] **Step 2: Ícones e textos no Board**

Em `web/src/pages/Board.tsx`, adicione o import:

```tsx
import { Plus, X, SlidersHorizontal } from 'lucide-react';
```

Troque o texto do botão de criar job:

```tsx
          <button type="button" className="board-new-job-btn" onClick={() => setShowNewJobForm((v) => !v)}>
            <Plus size={16} aria-hidden="true" /> Criar novo job
          </button>
```

Adicione o ícone ao botão de filtros (criado na Task 2):

```tsx
          <button
            type="button"
            className="board-filters-toggle"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" /> Filtros
          </button>
```

Adicione um botão de fechar a gaveta de filtros mobile, logo depois da abertura de `<aside className={...}>` (só faz sentido/aparece em telas pequenas, mas o botão pode existir sempre — o CSS da Task 2 já esconde a sidebar inteira em desktop):

```tsx
        <button
          type="button"
          className="board-filters-close"
          aria-label="Fechar filtros"
          onClick={() => setShowFilters(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
```

Em `web/src/pages/Board.css`, adicione:

```css
.board-filters-close {
  display: none;
}

@media (max-width: 1023px) {
  .board-filters-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 48px;
    min-height: 48px;
    border: none;
    background: none;
    cursor: pointer;
    margin-bottom: 0.5rem;
  }
}

.board-new-job-btn,
.board-filters-toggle {
  gap: 0.4rem;
}
```

- [ ] **Step 3: Ícone no botão de fechar do JobDetail**

Em `web/src/pages/JobDetail.tsx`, adicione o import:

```tsx
import { X } from 'lucide-react';
```

Substitua o conteúdo do botão de fechar (o `×` literal):

```tsx
          <button
            type="button"
            ref={closeButtonRef}
            className="job-detail-close"
            aria-label="Fechar"
            onClick={handleClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
```

- [ ] **Step 4: Atualizar o teste que procura o botão pelo texto antigo**

Em `web/test/Board.test.tsx`, o teste `'creates a job via the new-job form and refreshes the board'` localiza o botão via `screen.getByRole('button', { name: '+ Novo job' })` — esse texto não existe mais depois do Step 2. Troque essa linha para:

```tsx
    await user.click(screen.getByRole('button', { name: /Criar novo job/ }));
```

- [ ] **Step 5: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os testes passam.

Run: `cd web && npx tsc -b`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/pages/Board.tsx web/src/pages/Board.css web/src/pages/JobDetail.tsx web/test/Board.test.tsx
git commit -m "feat(web): add lucide-react icons and clearer button copy"
```

---

## Encerramento deste plano

Depois da Task 5, abrir um job não apaga mais a lista, a interface funciona em telas pequenas com alvos de toque adequados, a base de acessibilidade (contraste, foco visível, semântica, tamanho de fonte) está estabelecida, e as duas ações menos reversíveis do sistema (revogar acesso, concluir job) pedem confirmação — com feedback de sucesso visível em vez de silencioso.
