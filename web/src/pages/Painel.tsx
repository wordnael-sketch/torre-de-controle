import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Building2,
  Users,
  Clock,
  Clapperboard,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Layers,
  User,
  TrafficCone,
} from 'lucide-react';
import { api, type AlertLevel, type Job, type Person, type Phase } from '../api/client';
import { FAROL_COLOR_VARS, FAROL_LABELS, phaseMarkerColor } from '../theme/phase';
import './Painel.css';

const FAROL_ORDER: AlertLevel[] = ['red', 'yellow', 'green'];
const CAPTACAO_PHASE_ORDER = 4;

// Ícone da caixinha colorida de cada farol — cores "-fill" (sólidas, pensadas
// pra fundo com ícone branco em cima), não as "-travado/atencao/fluindo" de
// texto usadas em outros lugares do site.
const FAROL_FILL_VARS: Record<AlertLevel, string> = {
  red: 'var(--farol-travado-fill)',
  yellow: 'var(--farol-atencao-fill)',
  green: 'var(--farol-fluindo-fill)',
};

const FAROL_ICONS: Record<AlertLevel, ReactNode> = {
  red: <AlertTriangle size={18} aria-hidden="true" />,
  yellow: <AlertCircle size={18} aria-hidden="true" />,
  green: <CheckCircle2 size={18} aria-hidden="true" />,
};

function IconBadge({ icon, color }: { icon: ReactNode; color: string }) {
  return (
    <span className="painel-icon-badge" style={{ background: color }} aria-hidden="true">
      {icon}
    </span>
  );
}

function phaseOrderOf(phases: Phase[], phaseId: number | null): number | null {
  return phases.find((p) => p.id === phaseId)?.order ?? null;
}

export function Painel() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getReference(), api.listJobs(), api.listPeople()])
      .then(([referenceRes, jobsRes, peopleRes]) => {
        setPhases(referenceRes.phases);
        setJobs(jobsRes.jobs);
        setPeople(peopleRes.people);
      })
      .catch(() => setError('Não foi possível carregar o painel.'));
  }, []);

  const activeJobs = useMemo(() => jobs.filter((j) => !j.completedAt), [jobs]);

  const stats = useMemo(() => {
    const bolaIlha = activeJobs.filter((j) => j.bolaCom === 'ilha').length;
    const bolaCliente = activeJobs.filter((j) => j.bolaCom === 'cliente').length;
    const retencaoDias = activeJobs.reduce((sum, j) => sum + (j.bolaComDayCounts?.clienteDays ?? 0), 0);
    const entramEmSet = activeJobs.filter((j) => phaseOrderOf(phases, j.phaseId) === CAPTACAO_PHASE_ORDER).length;
    return { ativos: activeJobs.length, bolaIlha, bolaCliente, retencaoDias, entramEmSet };
  }, [activeJobs, phases]);

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
  const faseMax = Math.max(1, ...phases.map((p) => faseCounts.get(p.id) ?? 0));

  const atendimentoPeople = useMemo(
    () => people.filter((p) => p.area === 'Atendimento' && p.active),
    [people],
  );
  // Total histórico (ativos + concluídos) — mesmo critério do Board, é "quantos
  // jobs essa pessoa já tocou", não uma prévia do que o filtro vai mostrar.
  const atendimentoCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const job of jobs) {
      if (job.atendimentoPersonId) {
        counts.set(job.atendimentoPersonId, (counts.get(job.atendimentoPersonId) ?? 0) + 1);
      }
    }
    return counts;
  }, [jobs]);
  const atendimentoSorted = useMemo(
    () =>
      [...atendimentoPeople].sort(
        (a, b) => (atendimentoCounts.get(b.id) ?? 0) - (atendimentoCounts.get(a.id) ?? 0),
      ),
    [atendimentoPeople, atendimentoCounts],
  );
  const atendimentoMax = Math.max(1, ...atendimentoPeople.map((p) => atendimentoCounts.get(p.id) ?? 0));

  if (error) {
    return <p className="painel-error">{error}</p>;
  }

  return (
    <main className="painel-main">
      <header className="painel-header">
        <p className="label-caps">Ilha Crossmídia · Atendimento</p>
        <h1>Painel</h1>
      </header>

      <section className="painel-kpis" aria-label="Indicadores gerais">
        <div className="painel-kpi-card painel-kpi-card--primary">
          <IconBadge icon={<Activity size={18} aria-hidden="true" />} color="var(--color-primary)" />
          <div>
            <p className="label-caps">Em produção</p>
            <p className="painel-kpi-value">
              {stats.ativos} <span>jobs ativos</span>
            </p>
          </div>
        </div>
        <div className="painel-kpi-card painel-kpi-card--good">
          <IconBadge icon={<Building2 size={18} aria-hidden="true" />} color="var(--farol-fluindo-fill)" />
          <div>
            <p className="label-caps">Bola com a Ilha</p>
            <p className="painel-kpi-value">
              {stats.bolaIlha} <span>jobs</span>
            </p>
          </div>
        </div>
        <div className="painel-kpi-card painel-kpi-card--warn">
          <IconBadge icon={<Users size={18} aria-hidden="true" />} color="var(--farol-atencao-fill)" />
          <div>
            <p className="label-caps">Bola com o cliente</p>
            <p className="painel-kpi-value painel-kpi-value--warn">
              {stats.bolaCliente} <span>jobs</span>
            </p>
          </div>
        </div>
        <div className="painel-kpi-card painel-kpi-card--warn">
          <IconBadge icon={<Clock size={18} aria-hidden="true" />} color="var(--farol-atencao-fill)" />
          <div>
            <p className="label-caps">Retenção do cliente</p>
            <p className="painel-kpi-value painel-kpi-value--warn">
              {stats.retencaoDias} <span>dias somados</span>
            </p>
          </div>
        </div>
        <div className="painel-kpi-card painel-kpi-card--captacao">
          <IconBadge icon={<Clapperboard size={18} aria-hidden="true" />} color="var(--fase-4-marcador)" />
          <div>
            <p className="label-caps">Entram em set</p>
            <p className="painel-kpi-value">
              {stats.entramEmSet} <span>jobs em Captação</span>
            </p>
          </div>
        </div>
      </section>

      <section className="painel-block" aria-labelledby="painel-farol-heading">
        <div className="painel-block-header painel-block-header--farol">
          <IconBadge icon={<TrafficCone size={18} aria-hidden="true" />} color="var(--color-primary)" />
          <h2 id="painel-farol-heading" className="painel-block-title">
            Farol
          </h2>
        </div>
        <div className="painel-card-grid">
          {FAROL_ORDER.map((level) => (
            <Link
              key={level}
              to={`/?farol=${level}`}
              className="painel-card"
              aria-label={`Ver jobs com farol ${FAROL_LABELS[level]} (${farolCounts[level]})`}
            >
              <IconBadge icon={FAROL_ICONS[level]} color={FAROL_FILL_VARS[level]} />
              <span className="painel-card-label">{FAROL_LABELS[level]}</span>
              <span className="painel-card-value">{farolCounts[level]}</span>
            </Link>
          ))}
        </div>
        {stats.ativos > 0 ? (
          <div
            className="painel-status-bar"
            role="img"
            aria-label={`Distribuição de farol: ${FAROL_ORDER.map((l) => `${FAROL_LABELS[l]} ${farolCounts[l]}`).join(', ')}`}
          >
            {FAROL_ORDER.map(
              (level) =>
                farolCounts[level] > 0 && (
                  <span
                    key={level}
                    className="painel-status-segment"
                    style={{ background: FAROL_COLOR_VARS[level], flexGrow: farolCounts[level] }}
                  />
                ),
            )}
          </div>
        ) : (
          <p className="painel-empty">Nenhum job ativo.</p>
        )}
      </section>

      <section className="painel-block" aria-labelledby="painel-fase-heading">
        <div className="painel-block-header painel-block-header--fase">
          <IconBadge icon={<Layers size={18} aria-hidden="true" />} color="var(--color-primary)" />
          <h2 id="painel-fase-heading" className="painel-block-title">
            Fase
          </h2>
        </div>
        <div className="painel-card-grid">
          {phases.map((phase) => (
            <Link
              key={phase.id}
              to={`/?fase=${phase.id}`}
              className="painel-card"
              aria-label={`Ver jobs na fase ${phase.name} (${faseCounts.get(phase.id) ?? 0})`}
            >
              <IconBadge icon={<Layers size={18} aria-hidden="true" />} color={phaseMarkerColor(phase.order)} />
              <span className="painel-card-label">{phase.name}</span>
              <span className="painel-card-value">{faseCounts.get(phase.id) ?? 0}</span>
            </Link>
          ))}
        </div>
        <ul className="painel-bar-list">
          {phases.map((phase) => {
            const count = faseCounts.get(phase.id) ?? 0;
            return (
              <li key={phase.id}>
                <Link
                  to={`/?fase=${phase.id}`}
                  className="painel-bar-row"
                  aria-label={`Ver jobs na fase ${phase.name} (${count})`}
                >
                  <span className="painel-bar-row-label">{phase.name}</span>
                  <span className="painel-bar-track">
                    <span
                      className="painel-bar-fill"
                      style={{ width: `${(count / faseMax) * 100}%`, background: phaseMarkerColor(phase.order) }}
                    />
                  </span>
                  <span className="painel-bar-row-count">{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="painel-block" aria-labelledby="painel-atendimento-heading">
        <div className="painel-block-header painel-block-header--atendimento">
          <IconBadge icon={<User size={18} aria-hidden="true" />} color="var(--color-primary)" />
          <h2 id="painel-atendimento-heading" className="painel-block-title">
            Atendimento
          </h2>
        </div>
        <div className="painel-card-grid">
          {atendimentoPeople.map((person) => (
            <Link
              key={person.id}
              to={`/?atendimento=${person.id}`}
              className="painel-card"
              aria-label={`Ver jobs de ${person.name} (${atendimentoCounts.get(person.id) ?? 0})`}
            >
              <IconBadge icon={<User size={18} aria-hidden="true" />} color="var(--color-primary)" />
              <span className="painel-card-label">{person.name}</span>
              <span className="painel-card-value">{atendimentoCounts.get(person.id) ?? 0}</span>
            </Link>
          ))}
        </div>
        <ul className="painel-bar-list">
          {atendimentoSorted.map((person) => {
            const count = atendimentoCounts.get(person.id) ?? 0;
            return (
              <li key={person.id}>
                <Link
                  to={`/?atendimento=${person.id}`}
                  className="painel-bar-row"
                  aria-label={`Ver jobs de ${person.name} (${count})`}
                >
                  <span className="painel-bar-row-label">{person.name}</span>
                  <span className="painel-bar-track">
                    <span
                      className="painel-bar-fill painel-bar-fill--sequential"
                      style={{ width: `${(count / atendimentoMax) * 100}%` }}
                    />
                  </span>
                  <span className="painel-bar-row-count">{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
