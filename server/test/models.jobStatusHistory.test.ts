import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import {
  recordStatusChange,
  getJobStatusHistory,
  getLastStatusChangeAt,
  getLastStatusChangeAtForJobs,
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

      // Compared against the DB server's own clock, not the local machine's
      // Date.now() — this dev environment has persistent multi-hundred-ms
      // skew against the remote Supabase host, which made this flake on
      // every run when compared against a local timestamp.
      const dbNow = await db.query<{ now: string }>('SELECT now()');

      expect(lastChangedAt).not.toBeNull();
      expect(lastChangedAt!.getTime()).toBeLessThanOrEqual(new Date(dbNow.rows[0].now).getTime());
    });
  });

  describe('getLastStatusChangeAtForJobs', () => {
    it('returns the most recent changed_at per job in one batched call, matching the single-job version', async () => {
      await withTestTransaction(async (db) => {
        const jobA = await createJob(db, { name: 'Job Lote Status A Teste' });
        const jobB = await createJob(db, { name: 'Job Lote Status B Teste' });
        // createJob itself records an initial history entry (null -> first
        // status), so jobC has exactly that one row — used below to confirm
        // a job outside the requested id list is correctly left out.
        const jobC = await createJob(db, { name: 'Job Lote Status C Teste' });

        const prospeccao = await db.query<{ id: number }>(`SELECT id FROM statuses WHERE name = 'Prospecção'`);
        const briefing = await db.query<{ id: number }>(`SELECT id FROM statuses WHERE name = 'Briefing Recebido'`);

        await recordStatusChange(db, { jobId: jobA.id, fromStatusId: null, toStatusId: prospeccao.rows[0].id });
        await recordStatusChange(db, {
          jobId: jobA.id,
          fromStatusId: prospeccao.rows[0].id,
          toStatusId: briefing.rows[0].id,
        });
        await recordStatusChange(db, { jobId: jobB.id, fromStatusId: null, toStatusId: prospeccao.rows[0].id });

        const batched = await getLastStatusChangeAtForJobs(db, [jobA.id, jobB.id]);
        const expectedA = await getLastStatusChangeAt(db, jobA.id);
        const expectedB = await getLastStatusChangeAt(db, jobB.id);

        expect(batched.get(jobA.id)?.getTime()).toBe(expectedA!.getTime());
        expect(batched.get(jobB.id)?.getTime()).toBe(expectedB!.getTime());
        expect(batched.has(jobC.id)).toBe(false);
      });
    });

    it('returns an empty map for an empty list of job ids', async () => {
      await withTestTransaction(async (db) => {
        const batched = await getLastStatusChangeAtForJobs(db, []);
        expect(batched.size).toBe(0);
      });
    });
  });
});
