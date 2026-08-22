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
  type TrelloCandidate,
  type TrelloCardSummary,
  type TrelloBoardCard,
} from '../api/client';
import { phaseMarkerColor, phaseTextColor } from '../theme/phase';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { showToast } from '../components/Toast';
import { useAuth } from '../auth/AuthContext';
import './JobDetail.css';

function hoursSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** Descrição/comentários do Trello são texto puro — isso só torna as URLs que já vêm ali clicáveis. */
function linkify(text: string): (string | JSX.Element)[] {
  // O regex tem um grupo de captura, então split() intercala os trechos que
  // NÃO são URL (índices pares) com os que SÃO (índices ímpares) — não precisa
  // testar de novo com o regex global (que tem estado e erraria alternando).
  return text.split(URL_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <a key={index} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

const TRELLO_LABEL_COLORS: Record<string, string> = {
  green: '#4bce97',
  yellow: '#e2b203',
  orange: '#faa53d',
  red: '#f87462',
  purple: '#9f8fef',
  blue: '#579dff',
  sky: '#6cc3e0',
  lime: '#94c748',
  pink: '#e774bb',
  black: '#8590a2',
};

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  const { user } = useAuth();
  const navigate = useNavigate();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const hasFocusedRef = useRef(false);

  function handleClose() {
    navigate('/');
  }

  // ConfirmDialog registers its own document-level Escape listener to dismiss
  // itself. When it's open on top of this drawer, both listeners fire on the same
  // keydown event, so this handler must skip closing the whole drawer and let
  // ConfirmDialog's own listener handle dismissing just the confirmation.
  const pendingCompleteStatusIdRef = useRef<number | null>(null);
  const pendingDeleteRef = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && pendingCompleteStatusIdRef.current === null && !pendingDeleteRef.current) {
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
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [trelloCandidates, setTrelloCandidates] = useState<TrelloCandidate[] | null>(null);
  const [trelloCard, setTrelloCard] = useState<TrelloCardSummary | null>(null);
  const trelloSyncedRef = useRef(false);
  const [allTrelloCards, setAllTrelloCards] = useState<TrelloBoardCard[] | null>(null);
  const [loadingAllTrelloCards, setLoadingAllTrelloCards] = useState(false);
  const [trelloCardSearch, setTrelloCardSearch] = useState('');

  const filteredTrelloCards = useMemo(() => {
    if (!allTrelloCards) return [];
    const term = trelloCardSearch.trim().toLowerCase();
    if (!term) return allTrelloCards;
    return allTrelloCards.filter((c) => c.name.toLowerCase().includes(term));
  }, [allTrelloCards, trelloCardSearch]);

  useEffect(() => {
    pendingCompleteStatusIdRef.current = pendingCompleteStatusId;
  }, [pendingCompleteStatusId]);

  useEffect(() => {
    pendingDeleteRef.current = pendingDelete;
  }, [pendingDelete]);

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

    if (!trelloSyncedRef.current) {
      trelloSyncedRef.current = true;
      void syncOrLinkTrello(jobRes.job);
    }
  }

  async function linkAndSync(targetJobId: number, card: { id: string; name: string; listName: string }) {
    await api.setTrelloLink(targetJobId, card.id);
    try {
      const res = await api.syncTrello(targetJobId);
      setSuggestions(res.suggestions);
      setTrelloCard(res.trelloCard);
    } catch {
      // Sincronização (dados ricos: descrição, etiquetas, pessoas) falhou logo
      // após vincular — mostra pelo menos o nome/lista já conhecidos do card.
      setTrelloCard({ name: card.name, listName: card.listName });
    }
  }

  async function syncOrLinkTrello(currentJob: JobDetailType) {
    if (currentJob.trelloCardId) {
      try {
        const res = await api.syncTrello(currentJob.id);
        setSuggestions(res.suggestions);
        setTrelloCard(res.trelloCard);
        await refresh();
      } catch {
        // Sincronização automática falhou (Trello não configurado, indisponível, ou IA não
        // configurada) — falha silenciosa é aceitável aqui: é uma tentativa em segundo plano,
        // não uma ação que o usuário pediu diretamente. O painel de colar mensagens do
        // WhatsApp continua disponível como alternativa manual.
      }
      return;
    }

    try {
      const res = await api.getTrelloCandidates(currentJob.id);
      const normalizedJobName = currentJob.name.trim().toLowerCase();
      const exactMatch = res.candidates.find((c) => c.name.trim().toLowerCase() === normalizedJobName);
      const strongMatches = res.candidates.filter((c) => c.strongMatch);

      if (exactMatch) {
        // Nome do job idêntico ao do card — vincula direto, sem passar pelo
        // seletor de candidatos, mesmo que outros cards também deem match forte.
        await linkAndSync(currentJob.id, exactMatch);
        await refresh();
      } else if (strongMatches.length === 1) {
        await linkAndSync(currentJob.id, strongMatches[0]);
        await refresh();
      } else if (res.candidates.length > 0) {
        setTrelloCandidates(res.candidates);
      }
    } catch {
      // Trello não configurado ou indisponível — não mostra nada relacionado a Trello.
    }
  }

  useEffect(() => {
    trelloSyncedRef.current = false;
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

  async function handleDeleteJob() {
    setPendingDelete(false);
    setDeleting(true);
    try {
      await api.deleteJob(jobId);
      showToast('Job excluído.', 'success');
      navigate('/');
    } catch {
      setError('Não foi possível excluir o job.');
      setDeleting(false);
    }
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

  // Recebe o card inteiro (não só o id): precisamos do nome/lista pra
  // acender o indicador "Vinculado ao card" na hora, sem esperar o
  // usuário recarregar a página — o mesmo cuidado já tomado no caminho de
  // vinculação automática. Depois de vincular, sincroniza na hora também
  // (é o "e sincronizar" do botão manual), com um resultado só um pouco
  // menos completo (nome/lista já conhecidos) se a sincronização falhar.
  async function handleLinkTrello(card: { id: string; name: string; listName: string }) {
    setError(null);
    try {
      setTrelloCandidates(null);
      setAllTrelloCards(null);
      await linkAndSync(jobId, card);
      await refresh();
    } catch {
      setError('Não foi possível vincular o card do Trello.');
    }
  }

  async function handleShowAllTrelloCards() {
    setError(null);
    setLoadingAllTrelloCards(true);
    try {
      const res = await api.getAllTrelloCards(jobId);
      setAllTrelloCards(res.cards);
      setTrelloCardSearch('');
    } catch {
      setError('Não foi possível carregar os cards do Trello.');
    } finally {
      setLoadingAllTrelloCards(false);
    }
  }

  async function handleUnlinkTrello() {
    setError(null);
    try {
      await api.setTrelloLink(jobId, null);
      setTrelloCard(null);
      trelloSyncedRef.current = false;
      await refresh();
    } catch {
      setError('Não foi possível desvincular o card do Trello.');
    }
  }

  async function handleAssignAtendimento(personId: number) {
    if (!personId) return;
    setError(null);
    try {
      await api.setAtendimento(jobId, personId);
      await refresh();
    } catch {
      setError('Não foi possível atualizar o Atendimento responsável.');
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
            <p className="job-detail-phase" style={{ color: phaseTextColor(currentPhaseOrder) }}>
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

        <div className="job-detail-atendimento">
          <span className="label-caps">Atendimento responsável</span>
          <select
            aria-label="Atendimento responsável"
            value={job.atendimentoPersonId ?? ''}
            onChange={(e) => handleAssignAtendimento(Number(e.target.value))}
          >
            <option value="" disabled>
              (selecionar)
            </option>
            {peopleByArea('Atendimento').map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.title ? ` · ${person.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        {!job.atendimentoPersonId && (
          <p className="job-detail-warning job-detail-warning--red">
            Nenhum Atendimento responsável atribuído — selecione um acima.
          </p>
        )}

        {job.trelloAutoUnlinkedAt && (
          <p className="job-detail-warning job-detail-warning--amber">
            Desvinculado do Trello automaticamente em{' '}
            {new Date(job.trelloAutoUnlinkedAt).toLocaleDateString('pt-BR')} — o card foi arquivado ou apagado
            lá.
          </p>
        )}

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
          <button type="button" className="job-detail-action-btn" onClick={handleSetLastActivityNow}>
            Marcar atividade do grupo agora
          </button>
        )}

        {error && (
          <p role="alert" className="job-detail-error">
            {error}
          </p>
        )}

        {trelloCard && (
          <div className="job-detail-trello-card">
            <p className="job-detail-trello-indicator label-caps">
              Vinculado ao card: {trelloCard.name} ({trelloCard.listName}){' '}
              {trelloCard.url && (
                <a href={trelloCard.url} target="_blank" rel="noreferrer noopener">
                  abrir no Trello
                </a>
              )}{' '}
              <button type="button" className="job-detail-link-btn" onClick={() => void handleUnlinkTrello()}>
                desvincular
              </button>
            </p>

            {trelloCard.labels && trelloCard.labels.length > 0 && (
              <ul className="job-detail-trello-labels">
                {trelloCard.labels.map((label, index) => (
                  <li
                    key={index}
                    className="job-detail-trello-label"
                    style={{ background: TRELLO_LABEL_COLORS[label.color ?? ''] ?? 'var(--bg-subtle)' }}
                  >
                    {label.name || label.color || 'sem nome'}
                  </li>
                ))}
              </ul>
            )}

            {trelloCard.people && trelloCard.people.length > 0 && (
              <p className="job-detail-trello-people">
                <span className="label-caps">Pessoas envolvidas: </span>
                {trelloCard.people.join(', ')}
              </p>
            )}

            {trelloCard.description && (
              <p className="job-detail-trello-description">{linkify(trelloCard.description)}</p>
            )}
          </div>
        )}

        {job.trelloChecklistItems.length > 0 && (
          <div className="job-detail-trello-checklist">
            <p className="label-caps">
              Checklist do Trello ({job.trelloChecklistItems.filter((i) => i.checked).length}/
              {job.trelloChecklistItems.length})
            </p>
            <ul className="job-detail-trello-checklist-items">
              {job.trelloChecklistItems.map((item, index) => (
                <li
                  key={index}
                  className={`job-detail-trello-checklist-item${item.checked ? ' is-checked' : ''}`}
                >
                  <span className="job-detail-checkbox" aria-hidden="true">
                    {item.checked ? '✓' : ''}
                  </span>
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {job.trelloStatusUpdates.length > 0 && (
          <div className="job-detail-trello-status">
            <p className="label-caps">Comentários do Trello</p>
            <ul className="job-detail-trello-status-list">
              {job.trelloStatusUpdates.map((update, index) => (
                <li key={index} className="job-detail-trello-status-item">
                  <p className="job-detail-trello-status-meta">
                    <span className="job-detail-trello-status-author">{update.author}</span>
                    {' · '}
                    <time dateTime={update.postedAt}>
                      {new Date(update.postedAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </p>
                  <p className="job-detail-trello-status-text">{update.text}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {trelloCandidates && trelloCandidates.length > 0 && (
          <div className="job-detail-trello-picker">
            <p className="label-caps">Vincular ao card do Trello</p>
            <ul>
              {trelloCandidates.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void handleLinkTrello(c)}>
                    {c.name} <span className="job-detail-trello-list">({c.listName})</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setTrelloCandidates([])}>
              Nenhum desses
            </button>
          </div>
        )}

        <button
          type="button"
          className="job-detail-action-btn"
          onClick={() => void handleShowAllTrelloCards()}
          disabled={loadingAllTrelloCards}
        >
          {loadingAllTrelloCards ? 'Carregando cards do Trello…' : 'Vincular ao Trello'}
        </button>

        {allTrelloCards && (
          <div className="job-detail-trello-picker job-detail-trello-picker--full">
            <p className="label-caps">Vincular ao card do Trello ({allTrelloCards.length} cards)</p>
            <input
              type="text"
              className="job-detail-trello-search"
              placeholder="Buscar por nome do card…"
              value={trelloCardSearch}
              onChange={(e) => setTrelloCardSearch(e.target.value)}
              autoFocus
              aria-label="Buscar card do Trello"
            />
            <ul>
              {filteredTrelloCards.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void handleLinkTrello(c)}>
                    {c.name} <span className="job-detail-trello-list">({c.listName})</span>
                  </button>
                </li>
              ))}
              {filteredTrelloCards.length === 0 && (
                <li className="job-detail-trello-empty">Nenhum card encontrado.</li>
              )}
            </ul>
            <button type="button" onClick={() => setAllTrelloCards(null)}>
              Fechar
            </button>
          </div>
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
                  <span className="job-detail-swatch" style={{ background: phaseMarkerColor(phase.order) }} />
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

        {user?.role === 'admin' && (
          <button
            type="button"
            className="job-detail-delete-btn"
            onClick={() => setPendingDelete(true)}
            disabled={deleting}
          >
            Excluir job
          </button>
        )}

        {pendingDelete && (
          <ConfirmDialog
            title="Excluir job"
            message={`Excluir "${job.name}" permanentemente? Essa ação não pode ser desfeita.`}
            confirmLabel="Excluir"
            onConfirm={() => void handleDeleteJob()}
            onCancel={() => setPendingDelete(false)}
          />
        )}
      </div>
    </div>
  );
}
