import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import {
  recordStatusChange,
  getJobStatusHistory,
  getLastStatusChangeAt,
} from '../src/models/jobStatusHistory';
import { withTestTransaction } from './helpers/testDb';

describe('job status history', () => {
  it('records a status change and returns it in history, newest first', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Histórico Teste' });

      const statusRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Prospecção'`,
      );
      const briefingRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Briefing Recebido'`,
      );

      await recordStatusChange(db, {
        jobId: job.id,
        fromStatusId: statusRow.rows[0].id,
        toStatusId: briefingRow.rows[0].id,
        note: 'Avanço de teste',
      });

      const history = await getJobStatusHistory(db, job.id);

      // >=1, not >=2: at this point in the plan, createJob (Plan 1's version) does
      // not yet record an initial history entry itself — that lands in Task 4. This
      // test only asserts on the entry recordStatusChange just wrote above.
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].toStatusId).toBe(briefingRow.rows[0].id);
      expect(history[0].note).toBe('Avanço de teste');
    });
  });

  it('returns the most recent changed_at via getLastStatusChangeAt', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Último Status Teste' });

      // createJob doesn't record history yet at this point in the plan (Task 4 adds
      // that) — record one manually so there's something for getLastStatusChangeAt
      // to find.
      const statusRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Prospecção'`,
      );
      await recordStatusChange(db, { jobId: job.id, fromStatusId: null, toStatusId: statusRow.rows[0].id });

      const lastChangedAt = await getLastStatusChangeAt(db, job.id);

      expect(lastChangedAt).not.toBeNull();
      expect(lastChangedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
