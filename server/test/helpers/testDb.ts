import type { Pool, PoolClient } from 'pg';
import { createDb } from '../../src/db';

let poolPromise: Promise<Pool> | undefined;

function getTestPool(): Promise<Pool> {
  if (!poolPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required to run tests');
    }
    poolPromise = createDb(connectionString);
  }
  return poolPromise;
}

export async function withTestTransaction<T>(
  fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await getTestPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
