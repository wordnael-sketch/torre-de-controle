import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type AppDatabase } from '../src/db';
import { createJob, listJobs } from '../src/models/job';

describe('job model', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  it('creates a job and returns it with generated fields', () => {
    const job = createJob(db, {
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

  it('creates a job without optional fields', () => {
    const job = createJob(db, { name: 'Job sem codigo' });

    expect(job.code).toBeNull();
    expect(job.client).toBeNull();
  });

  it('lists jobs ordered by newest first', () => {
    createJob(db, { name: 'Primeiro job' });
    createJob(db, { name: 'Segundo job' });

    const jobs = listJobs(db);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe('Segundo job');
    expect(jobs[1].name).toBe('Primeiro job');
  });
});
