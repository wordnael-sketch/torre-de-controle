import type { AppDatabase } from '../db';
import { getLastStatusChangeAt, getLastStatusChangeAtForJobs } from './jobStatusHistory';
import { computeAlertLevel, type AlertLevel } from './alertLevel';
import { recordInitialBolaCom } from './bolaCom';
import type { TrelloStatusUpdate } from './trelloMatch';
import type { TrelloChecklistItem } from '../services/trello';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
  bolaCom: 'ilha' | 'cliente';
  lastWhatsappActivityAt: string | null;
  actionRequired: string | null;
  triggerLabel: string | null;
  trelloCardId: string | null;
  trelloLinkedAt: string | null;
  atendimentoPersonId: number | null;
  atendimentoPersonName: string | null;
  trelloStatusUpdates: TrelloStatusUpdate[];
  trelloChecklistItems: TrelloChecklistItem[];
}

interface JobRow {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  status_id: number | null;
  status_name: string | null;
  phase_id: number | null;
  phase_name: string | null;
  completed_at: string | Date | null;
  highlighted_person_name: string | null;
  bola_com: 'ilha' | 'cliente';
  last_whatsapp_activity_at: string | Date | null;
  status_action_required: string | null;
  status_trigger_label: string | null;
  trello_card_id: string | null;
  trello_linked_at: string | Date | null;
  atendimento_person_id: number | null;
  atendimento_person_name: string | null;
  trello_status_updates: TrelloStatusUpdate[];
  trello_checklist_items: TrelloChecklistItem[];
}

const JOB_SELECT = `
  SELECT
    j.*,
    s.id AS status_id,
    s.name AS status_name,
    s.action_required AS status_action_required,
    s.trigger_label AS status_trigger_label,
    p.id AS phase_id,
    p.name AS phase_name,
    atendimento.name AS atendimento_person_name,
    (
      CASE
        WHEN s.primary_role = 'Atendimento' THEN atendimento.name
        ELSE (
          SELECT person.name
          FROM job_role_assignments jra
          JOIN people person ON person.id = jra.person_id
          WHERE jra.job_id = j.id AND jra.phase_id = s.phase_id AND jra.area = s.primary_role
          LIMIT 1
        )
      END
    ) AS highlighted_person_name
  FROM jobs j
  LEFT JOIN statuses s ON s.id = j.status_id
  LEFT JOIN phases p ON p.id = s.phase_id
  LEFT JOIN people atendimento ON atendimento.id = j.atendimento_person_id
`;

async function rowToJob(db: AppDatabase, row: JobRow, precomputedLastStatusChangeAt?: Date | null): Promise<Job> {
  const completedAt = row.completed_at ? new Date(row.completed_at).toISOString() : null;
  const lastStatusChangeAt =
    precomputedLastStatusChangeAt !== undefined
      ? precomputedLastStatusChangeAt
      : await getLastStatusChangeAt(db, row.id);
  const alertLevel = completedAt ? 'green' : computeAlertLevel(lastStatusChangeAt, new Date());

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    statusId: row.status_id,
    statusName: row.status_name,
    phaseId: row.phase_id,
    phaseName: row.phase_name,
    completedAt,
    alertLevel,
    highlightedPersonName: row.highlighted_person_name,
    bolaCom: row.bola_com,
    lastWhatsappActivityAt: row.last_whatsapp_activity_at
      ? new Date(row.last_whatsapp_activity_at).toISOString()
      : null,
    actionRequired: row.status_action_required,
    triggerLabel: row.status_trigger_label,
    trelloCardId: row.trello_card_id,
    trelloLinkedAt: row.trello_linked_at ? new Date(row.trello_linked_at).toISOString() : null,
    atendimentoPersonId: row.atendimento_person_id,
    atendimentoPersonName: row.atendimento_person_name,
    trelloStatusUpdates: row.trello_status_updates,
    trelloChecklistItems: row.trello_checklist_items,
  };
}

async function getFirstStatusId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT s.id FROM statuses s
     JOIN phases p ON p.id = s.phase_id
     ORDER BY p."order", s."order"
     LIMIT 1`,
  );
  return result.rows[0].id;
}

export async function listJobs(db: AppDatabase): Promise<Job[]> {
  const result = await db.query<JobRow>(`${JOB_SELECT} ORDER BY j.created_at DESC, j.id DESC`);
  const lastChangeMap = await getLastStatusChangeAtForJobs(
    db,
    result.rows.map((row) => row.id),
  );
  return Promise.all(result.rows.map((row) => rowToJob(db, row, lastChangeMap.get(row.id) ?? null)));
}

export async function getJobById(db: AppDatabase, id: number): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}

export async function findJobByName(db: AppDatabase, name: string): Promise<Job | null> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM jobs WHERE lower(trim(name)) = lower(trim($1)) LIMIT 1`,
    [name],
  );
  if (!result.rows[0]) {
    return null;
  }
  return getJobById(db, result.rows[0].id);
}

export async function getJobByTrelloCardId(db: AppDatabase, trelloCardId: string): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.trello_card_id = $1 ORDER BY j.id LIMIT 1`, [
    trelloCardId,
  ]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}

export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string; atendimentoPersonId?: number | null },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    `WITH new_job AS (
       INSERT INTO jobs (name, code, client, status_id, atendimento_person_id) VALUES ($1, $2, $3, $4, $5) RETURNING id
     ), history AS (
       INSERT INTO job_status_history (job_id, from_status_id, to_status_id)
       SELECT id, NULL, $4 FROM new_job
     )
     SELECT id FROM new_job`,
    [input.name, input.code ?? null, input.client ?? null, firstStatusId, input.atendimentoPersonId ?? null],
  );

  const jobId = inserted.rows[0].id;
  await recordInitialBolaCom(db, jobId);
  const job = await getJobById(db, jobId);
  return job!;
}

async function isFinalStatus(db: AppDatabase, statusId: number): Promise<boolean> {
  // Must compare (phase order, status order) as a pair — comparing status "order"
  // within the same phase alone would call the LAST STATUS OF EVERY PHASE "final"
  // (e.g. the end of Phase 1), not just the true final status of the final
  // phase. This intentionally never names that status: whichever status
  // currently sits at the highest (phase order, status order) pair IS final,
  // by definition, regardless of what it's called or renamed to later.
  const result = await db.query<{ is_final: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM statuses s2
       JOIN phases p2 ON p2.id = s2.phase_id
       JOIN statuses s1 ON s1.id = $1
       JOIN phases p1 ON p1.id = s1.phase_id
       WHERE (p2."order", s2."order") > (p1."order", s1."order")
     ) AS is_final
     FROM statuses WHERE id = $1`,
    [statusId],
  );
  return result.rows[0]?.is_final ?? false;
}

async function applyStatusChange(
  db: AppDatabase,
  jobId: number,
  fromStatusId: number | null,
  toStatusId: number,
  note?: string,
): Promise<Job> {
  const completed = await isFinalStatus(db, toStatusId);

  await db.query(
    `WITH updated AS (
       UPDATE jobs SET status_id = $1, updated_at = now(), completed_at = CASE WHEN $2 THEN now() ELSE NULL END
       WHERE id = $3
       RETURNING id
     )
     INSERT INTO job_status_history (job_id, from_status_id, to_status_id, note)
     SELECT id, $4, $1, $5 FROM updated`,
    [toStatusId, completed, jobId, fromStatusId, note ?? null],
  );

  const job = await getJobById(db, jobId);
  return job!;
}

export async function advanceJobStatus(db: AppDatabase, jobId: number, note?: string): Promise<Job> {
  const current = await getJobById(db, jobId);
  if (!current || current.statusId === null) {
    throw new Error('Job not found or has no current status');
  }

  const next = await db.query<{ id: number }>(
    `SELECT s2.id FROM statuses s1
     JOIN statuses s2 ON s2.phase_id = s1.phase_id AND s2."order" = s1."order" + 1
     WHERE s1.id = $1`,
    [current.statusId],
  );

  if (!next.rows[0]) {
    throw new Error('Job is already at the final status of its phase');
  }

  return applyStatusChange(db, jobId, current.statusId, next.rows[0].id, note);
}

export async function setJobStatus(
  db: AppDatabase,
  jobId: number,
  statusId: number,
  note?: string,
): Promise<Job> {
  const current = await getJobById(db, jobId);
  if (!current) {
    throw new Error('Job not found');
  }

  return applyStatusChange(db, jobId, current.statusId, statusId, note);
}

export async function setLastWhatsappActivity(
  db: AppDatabase,
  jobId: number,
  value: string | null,
): Promise<void> {
  await db.query('UPDATE jobs SET last_whatsapp_activity_at = $1, updated_at = now() WHERE id = $2', [
    value,
    jobId,
  ]);
}

export async function setJobName(db: AppDatabase, jobId: number, name: string): Promise<Job> {
  await db.query('UPDATE jobs SET name = $1, updated_at = now() WHERE id = $2', [name, jobId]);
  const job = await getJobById(db, jobId);
  return job!;
}

export async function setAtendimento(db: AppDatabase, jobId: number, personId: number): Promise<Job> {
  await db.query('UPDATE jobs SET atendimento_person_id = $1, updated_at = now() WHERE id = $2', [
    personId,
    jobId,
  ]);
  const job = await getJobById(db, jobId);
  return job!;
}

export async function setTrelloStatusUpdates(
  db: AppDatabase,
  jobId: number,
  updates: TrelloStatusUpdate[],
): Promise<Job> {
  await db.query('UPDATE jobs SET trello_status_updates = $1::jsonb, updated_at = now() WHERE id = $2', [
    JSON.stringify(updates),
    jobId,
  ]);
  const job = await getJobById(db, jobId);
  return job!;
}

export async function deleteJob(db: AppDatabase, jobId: number): Promise<boolean> {
  // Sem ON DELETE CASCADE nas tabelas dependentes — apaga tudo numa única
  // instrução (via CTEs) pra manter atomicidade sem depender de uma
  // transação explícita, mesmo padrão usado em createJob/applyStatusChange.
  const result = await db.query<{ id: number }>(
    `WITH del_roles AS (
       DELETE FROM job_role_assignments WHERE job_id = $1
     ), del_hist AS (
       DELETE FROM job_status_history WHERE job_id = $1
     ), del_bola AS (
       DELETE FROM job_bola_com_history WHERE job_id = $1
     )
     DELETE FROM jobs WHERE id = $1 RETURNING id`,
    [jobId],
  );
  return result.rows.length > 0;
}

export async function setTrelloChecklistItems(
  db: AppDatabase,
  jobId: number,
  items: TrelloChecklistItem[],
): Promise<Job> {
  await db.query('UPDATE jobs SET trello_checklist_items = $1::jsonb, updated_at = now() WHERE id = $2', [
    JSON.stringify(items),
    jobId,
  ]);
  const job = await getJobById(db, jobId);
  return job!;
}
