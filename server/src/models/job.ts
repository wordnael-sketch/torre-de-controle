import type { AppDatabase } from '../db';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listJobs(db: AppDatabase): Promise<Job[]> {
  const result = await db.query<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC, id DESC');
  return result.rows.map(toJob);
}

export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const result = await db.query<JobRow>(
    'INSERT INTO jobs (name, code, client) VALUES ($1, $2, $3) RETURNING *',
    [input.name, input.code ?? null, input.client ?? null],
  );

  return toJob(result.rows[0]);
}
