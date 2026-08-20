import type { AppDatabase } from '../db';
import { getJobById, setJobStatus } from './job';
import { listPhasesWithStatuses, type Status } from './reference';
import { setBolaCom, type BolaCom } from './bolaCom';
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

  // Track wherever the job's status and bola-com side actually stand as
  // suggestions are applied one at a time within this batch — NOT frozen
  // pre-loop snapshots. Without this, a batch with e.g. [order 5, order 3]
  // would apply order 5 first (a legitimate forward move), then check order 3
  // against the stale starting order instead of the real post-write order 5,
  // wrongly treating a real regression (5 -> 3) as still-forward and
  // auto-applying it. The same tracking is used to detect a suggestion that
  // merely re-confirms the position/side the job is already at.
  let trackedOrder = startingOrder;
  let trackedSide: BolaCom = job.bolaCom;

  const resolved: ResolvedSuggestion[] = [];
  for (const suggestion of raw) {
    const { outcome, appliedOrder, appliedSide } = await resolveAndApply(
      db,
      jobId,
      phase.statuses,
      trackedOrder,
      trackedSide,
      suggestion,
    );
    if (appliedOrder !== undefined) {
      trackedOrder = appliedOrder;
    }
    if (appliedSide !== undefined) {
      trackedSide = appliedSide;
    }
    resolved.push({ ...suggestion, outcome });
  }

  return resolved;
}

interface ResolveResult {
  outcome: SuggestionOutcome;
  /** New checklist order after a checklist_item auto-apply, so the caller can advance its tracked order. */
  appliedOrder?: number;
  /** New bola-com side after a bola_com auto-apply, so the caller can advance its tracked side. */
  appliedSide?: BolaCom;
}

/**
 * The AI response is untrusted input at runtime — `RawSuggestion` is only a
 * compile-time type; nothing has verified the parsed tool-call JSON actually
 * matches it. A malformed `confidence` (e.g. a string) would otherwise pass
 * the `<`/`>=` threshold comparisons via JS coercion and only blow up later
 * on `.toFixed()` — after earlier suggestions in the same batch may have
 * already committed writes. Reject anything malformed up front, before any
 * threshold comparison touches the field.
 */
function isValidRawSuggestion(suggestion: RawSuggestion): boolean {
  return (
    typeof suggestion.confidence === 'number' &&
    Number.isFinite(suggestion.confidence) &&
    (suggestion.tipo === 'checklist_item' || suggestion.tipo === 'bola_com')
  );
}

async function resolveAndApply(
  db: AppDatabase,
  jobId: number,
  statuses: Status[],
  currentOrder: number,
  currentSide: BolaCom,
  suggestion: RawSuggestion,
): Promise<ResolveResult> {
  if (!isValidRawSuggestion(suggestion)) {
    return { outcome: 'descartado' };
  }

  if (suggestion.confidence < SUGGEST_THRESHOLD) {
    return { outcome: 'descartado' };
  }

  if (suggestion.tipo === 'checklist_item') {
    const target = statuses.find((s) => s.name === suggestion.valor);
    if (!target) {
      return { outcome: 'descartado' };
    }

    if (target.order === currentOrder) {
      // Re-confirming the milestone the job is already on: nothing changed,
      // so there is nothing to write. Writing anyway would insert a fresh
      // job_status_history row and silently reset the alert-level clock for
      // a job that may have been stuck at this status for days.
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

  if (suggestion.valor === currentSide) {
    // Re-confirming the side the ball is already with: nothing changed, so
    // there is nothing to write. Writing anyway would insert a fresh
    // job_bola_com_history row and silently zero an in-progress streak.
    return { outcome: 'descartado' };
  }

  if (suggestion.confidence >= AUTO_APPLY_THRESHOLD) {
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    await setBolaCom(db, jobId, suggestion.valor, evidenceNote);
    return { outcome: 'auto_aplicado', appliedSide: suggestion.valor };
  }

  return { outcome: 'pendente' };
}
