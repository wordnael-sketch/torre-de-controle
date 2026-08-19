import type { AppDatabase } from '../db';
import { recordStatusChange, getLastStatusChangeAt } from './jobStatusHistory';
import { computeAlertLevel, type AlertLevel } from './alertLevel';

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
}

const JOB_SELECT = `
  SELECT
    j.*,
    s.id AS status_id,
    s.name AS status_name,
    p.id AS phase_id,
    p.name AS phase_name,
    (
      SELECT person.name
      FROM job_role_assignments jra
      JOIN people person ON person.id = jra.person_id
      WHERE jra.job_id = j.id AND jra.phase_id = s.phase_id AND jra.area = s.primary_role
      LIMIT 1
    ) AS highlighted_person_name
  FROM jobs j
  LEFT JOIN statuses s ON s.id = j.status_id
  LEFT JOIN phases p ON p.id = s.phase_id
`;

async function rowToJob(db: AppDatabase, row: JobRow): Promise<Job> {
  const lastChangedAt = await getLastStatusChangeAt(db, row.id);

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
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    alertLevel: computeAlertLevel(lastChangedAt, new Date()),
    highlightedPersonName: row.highlighted_person_name,
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
  return Promise.all(result.rows.map((row) => rowToJob(db, row)));
}

export async function getJobById(db: AppDatabase, id: number): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}

export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    'INSERT INTO jobs (name, code, client, status_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.name, input.code ?? null, input.client ?? null, firstStatusId],
  );

  const jobId = inserted.rows[0].id;

  await recordStatusChange(db, { jobId, fromStatusId: null, toStatusId: firstStatusId });

  const job = await getJobById(db, jobId);
  return job!;
}

async function isFinalStatus(db: AppDatabase, statusId: number): Promise<boolean> {
  const result = await db.query<{ is_final: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM statuses s2
       JOIN statuses s1 ON s1.id = $1
       WHERE s2.phase_id = s1.phase_id AND s2."order" > s1."order"
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
    `UPDATE jobs SET status_id = $1, updated_at = now(), completed_at = ${completed ? 'now()' : 'NULL'} WHERE id = $2`,
    [toStatusId, jobId],
  );

  await recordStatusChange(db, { jobId, fromStatusId, toStatusId, note });

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
