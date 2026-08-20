import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
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

function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hasFocusedRef = useRef(false);

  function handleClose() {
    navigate('/');
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hasFocusedRef.current = false;
  }, [jobId]);

  const [job, setJob] = useState<JobDetailType | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhaseId, setExpandedPhaseId] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [suggestions, setSuggestions] = useState<ClassifySuggestion[] | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [pendingCompleteStatusId, setPendingCompleteStatusId] = useState<number | null>(null);

  async function refresh() {
    const [jobRes, referenceRes, peopleRes] = await Promise.all([
      api.getJob(jobId),
      api.getReference(),
      api.listPeople(),
    ]);
    setJob(jobRes.job);
    setPhases(referenceRes.phases);
    setPeople(peopleRes.people);
    setExpandedPhaseId((current) => current ?? jobRes.job.phaseId);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o job.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => {
    if (job && !hasFocusedRef.current) {
      closeButtonRef.current?.focus();
      hasFocusedRef.current = true;
    }
  }, [job]);

  const currentPhaseOrder = useMemo(
    () => phases.find((p) => p.id === job?.phaseId)?.order ?? 0,
    [phases, job],
  );

  function isFinalStatus(statusId: number): boolean {
    const lastPhase = phases[phases.length - 1];
    if (!lastPhase) return false;
    const lastStatus = lastPhase.statuses[lastPhase.statuses.length - 1];
    return lastStatus?.id === statusId;
  }

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

  async function handleBolaComToggle(side: 'ilha' | 'cliente') {
    if (!job || side === job.bolaCom) return;
    setError(null);
    try {
      await api.setBolaCom(jobId, side);
      await refresh();
    } catch {
      setError('Não foi possível trocar a bola.');
    }
  }

  async function handleSetLastActivityNow() {
    setError(null);
    try {
      await api.setLastActivity(jobId, new Date().toISOString());
      await refresh();
    } catch {
      setError('Não foi possível atualizar a última atividade.');
    }
  }

  async function handleClearLastActivity() {
    setError(null);
    try {
      await api.setLastActivity(jobId, null);
      await refresh();
    } catch {
      setError('Não foi possível limpar a última atividade.');
    }
  }

  async function handleAssignRole(area: string, personId: number | null) {
    setError(null);
    try {
      await api.assignRole(jobId, area, personId);
      await refresh();
    } catch {
      setError('Não foi possível atribuir a pessoa a esse papel.');
    }
  }

  async function handleClassify() {
    if (!pasteText.trim()) return;
    setError(null);
    setClassifying(true);
    try {
      const res = await api.classifyJob(jobId, pasteText);
      setSuggestions(res.suggestions);
      setPasteText('');
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError('A classificação por IA ainda não está configurada neste ambiente.');
      } else {
        setError('Não foi possível analisar o texto colado.');
      }
    } finally {
      setClassifying(false);
    }
  }

  async function handleApplySuggestion(suggestion: ClassifySuggestion) {
    setError(null);
    try {
      if (suggestion.tipo === 'bola_com' && (suggestion.valor === 'ilha' || suggestion.valor === 'cliente')) {
        await api.setBolaCom(jobId, suggestion.valor);
      } else {
        const target = phases.flatMap((p) => p.statuses).find((s) => s.name === suggestion.valor);
        if (target) await api.setJobStatus(jobId, target.id);
      }
      setSuggestions((prev) => prev?.filter((s) => s !== suggestion) ?? null);
      await refresh();
    } catch {
      setError('Não foi possível aplicar a sugestão.');
    }
  }

  function dismissSuggestion(suggestion: ClassifySuggestion) {
    setSuggestions((prev) => prev?.filter((s) => s !== suggestion) ?? null);
  }

  const peopleByArea = (area: string) => people.filter((p) => p.area === area && p.active);

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
            <X size={20} aria-hidden="true" />
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

        {pendingCompleteStatusId !== null && (
          <ConfirmDialog
            title="Concluir job"
            message="Marcar job como concluído? Isso completa o ciclo do job."
            confirmLabel="Concluir"
            onConfirm={() => void confirmComplete()}
            onCancel={() => setPendingCompleteStatusId(null)}
          />
        )}
      </div>
    </div>
  );
}
