import type { AppDatabase } from '../db';
import { listPeople, type Person } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';
import {
  setAtendimento,
  setJobName,
  setTrelloStatusUpdates,
  setTrelloChecklistItems,
  findJobByName,
  type Job,
} from './job';
import { classifyAndApply, type ResolvedSuggestion } from './classification';
import { buildTrelloEvidenceText, extractStatusUpdates } from './trelloMatch';
import type { Classifier } from '../services/classifier';
import type { TrelloCardDetail, TrelloClient, TrelloLabel } from '../services/trello';

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
    // Pessoas com nomes ambíguos entre escritórios são cadastradas como
    // "Bianca (Brasília)", "Renata (RJ)" etc. — esse sufixo nunca aparece no
    // nome real de ninguém no Trello, então precisa cair fora antes da
    // comparação por substring, senão o match nunca bate.
    .replace(/\([^)]*\)/g, '')
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

export interface TrelloCardView {
  name: string;
  listName: string;
  description: string | null;
  url: string;
  labels: TrelloLabel[];
  members: string[];
  /**
   * Pessoas envolvidas, de verdade: nesse board a equipe usa Etiquetas do
   * Trello pra marcar responsáveis (ex.: "Vicky Salles"), não só o campo
   * Membros — então a lista fiel de "quem está no job" é a união das duas,
   * sem duplicar quem aparece nas duas.
   */
  people: string[];
}

function buildTrelloCardView(card: TrelloCardDetail): TrelloCardView {
  const labelNames = card.labels.map((l) => l.name).filter((name) => name.trim().length > 0);
  const people = [...new Set([...card.members, ...labelNames])];

  return {
    name: card.name,
    listName: card.listName,
    description: card.description,
    url: card.url,
    labels: card.labels,
    members: card.members,
    people,
  };
}

export type TrelloSyncResult =
  | { status: 'synced'; suggestions: ResolvedSuggestion[]; trelloCard: TrelloCardView }
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
  // Mas nunca pra um nome que já pertence a outro job — isso rodaria sem
  // supervisão (webhook) e criaria a mesma duplicata de nome que a trava
  // de unicidade existe pra impedir.
  if (card.name !== job.name) {
    const nameConflict = await findJobByName(db, card.name);
    if (!nameConflict || nameConflict.id === job.id) {
      await setJobName(db, job.id, card.name);
    }
  }

  // Quem está de fato tocando o job nem sempre está marcado como "member" do
  // card no Trello — às vezes só aparece comentando os status, ou (nesse
  // board) marcado como Etiqueta em vez de Membro. Os três conjuntos de
  // nomes alimentam o mesmo match determinístico.
  const memberNames = [
    ...card.members,
    ...card.comments.map((comment) => comment.author),
    ...card.labels.map((label) => label.name),
  ];

  if (job.phaseId) {
    await syncTrelloMembersToRoles(db, job.id, job.phaseId, memberNames);
  }
  await syncTrelloMembersToAtendimento(db, job.id, job.atendimentoPersonId, memberNames);

  const statusUpdates = extractStatusUpdates(card.comments);
  if (JSON.stringify(statusUpdates) !== JSON.stringify(job.trelloStatusUpdates)) {
    await setTrelloStatusUpdates(db, job.id, statusUpdates);
  }

  // Espelho somente-leitura do checklist do Trello — não influencia a fase/
  // status do job, que continua vindo só do checklist de fases do sistema.
  if (JSON.stringify(card.checklistItems) !== JSON.stringify(job.trelloChecklistItems)) {
    await setTrelloChecklistItems(db, job.id, card.checklistItems);
  }

  let suggestions: ResolvedSuggestion[] = [];
  if (classifier) {
    const evidenceText = buildTrelloEvidenceText(card);
    suggestions = await classifyAndApply(db, classifier, job.id, evidenceText, {
      bypassConfidenceGate: options.bypassConfidenceGate,
    });
  }

  return { status: 'synced', suggestions, trelloCard: buildTrelloCardView(card) };
}
