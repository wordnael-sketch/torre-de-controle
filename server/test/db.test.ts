import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('createDb', () => {
  it('creates the users and jobs tables', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required to run this test');
    }

    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('jobs', 'users')
         ORDER BY table_name`,
      );

      expect(result.rows.map((r) => r.table_name)).toEqual(['jobs', 'users']);
    } finally {
      await db.end();
    }
  });
});
