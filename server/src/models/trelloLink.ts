import type { AppDatabase } from '../db';
import { listPeople, type Person } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';
import { setAtendimento, setJobName, type Job } from './job';
import { classifyAndApply, type ResolvedSuggestion } from './classification';
import { buildTrelloEvidenceText } from './trelloMatch';
import type { Classifier } from '../services/classifier';
import type { TrelloClient } from '../services/trello';

export async function setTrelloLink(
  db: AppDatabase,
  jobId: number,
  trelloCardId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE jobs
     SET trello_card_id = $1,
         trello_linked_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
         updated_at = now()
     WHERE id = $2`,
    [trelloCardId, jobId],
  );
}

function normalizePersonName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function findMatchingPerson(candidates: Person[], normalizedMembers: string[]): Person | undefined {
  return candidates.find((person) => {
    const normalizedPersonName = normalizePersonName(person.name);
    return normalizedMembers.some(
      (member) => member.includes(normalizedPersonName) || normalizedPersonName.includes(member),
    );
  });
}

/**
 * Deterministic (no AI): a Trello card's assigned members are a literal
 * identity match against `people`, not a fuzzy status inference, so this
 * never goes through the classifier. Only fills role areas that are
 * currently unassigned for this job/phase — never overwrites an existing
 * assignment, whether it was set manually or by a previous sync.
 */
export async function syncTrelloMembersToRoles(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
  trelloMemberNames: string[],
): Promise<void> {
  if (trelloMemberNames.length === 0) {
    return;
  }

  const [roleAssignments, people] = await Promise.all([
    getJobRoleAssignments(db, jobId, phaseId),
    listPeople(db, { activeOnly: true }),
  ]);

  const normalizedMembers = trelloMemberNames.map(normalizePersonName);

  for (const assignment of roleAssignments) {
    if (assignment.personId !== null) {
      continue;
    }

    const match = findMatchingPerson(
      people.filter((person) => person.area === assignment.area),
      normalizedMembers,
    );

    if (match) {
      await setJobRoleAssignment(db, jobId, phaseId, assignment.area, match.id);
    }
  }
}

/**
 * Atendimento is a single job-level field (jobs.atendimento_person_id), not
 * a phase_roles area — since the "Atendimento Responsável" plan, it's
 * resolved separately from syncTrelloMembersToRoles above, which no longer
 * ever sees "Atendimento" as one of the areas it iterates (phase_roles
 * doesn't list it anymore). Atendimento is required at job creation now, so
 * in practice this only ever has something to do for jobs created before
 * that requirement existed (currentAtendimentoPersonId is null for those) —
 * same "never overwrite" rule as every other Trello-driven assignment.
 */
export async function syncTrelloMembersToAtendimento(
  db: AppDatabase,
  jobId: number,
  currentAtendimentoPersonId: number | null,
  trelloMemberNames: string[],
): Promise<void> {
  if (currentAtendimentoPersonId !== null || trelloMemberNames.length === 0) {
    return;
  }

  const atendimentoPeople = (await listPeople(db, { activeOnly: true })).filter(
    (person) => person.area === 'Atendimento',
  );
  const normalizedMembers = trelloMemberNames.map(normalizePersonName);
  const match = findMatchingPerson(atendimentoPeople, normalizedMembers);

  if (match) {
    await setAtendimento(db, jobId, match.id);
  }
}

export type TrelloSyncResult =
  | { status: 'synced'; suggestions: ResolvedSuggestion[]; trelloCard: { name: string; listName: string } }
  | { status: 'card_not_found' };

/**
 * Shared by both the manual "open the job" sync (POST /:id/trello-sync,
 * bypassConfidenceGate: false) and the Trello webhook (POST
 * /api/trello-webhook, bypassConfidenceGate: true) — the only difference
 * between the two triggers is whether classifyAndApply's confidence gate
 * applies. See docs/superpowers/specs/2026-08-21-trello-webhook-design.md.
 *
 * classifier is optional: matching Trello card members to Atendimento/role
 * areas is deterministic name-matching, not AI, so it runs unconditionally.
 * Only the checklist-driven status suggestions need the classifier — when
 * ANTHROPIC_API_KEY isn't configured, suggestions comes back empty instead
 * of blocking the whole sync (this used to be gated together at the route
 * level, which meant the member/Atendimento matching silently never ran at
 * all without an AI key, even though it never needed one).
 */
export async function syncJobFromTrello(
  db: AppDatabase,
  trelloClient: TrelloClient,
  classifier: Classifier | undefined,
  job: Job,
  options: { bypassConfidenceGate: boolean },
): Promise<TrelloSyncResult> {
  if (!job.trelloCardId) {
    throw new Error('job is not linked to a Trello card');
  }

  const card = await trelloClient.getCard(job.trelloCardId);
  if (!card) {
    await setTrelloLink(db, job.id, null);
    return { status: 'card_not_found' };
  }

  // O card do Trello é a fonte da verdade pro nome, uma vez vinculado —
  // se alguém renomeou o card lá (ou o job aqui, e ficou desatualizado),
  // toda sincronização realinha o nome do job com o nome atual do card.
  if (card.name !== job.name) {
    await setJobName(db, job.id, card.name);
  }

  if (job.phaseId) {
    await syncTrelloMembersToRoles(db, job.id, job.phaseId, card.members);
  }
  await syncTrelloMembersToAtendimento(db, job.id, job.atendimentoPersonId, card.members);

  let suggestions: ResolvedSuggestion[] = [];
  if (classifier) {
    const evidenceText = buildTrelloEvidenceText(card);
    suggestions = await classifyAndApply(db, classifier, job.id, evidenceText, {
      bypassConfidenceGate: options.bypassConfidenceGate,
    });
  }

  return { status: 'synced', suggestions, trelloCard: { name: card.name, listName: card.listName } };
}
