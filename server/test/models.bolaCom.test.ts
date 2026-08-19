import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { setBolaCom, getBolaComDayCounts } from '../src/models/bolaCom';
import { withTestTransaction } from './helpers/testDb';

describe('bola com', () => {
  it('defaults a new job to "ilha" with a zero-day streak', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Padrão Teste' });

      expect(job.bolaCom).toBe('ilha');

      const counts = await getBolaComDayCounts(db, job.id);
      expect(counts.currentSide).toBe('ilha');
      expect(counts.currentStreakDays).toBe(0);
    });
  });

  it('setBolaCom switches the current side and records history', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Troca Teste' });

      await setBolaCom(db, job.id, 'cliente', 'Cliente pediu ajustes');

      const counts = await getBolaComDayCounts(db, job.id);
      expect(counts.currentSide).toBe('cliente');
    });
  });

  it('accumulates days on each side across multiple switches', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bola Com Acumulado Teste' });

      // Força timestamps de histórico no passado para simular dias decorridos,
      // já que o teste roda em segundos, não em dias reais.
      await db.query(
        `UPDATE job_bola_com_history SET changed_at = now() - interval '5 days' WHERE job_id = $1`,
        [job.id],
      );
      await db.query(
        `INSERT INTO job_bola_com_history (job_id, bola_com, changed_at)
         VALUES ($1, 'cliente', now() - interval '2 days')`,
        [job.id],
      );

      const counts = await getBolaComDayCounts(db, job.id);

      expect(counts.ilhaDays).toBe(3);
      expect(counts.clienteDays).toBe(2);
      expect(counts.currentSide).toBe('cliente');
      expect(counts.currentStreakDays).toBe(2);
    });
  });
});
