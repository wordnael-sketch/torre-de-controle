import type { AppDatabase } from '../db';

export interface JobStatusHistoryEntry {
  id: number;
  jobId: number;
  fromStatusId: number | null;
  toStatusId: number;
  changedAt: string;
  note: string | null;
}

interface HistoryRow {
  id: number;
  job_id: number;
  from_status_id: number | null;
  to_status_id: number;
  changed_at: string | Date;
  note: string | null;
}

function toEntry(row: HistoryRow): JobStatusHistoryEntry {
  return {
    id: row.id,
    jobId: row.job_id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
    changedAt: new Date(row.changed_at).toISOString(),
    note: row.note,
  };
}

export async function recordStatusChange(
  db: AppDatabase,
  input: { jobId: number; fromStatusId: number | null; toStatusId: number; note?: string },
): Promise<JobStatusHistoryEntry> {
  const result = await db.query<HistoryRow>(
    `INSERT INTO job_status_history (job_id, from_status_id, to_status_id, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.jobId, input.fromStatusId, input.toStatusId, input.note ?? null],
  );
  return toEntry(result.rows[0]);
}

export async function getJobStatusHistory(
  db: AppDatabase,
  jobId: number,
): Promise<JobStatusHistoryEntry[]> {
  const result = await db.query<HistoryRow>(
    'SELECT * FROM job_status_history WHERE job_id = $1 ORDER BY changed_at DESC, id DESC',
    [jobId],
  );
  return result.rows.map(toEntry);
}

export async function getLastStatusChangeAt(db: AppDatabase, jobId: number): Promise<Date | null> {
  const result = await db.query<{ changed_at: string | Date }>(
    'SELECT changed_at FROM job_status_history WHERE job_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1',
    [jobId],
  );
  return result.rows[0] ? new Date(result.rows[0].changed_at) : null;
}
