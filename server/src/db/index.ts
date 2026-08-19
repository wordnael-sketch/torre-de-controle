import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export interface AppDatabase {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export async function createDb(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);

  return pool;
}
