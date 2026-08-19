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
  created_at: string;
  updated_at: string;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listJobs(db: AppDatabase): Job[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC, id DESC').all() as JobRow[];
  return rows.map(toJob);
}

export function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Job {
  const result = db
    .prepare('INSERT INTO jobs (name, code, client) VALUES (?, ?, ?)')
    .run(input.name, input.code ?? null, input.client ?? null);

  const row = db
    .prepare('SELECT * FROM jobs WHERE id = ?')
    .get(result.lastInsertRowid) as JobRow;

  return toJob(row);
}
