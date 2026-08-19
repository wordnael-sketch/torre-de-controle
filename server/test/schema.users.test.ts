import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db';

describe('users table — roles, status, seeded admin', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run this test');
  }

  it('adds role and status columns, and makes google_sub/name nullable', async () => {
    const db = await createDb(connectionString);
    try {
      const columns = await db.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users'
           AND column_name IN ('role', 'status', 'google_sub', 'name')`,
      );
      const byName = Object.fromEntries(columns.rows.map((c) => [c.column_name, c.is_nullable]));

      expect(byName.role).toBe('NO');
      expect(byName.status).toBe('NO');
      expect(byName.google_sub).toBe('YES');
      expect(byName.name).toBe('YES');
    } finally {
      await db.end();
    }
  });

  it('seeds wilka@ilhacrossmidia.com.br as an invited admin', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ role: string; status: string }>(
        `SELECT role, status FROM users WHERE email = 'wilka@ilhacrossmidia.com.br'`,
      );
      expect(result.rows[0]).toEqual({ role: 'admin', status: 'invited' });
    } finally {
      await db.end();
    }
  });
});
