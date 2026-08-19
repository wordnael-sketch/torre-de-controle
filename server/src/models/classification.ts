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
  const currentOrder = currentStatus?.order ?? 0;

  const checklist = phase.statuses.map((status) => ({
    name: status.name,
    done: status.order <= currentOrder,
  }));

  const raw = await classifier.classify({
    jobName: job.name,
    phaseName: phase.name,
    checklist,
    bolaCom: job.bolaCom,
    pastedText,
  });

  const resolved: ResolvedSuggestion[] = [];
  for (const suggestion of raw) {
    const outcome = await resolveAndApply(db, jobId, phase.statuses, currentOrder, suggestion);
    resolved.push({ ...suggestion, outcome });
  }

  return resolved;
}

async function resolveAndApply(
  db: AppDatabase,
  jobId: number,
  statuses: Status[],
  currentOrder: number,
  suggestion: RawSuggestion,
): Promise<SuggestionOutcome> {
  if (suggestion.confidence < SUGGEST_THRESHOLD) {
    return 'descartado';
  }

  if (suggestion.tipo === 'checklist_item') {
    const target = statuses.find((s) => s.name === suggestion.valor);
    if (!target) {
      return 'descartado';
    }

    const isRegression = target.order < currentOrder;
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;

    if (suggestion.confidence >= AUTO_APPLY_THRESHOLD && !isRegression) {
      await setJobStatus(db, jobId, target.id, evidenceNote);
      return 'auto_aplicado';
    }

    return 'pendente';
  }

  if (suggestion.valor !== 'ilha' && suggestion.valor !== 'cliente') {
    return 'descartado';
  }

  if (suggestion.confidence >= AUTO_APPLY_THRESHOLD) {
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    await setBolaCom(db, jobId, suggestion.valor, evidenceNote);
    return 'auto_aplicado';
  }

  return 'pendente';
}
