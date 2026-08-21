import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, X, SlidersHorizontal } from 'lucide-react';
import { api, type AlertLevel, type Job, type Person, type Phase } from '../api/client';
import { FAROL_COLOR_VARS, FAROL_LABELS, phaseColor } from '../theme/phase';
import { JobDetailPage } from './JobDetail';
import './Board.css';

const FAROL_ORDER: AlertLevel[] = ['red', 'yellow', 'green'];
const CAPTACAO_PHASE_ORDER = 4;

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

  return (
    <div className="board">
      <aside className={`board-sidebar${showFilters ? ' is-open' : ''}`}>
        <button
          type="button"
          className="board-filters-close"
          aria-label="Fechar filtros"
          onClick={() => setShowFilters(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <input
          className="board-search"
          placeholder="Cliente, job ou responsável"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar"
        />

        <nav className="board-filter-group" aria-label="Filtro por farol">
          <h2 className="label-caps">Farol</h2>
          {FAROL_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              className={`board-filter-row${farolFilter.has(level) ? ' is-active' : ''}`}
              aria-pressed={farolFilter.has(level)}
              onClick={() => toggleFarol(level)}
            >
              <span className="board-dot" style={{ background: FAROL_COLOR_VARS[level] }} />
              <span className="board-filter-label">{FAROL_LABELS[level]}</span>
              <span className="board-filter-count">{farolCounts[level]}</span>
            </button>
          ))}
        </nav>

        <nav className="board-filter-group" aria-label="Filtro por fase">
          <h2 className="label-caps">Fase</h2>
          {phases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className={`board-filter-row${faseFilter.has(phase.id) ? ' is-active' : ''}`}
              aria-pressed={faseFilter.has(phase.id)}
              onClick={() => toggleFase(phase.id)}
            >
              <span className="board-swatch" style={{ background: phaseColor(phase.order) }} />
              <span className="board-filter-label">{phase.name}</span>
              <span className="board-filter-count">{faseCounts.get(phase.id) ?? 0}</span>
            </button>
          ))}
        </nav>

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
            <SlidersHorizontal size={16} aria-hidden="true" /> Filtros
          </button>
          <button type="button" className="board-new-job-btn" onClick={() => setShowNewJobForm((v) => !v)}>
            <Plus size={16} aria-hidden="true" /> Criar novo job
          </button>
        </header>

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
          <section className="board-stuck-banner">
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
          <tbody>
            {visibleJobs.map((job) => {
              const currentOrder = phaseOrderOf(phases, job.phaseId) ?? 0;
              const counts = job.bolaComDayCounts;
              const totalDays = (counts?.ilhaDays ?? 0) + (counts?.clienteDays ?? 0);
              const ilhaPct =
                totalDays === 0
                  ? job.bolaCom === 'cliente'
                    ? 0
                    : 100
                  : ((counts?.ilhaDays ?? 0) / totalDays) * 100;

              return (
                <tr key={job.id}>
                  <td data-label="Fases">
                    <div className="board-mini-bar">
                      {phases.map((phase) => (
                        <span
                          key={phase.id}
                          className="board-mini-segment"
                          style={{ background: phase.order <= currentOrder ? phaseColor(phase.order) : 'var(--border)' }}
                        />
                      ))}
                    </div>
                  </td>
                  <td data-label="Job">
                    <Link to={`/jobs/${job.id}`} className="board-job-link">
                      <span className="label-caps">{job.client ?? '—'}</span>
                      <span className="board-job-name">{job.name}</span>
                    </Link>
                  </td>
                  <td data-label="Etapa atual">
                    <p className="board-job-phase" style={{ color: phaseColor(currentOrder) }}>
                      F{currentOrder} · {job.phaseName ?? ''}
                    </p>
                    {job.triggerLabel && <p className="board-job-next">{job.triggerLabel}</p>}
                  </td>
                  <td data-label="Bola com">
                    <span className={`board-bola-tag board-bola-tag--${job.bolaCom}`}>
                      {job.highlightedPersonName ?? (job.bolaCom === 'cliente' ? 'Cliente' : 'Ilha')}
                    </span>
                  </td>
                  <td data-label="Relógio de responsabilidade">
                    <div className="board-timeline">
                      <div className="board-timeline-bar">
                        <span className="board-timeline-ilha" style={{ width: `${ilhaPct}%` }} />
                        <span className="board-timeline-cliente" style={{ width: `${100 - ilhaPct}%` }} />
                      </div>
                      <div className="board-timeline-labels">
                        <span>Ilha {counts?.ilhaDays ?? 0}d</span>
                        <span>Cliente {counts?.clienteDays ?? 0}d</span>
                      </div>
                    </div>
                    <span className="board-dot board-dot--inline" style={{ background: FAROL_COLOR_VARS[job.alertLevel] }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>

      {openJobId && <JobDetailPage />}
    </div>
  );
}
