import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../src/db';

describe('pipeline schema', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run this test');
  }

  it('seeds exactly the 6 fixed phases in order', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ order: number; name: string }>(
        'SELECT "order", name FROM phases ORDER BY "order"',
      );
      expect(result.rows).toEqual([
        { order: 1, name: 'Comercial e Orçamento' },
        { order: 2, name: 'Dotação Financeira e Burocracia (Set-up)' },
        { order: 3, name: 'Pré-Produção' },
        { order: 4, name: 'Captação (Set de Gravação)' },
        { order: 5, name: 'Pós-Produção' },
        { order: 6, name: 'Encerramento e Auditoria' },
      ]);
    } finally {
      await db.end();
    }
  });

  it('seeds exactly 25 statuses across the 6 phases, each with a valid primary_role', async () => {
    const db = await createDb(connectionString);
    try {
      const countResult = await db.query<{ count: string }>('SELECT count(*) FROM statuses');
      expect(Number(countResult.rows[0].count)).toBe(25);

      const orphanRoles = await db.query(
        `SELECT s.id FROM statuses s
         WHERE NOT EXISTS (
           SELECT 1 FROM phase_roles pr WHERE pr.phase_id = s.phase_id AND pr.area = s.primary_role
         )`,
      );
      expect(orphanRoles.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('seeds at least 38 people across the pre-loaded areas', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ count: string }>('SELECT count(*) FROM people');
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(38);
    } finally {
      await db.end();
    }
  });

  it('adds status_id and completed_at columns to jobs', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs'
           AND column_name IN ('status_id', 'completed_at')`,
      );
      const names = result.rows.map((r) => r.column_name).sort();
      expect(names).toEqual(['completed_at', 'status_id']);
    } finally {
      await db.end();
    }
  });
});
