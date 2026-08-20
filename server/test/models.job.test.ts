import { describe, it, expect } from 'vitest';
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setAtendimento } from '../src/models/job';
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
      expect(job.atendimentoPersonId).toBeNull();
      expect(job.atendimentoPersonName).toBeNull();
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

describe('job status lifecycle', () => {
  it('defaults a new job to the first status of the first phase', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Status Inicial Teste' });

      expect(job.statusName).toBe('Prospecção');
      expect(job.phaseName).toBe('Comercial e Orçamento');
      expect(job.completedAt).toBeNull();
    });
  });

  it('enriches listJobs with status, phase, and alertLevel', async () => {
    await withTestTransaction(async (db) => {
      await createJob(db, { name: 'Job Listagem Enriquecida Teste' });

      const jobs = await listJobs(db);
      const found = jobs.find((j) => j.name === 'Job Listagem Enriquecida Teste');

      expect(found).toBeDefined();
      expect(found!.statusName).toBe('Prospecção');
      expect(['green', 'yellow', 'red']).toContain(found!.alertLevel);
    });
  });

  it('getJobById returns the enriched job, and null for a nonexistent id', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Detalhe Teste' });

      const found = await getJobById(db, created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);

      const notFound = await getJobById(db, -1);
      expect(notFound).toBeNull();
    });
  });

  it('advanceJobStatus moves to the next status in order and records history', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Avanço Teste' });

      const advanced = await advanceJobStatus(db, created.id, 'Avanço automático de teste');

      expect(advanced.statusName).toBe('Briefing Recebido');
    });
  });

  it('setJobStatus moves to an arbitrary status chosen manually', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Status Manual Teste' });

      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'PPM aprovada pelo cliente'`,
      );

      const updated = await setJobStatus(db, created.id, targetStatus.rows[0].id, 'Pulo manual de teste');

      expect(updated.statusName).toBe('PPM aprovada pelo cliente');
      expect(updated.phaseName).toBe('Pré-Produção');
    });
  });

  it('marks the job completed when it reaches the final status', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Conclusão Teste' });

      const finalStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Todos os checkboxes preenchidos — Job concluído'`,
      );

      const completed = await setJobStatus(db, created.id, finalStatus.rows[0].id);

      expect(completed.statusName).toBe('Todos os checkboxes preenchidos — Job concluído');
      expect(completed.completedAt).not.toBeNull();
    });
  });

  it('does NOT mark the job completed when it only reaches the last status of an earlier phase', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Não-Conclusão Teste' });

      // "Defesa da Proposta" is the LAST status of Phase 1, not the final status of
      // the whole pipeline — reaching it must not complete the job.
      const phase1LastStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`,
      );

      const updated = await setJobStatus(db, created.id, phase1LastStatus.rows[0].id);

      expect(updated.statusName).toBe('Defesa da Proposta');
      expect(updated.completedAt).toBeNull();
    });
  });

  it('advanceJobStatus throws when the job is already at the last status of its phase', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Avanço no Limite Teste' });
      const phase1LastStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`,
      );
      await setJobStatus(db, created.id, phase1LastStatus.rows[0].id);

      await expect(advanceJobStatus(db, created.id)).rejects.toThrow();
    });
  });

  it('a completed job always reports green alertLevel regardless of elapsed time', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Farol Pós-Conclusão Teste' });
      const finalStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Todos os checkboxes preenchidos — Job concluído'`,
      );

      const completed = await setJobStatus(db, created.id, finalStatus.rows[0].id);

      expect(completed.completedAt).not.toBeNull();
      expect(completed.alertLevel).toBe('green');
    });
  });
});

describe('atendimento responsável', () => {
  it('creates a job with an atendimentoPersonId and returns it', async () => {
    await withTestTransaction(async (db) => {
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );

      const job = await createJob(db, {
        name: 'Job Atendimento Definido Teste',
        atendimentoPersonId: wilka.rows[0].id,
      });

      expect(job.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(job.atendimentoPersonName).toBe('Wilka');
    });
  });

  it('setAtendimento updates the responsible person and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Reatribuição Teste' });
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );

      const updated = await setAtendimento(db, created.id, wilka.rows[0].id);

      expect(updated.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(updated.atendimentoPersonName).toBe('Wilka');
    });
  });

  it('highlightedPersonName resolves from atendimentoPersonId when the current status is primarily Atendimento', async () => {
    await withTestTransaction(async (db) => {
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );
      const created = await createJob(db, {
        name: 'Job Destaque Atendimento Teste',
        atendimentoPersonId: wilka.rows[0].id,
      });

      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Atendimento da conta definida'`,
      );
      const updated = await setJobStatus(db, created.id, targetStatus.rows[0].id);

      expect(updated.statusName).toBe('Atendimento da conta definida');
      expect(updated.highlightedPersonName).toBe('Wilka');
    });
  });
});
