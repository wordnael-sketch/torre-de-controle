import { describe, it, expect } from 'vitest';
import { createJob, listJobs } from '../src/models/job';
import { withTestTransaction } from './helpers/testDb';

describe('job model', () => {
  it('creates a job and returns it with generated fields', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, {
        name: 'Colgate - Color Correct Wave 2',
        code: '0307-2026',
        client: 'Colgate',
      });

      expect(job.id).toBeGreaterThan(0);
      expect(job.name).toBe('Colgate - Color Correct Wave 2');
      expect(job.code).toBe('0307-2026');
      expect(job.client).toBe('Colgate');
      expect(job.createdAt).toBeTruthy();
    });
  });

  it('creates a job without optional fields', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job sem codigo' });

      expect(job.code).toBeNull();
      expect(job.client).toBeNull();
    });
  });

  it('lists jobs ordered by newest first', async () => {
    await withTestTransaction(async (db) => {
      await createJob(db, { name: 'Primeiro job (ordering test)' });
      await createJob(db, { name: 'Segundo job (ordering test)' });

      const jobs = await listJobs(db);
      const names = jobs.map((j) => j.name);
      const indexSegundo = names.indexOf('Segundo job (ordering test)');
      const indexPrimeiro = names.indexOf('Primeiro job (ordering test)');

      expect(indexSegundo).toBeGreaterThanOrEqual(0);
      expect(indexPrimeiro).toBeGreaterThanOrEqual(0);
      expect(indexSegundo).toBeLessThan(indexPrimeiro);
    });
  });
});
