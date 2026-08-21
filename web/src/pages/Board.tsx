import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, X, SlidersHorizontal, Search, AlertTriangle, Contrast, ChevronDown, ChevronRight } from 'lucide-react';
import { api, type AlertLevel, type Job, type Person, type Phase } from '../api/client';
import { FAROL_COLOR_VARS, FAROL_LABELS, phaseMarkerColor } from '../theme/phase';
import { useAuth } from '../auth/AuthContext';
import { showToast } from '../components/Toast';
import { JobDetailPage } from './JobDetail';
import { BoardJobRow } from './BoardJobRow';
import './Board.css';

const FAROL_ORDER: AlertLevel[] = ['red', 'yellow', 'green'];
const CAPTACAO_PHASE_ORDER = 4;
const HIGH_CONTRAST_STORAGE_KEY = 'torre-de-controle:alto-contraste';

function phaseOrderOf(phases: Phase[], phaseId: number | null): number | null {
  return phases.find((p) => p.id === phaseId)?.order ?? null;
}

function matchesSearch(job: Job, term: string): boolean {
  if (!term) return true;
  const haystack = `${job.name} ${job.client ?? ''} ${job.highlightedPersonName ?? ''} ${job.atendimentoPersonName ?? ''}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function Board() {
  const { id: openJobId } = useParams<{ id?: string }>();
  const { user, updateBoardDensity } = useAuth();
  const density = user?.boardDensity ?? 'agrupado';
  const [phases, setPhases] = useState<Phase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [farolFilter, setFarolFilter] = useState<Set<AlertLevel>>(new Set());
  const [faseFilter, setFaseFilter] = useState<Set<number>>(new Set());
  const [atendimentoFilter, setAtendimentoFilter] = useState<Set<number>>(new Set());
  const [name, setName] = useState('');
  const [atendimentoPersonId, setAtendimentoPersonId] = useState('');
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [highContrast, setHighContrast] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === '1',
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stuckBannerRef = useRef<HTMLElement>(null);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<number>>(new Set());

  function toggleGroupCollapsed(phaseId: number) {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  async function refresh() {
    const [referenceRes, jobsRes, peopleRes] = await Promise.all([
      api.getReference(),
      api.listJobs(),
      api.listPeople(),
    ]);
    setPhases(referenceRes.phases);
    setJobs(jobsRes.jobs);
    setPeople(peopleRes.people);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o board.'));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, highContrast ? '1' : '0');
  }, [highContrast]);

  // Atalho "/" pra focar a busca sem sair do teclado — comum em painéis de
  // trabalho (Slack, GitHub). Ignorado quando o foco já está num campo de
  // texto, pra não atrapalhar quem está digitando em outro lugar da tela.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== '/') return;
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
      if (isTyping) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Board and JobDetailPage render from the same Board component instance at both
  // "/" and "/jobs/:id" (no remount happens when navigating between them), so the
  // job list fetched once on mount goes stale after any edit made in the drawer.
  // Refetch whenever the drawer just closed (openJobId went from set to unset).
  const previousOpenJobIdRef = useRef(openJobId);
  useEffect(() => {
    if (previousOpenJobIdRef.current && !openJobId) {
      refresh().catch(() => setError('Não foi possível carregar o board.'));
    }
    previousOpenJobIdRef.current = openJobId;
  }, [openJobId]);

  const activeJobs = useMemo(() => jobs.filter((j) => !j.completedAt), [jobs]);

  const farolCounts = useMemo(() => {
    const counts: Record<AlertLevel, number> = { red: 0, yellow: 0, green: 0 };
    for (const job of activeJobs) counts[job.alertLevel]++;
    return counts;
  }, [activeJobs]);

  const faseCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const job of activeJobs) {
      if (job.phaseId) counts.set(job.phaseId, (counts.get(job.phaseId) ?? 0) + 1);
    }
    return counts;
  }, [activeJobs]);

  const atendimentoPeople = useMemo(
    () => people.filter((p) => p.area === 'Atendimento' && p.active),
    [people],
  );

  // Historical total (active + completed) — deliberately not scoped to activeJobs,
  // unlike farolCounts/faseCounts: this is "how many jobs has this person ever
  // handled", a stat, not a preview of what the click-filter below will show.
  const atendimentoCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const job of jobs) {
      if (job.atendimentoPersonId) {
        counts.set(job.atendimentoPersonId, (counts.get(job.atendimentoPersonId) ?? 0) + 1);
      }
    }
    return counts;
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    return activeJobs.filter((job) => {
      if (farolFilter.size > 0 && !farolFilter.has(job.alertLevel)) return false;
      if (faseFilter.size > 0 && (!job.phaseId || !faseFilter.has(job.phaseId))) return false;
      if (atendimentoFilter.size > 0 && (!job.atendimentoPersonId || !atendimentoFilter.has(job.atendimentoPersonId)))
        return false;
      if (!matchesSearch(job, search)) return false;
      return true;
    });
  }, [activeJobs, farolFilter, faseFilter, atendimentoFilter, search]);

  const stuckJobs = useMemo(
    () =>
      activeJobs
        .filter((j) => j.alertLevel === 'red')
        .sort((a, b) => (b.bolaComDayCounts?.currentStreakDays ?? 0) - (a.bolaComDayCounts?.currentStreakDays ?? 0)),
    [activeJobs],
  );

  // Visão agrupada: um grupo por fase, na ordem do ciclo de vida do job. O
  // nome da fase já vira o título do grupo, então nunca repete linha a
  // linha (é redundante por definição dentro de um grupo). O que de fato
  // repete no cenário que motivou esta fase — "Avançar para: X" igual em
  // 9 linhas seguidas — é o triggerLabel, não o nome da fase: quando todos
  // os jobs do grupo têm o mesmo triggerLabel, ele vai pro cabeçalho uma
  // vez só. majorityTrigger só serve pro destaque de quem foge do padrão.
  const groupedByPhase = useMemo(() => {
    const groups = new Map<number, Job[]>();
    for (const job of visibleJobs) {
      if (!job.phaseId) continue;
      if (!groups.has(job.phaseId)) groups.set(job.phaseId, []);
      groups.get(job.phaseId)!.push(job);
    }
    return phases
      .filter((phase) => groups.has(phase.id))
      .map((phase) => {
        const groupJobs = groups.get(phase.id)!;
        const triggerCounts = new Map<string, number>();
        for (const job of groupJobs) {
          const key = job.triggerLabel ?? '';
          triggerCounts.set(key, (triggerCounts.get(key) ?? 0) + 1);
        }
        let majorityTrigger = '';
        let majorityCount = 0;
        for (const [label, count] of triggerCounts) {
          if (count > majorityCount) {
            majorityCount = count;
            majorityTrigger = label;
          }
        }
        const commonTrigger = triggerCounts.size === 1 ? (groupJobs[0].triggerLabel ?? null) : null;
        return { phase, jobs: groupJobs, commonTrigger, majorityTrigger };
      });
  }, [visibleJobs, phases]);

  const stats = useMemo(() => {
    const bolaIlha = activeJobs.filter((j) => j.bolaCom === 'ilha').length;
    const bolaCliente = activeJobs.filter((j) => j.bolaCom === 'cliente').length;
    const retencaoDias = activeJobs.reduce((sum, j) => sum + (j.bolaComDayCounts?.clienteDays ?? 0), 0);
    const entramEmSet = activeJobs.filter((j) => phaseOrderOf(phases, j.phaseId) === CAPTACAO_PHASE_ORDER).length;
    return { ativos: activeJobs.length, bolaIlha, bolaCliente, retencaoDias, entramEmSet };
  }, [activeJobs, phases]);

  function toggleFarol(level: AlertLevel) {
    setFarolFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleFase(phaseId: number) {
    setFaseFilter((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  function toggleAtendimento(personId: number) {
    setAtendimentoFilter((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function handleCreateJob(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }
    if (!atendimentoPersonId) {
      setError('Selecione o Atendimento responsável.');
      return;
    }

    try {
      await api.createJob({ name: name.trim(), atendimentoPersonId: Number(atendimentoPersonId) });
      setName('');
      setAtendimentoPersonId('');
      setShowNewJobForm(false);
      await refresh();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }

  // Edição inline do nome do job (Fase 4): aplica na hora (otimista) e
  // confirma com um toast que carrega "Desfazer" — se a chamada à API
  // falhar, volta pro nome anterior sozinho, sem esperar o usuário notar.
  async function handleRenameJob(jobId: number, newName: string) {
    const previousName = jobs.find((j) => j.id === jobId)?.name;
    if (previousName === undefined || previousName === newName) return;

    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, name: newName } : j)));

    try {
      await api.setJobName(jobId, newName);
      showToast('Nome do job atualizado.', 'success', {
        label: 'Desfazer',
        onClick: () => void undoRenameJob(jobId, previousName),
      });
    } catch {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, name: previousName } : j)));
      setError('Não foi possível renomear o job.');
    }
  }

  async function undoRenameJob(jobId: number, previousName: string) {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, name: previousName } : j)));
    try {
      await api.setJobName(jobId, previousName);
    } catch {
      setError('Não foi possível desfazer a alteração do nome.');
    }
  }

  return (
    <div className={`board${highContrast ? ' board--alto-contraste' : ''}`}>
      <aside className={`board-sidebar${showFilters ? ' is-open' : ''}`}>
        <button
          type="button"
          className="board-filters-close"
          aria-label="Fechar atendimentos"
          onClick={() => setShowFilters(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>

        <nav className="board-filter-group" aria-label="Filtro por atendimento">
          <h2 className="label-caps">Atendimentos</h2>
          {atendimentoPeople.map((person) => (
            <button
              key={person.id}
              type="button"
              className={`board-filter-row${atendimentoFilter.has(person.id) ? ' is-active' : ''}`}
              aria-pressed={atendimentoFilter.has(person.id)}
              onClick={() => toggleAtendimento(person.id)}
            >
              <span className="board-filter-label">{person.name}</span>
              <span className="board-filter-count">{atendimentoCounts.get(person.id) ?? 0}</span>
            </button>
          ))}
        </nav>
      </aside>

      {showFilters && <div className="board-sidebar-backdrop" onClick={() => setShowFilters(false)} />}

      <main className="board-main">
        <header className="board-header">
          <div>
            <p className="label-caps">Ilha Crossmídia · Atendimento</p>
            <h1>
              Torre de Controle <span className="board-header-count">/ {activeJobs.length} jobs</span>
            </h1>
          </div>
          <button
            type="button"
            className="board-filters-toggle"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" /> Atendimentos
          </button>
          <button type="button" className="board-new-job-btn" onClick={() => setShowNewJobForm((v) => !v)}>
            <Plus size={16} aria-hidden="true" /> Criar novo job
          </button>
        </header>

        <div className="board-toolbar">
          <div className="board-toolbar-row">
            <div className="board-toolbar-search">
              <Search size={16} aria-hidden="true" className="board-toolbar-search-icon" />
              <input
                ref={searchInputRef}
                className="board-search"
                placeholder="Cliente, job ou responsável (atalho: /)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar"
              />
            </div>

            <div className="board-pill-groups">
              <div className="board-pill-group" role="group" aria-label="Filtro por farol">
                {FAROL_ORDER.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`board-pill${farolFilter.has(level) ? ' is-active' : ''}`}
                    aria-pressed={farolFilter.has(level)}
                    onClick={() => toggleFarol(level)}
                  >
                    <span className="board-dot" style={{ background: FAROL_COLOR_VARS[level] }} />
                    {FAROL_LABELS[level]}
                    <span className="board-pill-count">{farolCounts[level]}</span>
                  </button>
                ))}
              </div>

              <div className="board-pill-group" role="group" aria-label="Filtro por fase">
                {phases.map((phase) => (
                  <button
                    key={phase.id}
                    type="button"
                    className={`board-pill${faseFilter.has(phase.id) ? ' is-active' : ''}`}
                    aria-pressed={faseFilter.has(phase.id)}
                    onClick={() => toggleFase(phase.id)}
                  >
                    <span className="board-swatch" style={{ background: phaseMarkerColor(phase.order) }} />
                    {phase.name}
                    <span className="board-pill-count">{faseCounts.get(phase.id) ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="board-toolbar-indicators">
              {stuckJobs.length > 0 && (
                <button
                  type="button"
                  className="board-stuck-indicator"
                  onClick={() => stuckBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  <AlertTriangle size={14} aria-hidden="true" />
                  {stuckJobs.length} {stuckJobs.length === 1 ? 'travado' : 'travados'}
                </button>
              )}
              <button
                type="button"
                className={`board-contrast-toggle${highContrast ? ' is-active' : ''}`}
                aria-pressed={highContrast}
                onClick={() => setHighContrast((v) => !v)}
                title="Alternar alto contraste"
              >
                <Contrast size={16} aria-hidden="true" />
                <span className="board-contrast-toggle-label">Alto contraste</span>
              </button>
            </div>
          </div>

          {(farolFilter.size > 0 || faseFilter.size > 0) && (
            <div className="board-active-tags" aria-label="Filtros ativos">
              {FAROL_ORDER.filter((level) => farolFilter.has(level)).map((level) => (
                <button key={`farol-${level}`} type="button" className="board-tag" onClick={() => toggleFarol(level)}>
                  {FAROL_LABELS[level]}
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
              {phases
                .filter((phase) => faseFilter.has(phase.id))
                .map((phase) => (
                  <button key={`fase-${phase.id}`} type="button" className="board-tag" onClick={() => toggleFase(phase.id)}>
                    {phase.name}
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
            </div>
          )}
        </div>

        {showNewJobForm && (
          <form onSubmit={handleCreateJob} className="board-new-job-form">
            <label htmlFor="job-name">Nome do job</label>
            <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <label htmlFor="job-atendimento">Atendimento responsável</label>
            <select
              id="job-atendimento"
              value={atendimentoPersonId}
              onChange={(e) => setAtendimentoPersonId(e.target.value)}
            >
              <option value="">(selecionar)</option>
              {people
                .filter((p) => p.area === 'Atendimento' && p.active)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
            <button type="submit">Adicionar</button>
          </form>
        )}

        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}

        {stuckJobs.length > 0 && (
          <section className="board-stuck-banner" ref={stuckBannerRef}>
            <p className="board-stuck-title">
              {stuckJobs.length} {stuckJobs.length === 1 ? 'JOB TRAVADO' : 'JOBS TRAVADOS'} · EXIGEM SUA AÇÃO HOJE
            </p>
            <ul className="board-stuck-list">
              {stuckJobs.map((job) => (
                <li key={job.id}>
                  <Link to={`/jobs/${job.id}`} className="board-stuck-job">
                    <span className="board-stuck-name">{job.client ?? job.name}</span>
                    <span className="board-stuck-days">
                      {job.bolaComDayCounts?.currentStreakDays ?? 0} dias com{' '}
                      {job.bolaCom === 'cliente' ? 'o cliente' : 'a Ilha'}
                    </span>
                  </Link>
                  {job.highlightedPersonName && (
                    <span className="board-stuck-person">{job.highlightedPersonName}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="board-stats">
          <div className="board-stat-card">
            <p className="label-caps">Em produção</p>
            <p className="board-stat-value">
              {stats.ativos} <span>jobs ativos</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Bola com a Ilha</p>
            <p className="board-stat-value">
              {stats.bolaIlha} <span>jobs</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Bola com o cliente</p>
            <p className="board-stat-value board-stat-value--warn">
              {stats.bolaCliente} <span>jobs</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Retenção do cliente</p>
            <p className="board-stat-value board-stat-value--warn">
              {stats.retencaoDias} <span>dias somados</span>
            </p>
          </div>
          <div className="board-stat-card">
            <p className="label-caps">Entram em set</p>
            <p className="board-stat-value">
              {stats.entramEmSet} <span>jobs em Captação</span>
            </p>
          </div>
        </section>

        <div className="board-density-toggle" role="group" aria-label="Densidade da tabela">
          <button
            type="button"
            className={density === 'agrupado' ? 'is-active' : undefined}
            aria-pressed={density === 'agrupado'}
            onClick={() => void updateBoardDensity('agrupado')}
          >
            Agrupado por fase
          </button>
          <button
            type="button"
            className={density === 'plano' ? 'is-active' : undefined}
            aria-pressed={density === 'plano'}
            onClick={() => void updateBoardDensity('plano')}
          >
            Tabela plana
          </button>
        </div>

        <table className="board-table">
          <thead>
            <tr>
              <th>Fases</th>
              <th>Job</th>
              <th>Etapa atual</th>
              <th>Bola com</th>
              <th>Relógio de responsabilidade</th>
            </tr>
          </thead>
          {density === 'agrupado' ? (
            groupedByPhase.map(({ phase, jobs: groupJobs, commonTrigger, majorityTrigger }) => {
              const isCollapsed = collapsedPhaseIds.has(phase.id);
              return (
                <tbody key={phase.id} className="board-group">
                  <tr className="board-group-header">
                    <td colSpan={5}>
                      <button
                        type="button"
                        className="board-group-toggle"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleGroupCollapsed(phase.id)}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={16} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={16} aria-hidden="true" />
                        )}
                        <span className="board-swatch" style={{ background: phaseMarkerColor(phase.order) }} />
                        <span className="board-group-title">{phase.name}</span>
                        <span className="board-group-count">
                          {groupJobs.length} {groupJobs.length === 1 ? 'job' : 'jobs'}
                        </span>
                        {commonTrigger && <span className="board-group-common-status">{commonTrigger}</span>}
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed &&
                    groupJobs.map((job) => (
                      <BoardJobRow
                        key={job.id}
                        job={job}
                        phases={phases}
                        currentOrder={phaseOrderOf(phases, job.phaseId) ?? 0}
                        showPhaseText={false}
                        showTriggerText={!commonTrigger}
                        highlight={{
                          statusOutlier: !commonTrigger && job.triggerLabel !== majorityTrigger,
                          clockOverLimit: job.alertLevel === 'red',
                          clientHeldLong: job.bolaCom === 'cliente' && job.alertLevel !== 'green',
                        }}
                        onRenameJob={handleRenameJob}
                      />
                    ))}
                </tbody>
              );
            })
          ) : (
            <tbody>
              {visibleJobs.map((job) => (
                <BoardJobRow
                  key={job.id}
                  job={job}
                  phases={phases}
                  currentOrder={phaseOrderOf(phases, job.phaseId) ?? 0}
                  showPhaseText
                  showTriggerText
                  onRenameJob={handleRenameJob}
                />
              ))}
            </tbody>
          )}
        </table>
      </main>

      {openJobId && <JobDetailPage />}
    </div>
  );
}
