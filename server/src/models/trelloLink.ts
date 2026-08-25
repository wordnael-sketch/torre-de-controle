import type { AppDatabase } from '../db';
import { listPeople, createPerson, type Person } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';
import {
  createJob,
  setAtendimento,
  setAtendimentoBackup,
  setJobName,
  setTrelloStatusUpdates,
  setTrelloChecklistItems,
  setTrelloDescription,
  findJobByName,
  getJobById,
  type Job,
} from './job';
import { classifyAndApply, type ResolvedSuggestion } from './classification';
import { buildTrelloEvidenceText, extractStatusUpdates, extractRecentComments } from './trelloMatch';
import type { Classifier } from '../services/classifier';
import type { TrelloCardDetail, TrelloClient, TrelloLabel } from '../services/trello';

export async function setTrelloLink(
  db: AppDatabase,
  jobId: number,
  trelloCardId: string | null,
): Promise<void> {
  // Qualquer ação deliberada sobre o vínculo (linkar de novo ou desvincular
  // pelo botão) limpa o aviso de "desvinculado sozinho" — ele só faz
  // sentido enquanto ninguém tomou conhecimento/ação sobre isso.
  await db.query(
    `UPDATE jobs
     SET trello_card_id = $1,
         trello_linked_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
         trello_auto_unlinked_at = NULL,
         updated_at = now()
     WHERE id = $2`,
    [trelloCardId, jobId],
  );
}

/**
 * Diferente de setTrelloLink(db, jobId, null): isso é o próprio sistema
 * desvinculando sozinho porque o card sumiu do Trello (apagado ou
 * arquivado) — não uma ação da pessoa. Marca trello_auto_unlinked_at pra
 * mostrar um aviso na tela do job, já que ninguém pediu essa desvinculação.
 */
export async function autoUnlinkTrello(db: AppDatabase, jobId: number): Promise<void> {
  await db.query(
    `UPDATE jobs
     SET trello_card_id = NULL,
         trello_linked_at = NULL,
         trello_auto_unlinked_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [jobId],
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
  | { status: 'card_not_found' }
  | { status: 'card_archived' };

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
    await autoUnlinkTrello(db, job.id);
    return { status: 'card_not_found' };
  }
  if (card.closed) {
    await autoUnlinkTrello(db, job.id);
    return { status: 'card_archived' };
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

  const statusUpdates = extractStatusUpdates(card.comments);
  const lastStatusAuthor = statusUpdates[0]?.author;

  // Atendimento é o único campo onde o Trello sempre manda: quem postou o
  // status mais recente é quem está de fato tocando a conta agora, então
  // isso corrige o responsável mesmo que já exista um definido — diferente
  // de Comercial/Produção Executiva (syncTrelloMembersToRoles acima), que
  // continuam só preenchendo quando está vazio. Se essa pessoa ainda não
  // estiver cadastrada em Atendimento, cadastra na hora — é o único sinal
  // forte o bastante pra justificar criação automática.
  let principalPersonId: number | null = job.atendimentoPersonId;
  let principalName: string | null = job.atendimentoPersonName;

  if (lastStatusAuthor) {
    principalPersonId = await matchOrCreateAtendimentoPersonId(db, lastStatusAuthor);
    principalName = lastStatusAuthor;
    if (job.atendimentoPersonId !== principalPersonId) {
      await setAtendimento(db, job.id, principalPersonId);
    }
  } else {
    await syncTrelloMembersToAtendimento(db, job.id, job.atendimentoPersonId, memberNames);
    if (job.atendimentoPersonId === null) {
      const refreshed = await getJobById(db, job.id);
      principalPersonId = refreshed?.atendimentoPersonId ?? null;
      principalName = refreshed?.atendimentoPersonName ?? null;
    }

    // Ainda sem responsável nenhum (card novo, sem comentário STATUS ainda,
    // e nenhum membro/etiqueta bateu com alguém já cadastrado) — com
    // exatamente os 2 membros do padrão do time, assume o primeiro como
    // principal em vez de deixar o job sem ninguém.
    if (principalPersonId === null && card.members.length === 2) {
      principalPersonId = await matchOrCreateAtendimentoPersonId(db, card.members[0]);
      principalName = card.members[0];
      await setAtendimento(db, job.id, principalPersonId);
    }
  }

  await resolveAndSetAtendimentoBackup(db, job, card.members, principalPersonId, principalName);

  // Espelho de comentários mostrado no job: os 3 mais recentes, não só os
  // "STATUS" — statusUpdates acima continua existindo só como sinal pro
  // Atendimento, não é o que fica salvo/exibido. Limitado a 3 pra manter a
  // página enxuta; histórico completo continua disponível no Trello.
  const recentComments = extractRecentComments(card.comments, 3);
  if (JSON.stringify(recentComments) !== JSON.stringify(job.trelloStatusUpdates)) {
    await setTrelloStatusUpdates(db, job.id, recentComments);
  }

  // Espelho somente-leitura do checklist do Trello — não influencia a fase/
  // status do job, que continua vindo só do checklist de fases do sistema.
  if (JSON.stringify(card.checklistItems) !== JSON.stringify(job.trelloChecklistItems)) {
    await setTrelloChecklistItems(db, job.id, card.checklistItems);
  }

  // Espelho da descrição — antes só existia ao vivo (buildTrelloCardView),
  // nunca persistida; agora salva também, pra entrar na busca global.
  if (card.description !== job.trelloDescription) {
    await setTrelloDescription(db, job.id, card.description);
  }

  // Tudo acima (nome, papéis, Atendimento, comentários, checklist) já está
  // salvo nesse ponto. A IA é sempre a última etapa, deliberadamente: se ela
  // falhar (sem crédito, fora do ar, o que for), o resto da sincronização já
  // aconteceu de verdade e não pode virar erro — isso já aconteceu na prática
  // (créditos da Anthropic esgotados fazia toda sincronização "falhar" mesmo
  // com os dados corretos já gravados, e o cliente nunca recarregava a tela).
  let suggestions: ResolvedSuggestion[] = [];
  if (classifier) {
    try {
      const evidenceText = buildTrelloEvidenceText(card);
      suggestions = await classifyAndApply(db, classifier, job.id, evidenceText, {
        bypassConfidenceGate: options.bypassConfidenceGate,
      });
    } catch (err) {
      console.error('classifyAndApply failed during trello sync — continuing without suggestions', err);
    }
  }

  return { status: 'synced', suggestions, trelloCard: buildTrelloCardView(card) };
}

async function matchAtendimentoPersonId(db: AppDatabase, name: string): Promise<number | null> {
  const atendimentoPeople = (await listPeople(db, { activeOnly: true })).filter(
    (person) => person.area === 'Atendimento',
  );
  const match = findMatchingPerson(atendimentoPeople, [normalizePersonName(name)]);
  return match?.id ?? null;
}

/**
 * Igual matchAtendimentoPersonId, mas cadastra a pessoa em Atendimento na
 * hora quando ninguém bate — usado só pro sinal forte o bastante pra
 * justificar isso (autor do "STATUS", criador do card, ou o outro membro
 * do card quando o principal já foi identificado).
 */
async function matchOrCreateAtendimentoPersonId(db: AppDatabase, name: string): Promise<number> {
  const existingId = await matchAtendimentoPersonId(db, name);
  if (existingId !== null) {
    return existingId;
  }
  try {
    const created = await createPerson(db, { name, area: 'Atendimento' });
    return created.id;
  } catch (err) {
    // Corrida rara (duas sincronizações do mesmo card ao mesmo tempo
    // tentando cadastrar a mesma pessoa nova): o índice único (name, area)
    // rejeita a segunda inserção — a primeira já criou quem procurávamos.
    const raceMatch = await matchAtendimentoPersonId(db, name);
    if (raceMatch !== null) {
      return raceMatch;
    }
    throw err;
  }
}

function namesMatch(a: string, b: string): boolean {
  const normalizedA = normalizePersonName(a);
  const normalizedB = normalizePersonName(b);
  return normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA);
}

/**
 * Backup é quem, dos 2 Membros do card no Trello, não é o principal — só
 * decide isso quando o card tem exatamente 2 membros (o padrão do time:
 * principal + backup); com 1 ou 3+ membros não dá pra adivinhar quem é
 * quem, então não mexe. Preenche só quando ainda está vazio — diferente do
 * principal, nunca sobrescreve um backup já definido.
 */
async function resolveAndSetAtendimentoBackup(
  db: AppDatabase,
  job: Job,
  cardMembers: string[],
  principalPersonId: number | null,
  principalName: string | null,
): Promise<void> {
  if (job.atendimentoBackupPersonId !== null || cardMembers.length !== 2 || !principalName) {
    return;
  }

  const backupName = cardMembers.find((member) => !namesMatch(member, principalName));
  if (!backupName) {
    return;
  }

  const backupPersonId = await matchOrCreateAtendimentoPersonId(db, backupName);
  if (backupPersonId !== principalPersonId) {
    await setAtendimentoBackup(db, job.id, backupPersonId);
  }
}

/**
 * Um card novo no Trello não tem job nenhum esperando por ele — isso cria
 * (ou, se já existir um job com esse nome exato ainda sem vínculo, linka
 * nele em vez de duplicar) e sincroniza tudo de uma vez. Quem criou o card
 * no Trello vira o Atendimento responsável, cadastrado na hora em
 * Atendimento se ainda não existir — mesmo sinal forte que justifica
 * criação automática no sync normal (ver matchOrCreateAtendimentoPersonId).
 */
export async function createJobFromTrelloCard(
  db: AppDatabase,
  trelloClient: TrelloClient,
  classifier: Classifier | undefined,
  cardId: string,
  creatorName: string | undefined,
): Promise<TrelloSyncResult | { status: 'skipped' }> {
  const card = await trelloClient.getCard(cardId);
  if (!card || card.closed) {
    return { status: 'skipped' };
  }

  const existingJob = await findJobByName(db, card.name);
  let job: Job;

  if (existingJob) {
    if (existingJob.trelloCardId) {
      // Já existe um job com esse nome, vinculado a outro card — não mexe:
      // criar um segundo job com o mesmo nome é a duplicata que o índice
      // único existe pra impedir.
      return { status: 'skipped' };
    }
    await setTrelloLink(db, existingJob.id, cardId);
    job = (await getJobById(db, existingJob.id))!;
  } else {
    const atendimentoPersonId = creatorName ? await matchOrCreateAtendimentoPersonId(db, creatorName) : null;
    const created = await createJob(db, { name: card.name, atendimentoPersonId });
    await setTrelloLink(db, created.id, cardId);
    job = (await getJobById(db, created.id))!;
  }

  return syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: true });
}
