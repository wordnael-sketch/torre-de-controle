import type { AppDatabase } from '../db';
import { getJobById, setJobStatus } from './job';
import { listPhasesWithStatuses, type Status } from './reference';
import { setBolaCom } from './bolaCom';
import type { Classifier, RawSuggestion } from '../services/classifier';

export type SuggestionOutcome = 'auto_aplicado' | 'pendente' | 'descartado';

export interface ResolvedSuggestion extends RawSuggestion {
  outcome: SuggestionOutcome;
}

const AUTO_APPLY_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.6;

export async function classifyAndApply(
  db: AppDatabase,
  classifier: Classifier,
  jobId: number,
  pastedText: string,
): Promise<ResolvedSuggestion[]> {
  const job = await getJobById(db, jobId);
  if (!job || !job.phaseId) {
    throw new Error('Job not found or has no current phase');
  }

  const phases = await listPhasesWithStatuses(db);
  const phase = phases.find((p) => p.id === job.phaseId);
  if (!phase) {
    throw new Error('Job phase not found in reference data');
  }

  const currentStatus = phase.statuses.find((s) => s.id === job.statusId);
  const startingOrder = currentStatus?.order ?? 0;

  const checklist = phase.statuses.map((status) => ({
    name: status.name,
    done: status.order <= startingOrder,
  }));

  const raw = await classifier.classify({
    jobName: job.name,
    phaseName: phase.name,
    checklist,
    bolaCom: job.bolaCom,
    pastedText,
  });

  // Tracks wherever the job's status actually stands as suggestions are applied
  // one at a time within this batch — NOT a frozen pre-loop snapshot. Without
  // this, a batch with e.g. [order 5, order 3] would apply order 5 first (a
  // legitimate forward move), then check order 3 against the stale starting
  // order instead of the real post-write order 5, wrongly treating a real
  // regression (5 -> 3) as still-forward and auto-applying it.
  let trackedOrder = startingOrder;

  const resolved: ResolvedSuggestion[] = [];
  for (const suggestion of raw) {
    const { outcome, appliedOrder } = await resolveAndApply(db, jobId, phase.statuses, trackedOrder, suggestion);
    if (appliedOrder !== undefined) {
      trackedOrder = appliedOrder;
    }
    resolved.push({ ...suggestion, outcome });
  }

  return resolved;
}

interface ResolveResult {
  outcome: SuggestionOutcome;
  /** New checklist order after a checklist_item auto-apply, so the caller can advance its tracked order. */
  appliedOrder?: number;
}

async function resolveAndApply(
  db: AppDatabase,
  jobId: number,
  statuses: Status[],
  currentOrder: number,
  suggestion: RawSuggestion,
): Promise<ResolveResult> {
  if (suggestion.confidence < SUGGEST_THRESHOLD) {
    return { outcome: 'descartado' };
  }

  if (suggestion.tipo === 'checklist_item') {
    const target = statuses.find((s) => s.name === suggestion.valor);
    if (!target) {
      return { outcome: 'descartado' };
    }

    const isRegression = target.order < currentOrder;
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;

    if (suggestion.confidence >= AUTO_APPLY_THRESHOLD && !isRegression) {
      await setJobStatus(db, jobId, target.id, evidenceNote);
      return { outcome: 'auto_aplicado', appliedOrder: target.order };
    }

    return { outcome: 'pendente' };
  }

  if (suggestion.valor !== 'ilha' && suggestion.valor !== 'cliente') {
    return { outcome: 'descartado' };
  }

  if (suggestion.confidence >= AUTO_APPLY_THRESHOLD) {
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    await setBolaCom(db, jobId, suggestion.valor, evidenceNote);
    return { outcome: 'auto_aplicado' };
  }

  return { outcome: 'pendente' };
}
