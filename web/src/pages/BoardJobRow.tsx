import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type { Job, Phase } from '../api/client';
import { FAROL_COLOR_VARS, phaseMarkerColor, phaseTextColor } from '../theme/phase';

export interface BoardJobRowHighlight {
  /** O "Avançar para" deste job difere do que a maioria do grupo mostra — só faz sentido na visão agrupada. */
  statusOutlier: boolean;
  /** Relógio de responsabilidade acima do limite (mesmo sinal já usado pelo farol vermelho). */
  clockOverLimit: boolean;
  /** Bola com o cliente por tempo suficiente pra já não estar mais em verde. */
  clientHeldLong: boolean;
}

interface BoardJobRowProps {
  job: Job;
  phases: Phase[];
  currentOrder: number;
  /** Falso na visão agrupada — o nome da fase já é o título do grupo, repeti-lo por linha é redundante por definição. */
  showPhaseText: boolean;
  /** Falso quando o cabeçalho do grupo já mostra o "Avançar para" comum a todo o grupo. */
  showTriggerText: boolean;
  highlight?: BoardJobRowHighlight;
  /** Ausente = edição inline desligada nesta linha (ex.: nenhum handler passado). */
  onRenameJob?: (jobId: number, name: string) => void;
}

export function BoardJobRow({
  job,
  phases,
  currentOrder,
  showPhaseText,
  showTriggerText,
  highlight,
  onRenameJob,
}: BoardJobRowProps) {
  const counts = job.bolaComDayCounts;
  const totalDays = (counts?.ilhaDays ?? 0) + (counts?.clienteDays ?? 0);
  const ilhaPct = totalDays === 0 ? (job.bolaCom === 'cliente' ? 0 : 100) : ((counts?.ilhaDays ?? 0) / totalDays) * 100;

  const isAttention = Boolean(highlight?.clockOverLimit || highlight?.clientHeldLong);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(job.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  function startEditingName() {
    setNameDraft(job.name);
    setIsEditingName(true);
  }

  function commitNameEdit() {
    const trimmed = nameDraft.trim();
    setIsEditingName(false);
    if (trimmed && trimmed !== job.name) {
      onRenameJob?.(job.id, trimmed);
    }
  }

  function cancelNameEdit() {
    setNameDraft(job.name);
    setIsEditingName(false);
  }

  function handleNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNameEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelNameEdit();
    }
  }

  return (
    <tr className={isAttention ? 'board-row--atencao' : undefined}>
      <td data-label="Fases">
        <div className="board-mini-bar">
          {phases.map((phase) => (
            <span
              key={phase.id}
              className="board-mini-segment"
              style={{ background: phase.order <= currentOrder ? phaseMarkerColor(phase.order) : 'var(--border)' }}
            />
          ))}
        </div>
      </td>
      <td data-label="Job">
        {isEditingName ? (
          <input
            ref={nameInputRef}
            className="board-job-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={commitNameEdit}
            aria-label="Editar nome do job"
          />
        ) : (
          <div className="board-job-cell">
            <Link to={`/jobs/${job.id}`} className="board-job-link">
              <span className="label-caps">{job.client ?? '—'}</span>
              <span className="board-job-name">{job.name}</span>
            </Link>
            {onRenameJob && (
              <button
                type="button"
                className="board-job-edit-btn"
                aria-label="Editar nome do job"
                onClick={startEditingName}
              >
                <Pencil size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </td>
      <td data-label="Etapa atual">
        {showPhaseText && (
          <p className="board-job-phase" style={{ color: phaseTextColor(currentOrder) }}>
            F{currentOrder} · {job.phaseName ?? ''}
          </p>
        )}
        {showTriggerText && job.triggerLabel && (
          <p className={`board-job-next${highlight?.statusOutlier ? ' board-job-next--diferente' : ''}`}>
            {job.triggerLabel}
          </p>
        )}
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
}
