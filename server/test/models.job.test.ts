import { describe, it, expect } from 'vitest';
import {
  createJob,
  listJobs,
  getJobById,
  getJobByTrelloCardId,
  findJobByName,
  advanceJobStatus,
  setJobStatus,
  setAtendimento,
  setJobName,
  setTrelloStatusUpdates,
  setTrelloChecklistItems,
  setTrelloDescription,
  searchJobs,
  deleteJob,
} from '../src/models/job';
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

  it('finds a job by its linked Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Busca Por Trello Card Teste' });
      await db.query('UPDATE jobs SET trello_card_id = $1 WHERE id = $2', ['card-xyz', job.id]);

      const found = await getJobByTrelloCardId(db, 'card-xyz');

      expect(found?.id).toBe(job.id);
    });
  });

  it('returns null when no job has the given Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const found = await getJobByTrelloCardId(db, 'card-inexistente');

      expect(found).toBeNull();
    });
  });

  it('the database rejects a second job linked to a Trello card that is already linked to another job', async () => {
    // Duas pessoas vinculando o mesmo card a dois jobs diferentes é
    // exatamente o que gerava duplicatas travadas em produção (sync
    // automático só enxergava um dos dois pra sempre) — a trava é o
    // índice único jobs_trello_card_id_unique_idx, não lógica de app.
    await withTestTransaction(async (db) => {
      const jobA = await createJob(db, { name: 'Job Trello Card Duplicado A Teste' });
      const jobB = await createJob(db, { name: 'Job Trello Card Duplicado B Teste' });
      await db.query('UPDATE jobs SET trello_card_id = $1 WHERE id = $2', ['card-duplicado', jobA.id]);

      await expect(
        db.query('UPDATE jobs SET trello_card_id = $1 WHERE id = $2', ['card-duplicado', jobB.id]),
      ).rejects.toThrow();
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

  it('setJobName updates the job name and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Nome Original Teste' });

      const updated = await setJobName(db, created.id, 'Nome Renomeado Teste');

      expect(updated.name).toBe('Nome Renomeado Teste');

      const found = await getJobById(db, created.id);
      expect(found?.name).toBe('Nome Renomeado Teste');
    });
  });

  it('new jobs start with an empty trelloStatusUpdates list', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Status Trello Inicial Teste' });
      expect(created.trelloStatusUpdates).toEqual([]);
    });
  });

  it('new jobs start with an empty trelloChecklistItems list', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Checklist Trello Inicial Teste' });
      expect(created.trelloChecklistItems).toEqual([]);
    });
  });

  it('setTrelloChecklistItems replaces the stored list and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Checklist Trello Teste' });

      const updated = await setTrelloChecklistItems(db, created.id, [
        { name: 'Abrir card monstro no Trello', checked: true },
        { name: 'Entrega final do filme', checked: false },
      ]);

      expect(updated.trelloChecklistItems).toEqual([
        { name: 'Abrir card monstro no Trello', checked: true },
        { name: 'Entrega final do filme', checked: false },
      ]);

      const found = await getJobById(db, created.id);
      expect(found?.trelloChecklistItems).toEqual([
        { name: 'Abrir card monstro no Trello', checked: true },
        { name: 'Entrega final do filme', checked: false },
      ]);
    });
  });

  it('setTrelloStatusUpdates replaces the stored list and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Status Trello Teste' });

      const updated = await setTrelloStatusUpdates(db, created.id, [
        { author: 'Bianca de Souza Andrade', text: 'STATUS 20.08', postedAt: '2026-08-20T13:51:00.000Z' },
      ]);

      expect(updated.trelloStatusUpdates).toEqual([
        { author: 'Bianca de Souza Andrade', text: 'STATUS 20.08', postedAt: '2026-08-20T13:51:00.000Z' },
      ]);

      const found = await getJobById(db, created.id);
      expect(found?.trelloStatusUpdates).toEqual([
        { author: 'Bianca de Souza Andrade', text: 'STATUS 20.08', postedAt: '2026-08-20T13:51:00.000Z' },
      ]);
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

  describe('findJobByName', () => {
    it('finds a job ignoring case and surrounding whitespace', async () => {
      await withTestTransaction(async (db) => {
        await createJob(db, { name: 'WPP :: Colgate :: Campanha Teste' });

        const found = await findJobByName(db, '  wpp :: colgate :: campanha teste  ');

        expect(found?.name).toBe('WPP :: Colgate :: Campanha Teste');
      });
    });

    it('returns null when no job has that name', async () => {
      await withTestTransaction(async (db) => {
        const found = await findJobByName(db, 'Job Que Não Existe De Verdade');
        expect(found).toBeNull();
      });
    });
  });

  describe('deleteJob', () => {
    it('deletes the job and its dependent rows, returning true', async () => {
      await withTestTransaction(async (db) => {
        const wilka = await db.query<{ id: number }>(
          `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
        );
        const created = await createJob(db, {
          name: 'Job Exclusão Teste',
          atendimentoPersonId: wilka.rows[0].id,
        });
        const phaseRow = await db.query<{ id: number }>(`SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`);
        const comercial = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Ronaldo' AND area = 'Comercial'`);
        await db.query(
          `INSERT INTO job_role_assignments (job_id, phase_id, area, person_id) VALUES ($1, $2, 'Comercial', $3)`,
          [created.id, phaseRow.rows[0].id, comercial.rows[0].id],
        );

        const deleted = await deleteJob(db, created.id);

        expect(deleted).toBe(true);
        expect(await getJobById(db, created.id)).toBeNull();
        const roles = await db.query('SELECT * FROM job_role_assignments WHERE job_id = $1', [created.id]);
        expect(roles.rows).toEqual([]);
        const hist = await db.query('SELECT * FROM job_status_history WHERE job_id = $1', [created.id]);
        expect(hist.rows).toEqual([]);
      });
    });

    it('returns false for a job that does not exist', async () => {
      await withTestTransaction(async (db) => {
        const deleted = await deleteJob(db, 999999999);
        expect(deleted).toBe(false);
      });
    });
  });

  describe('setTrelloDescription', () => {
    it('stores the description and returns the updated job', async () => {
      await withTestTransaction(async (db) => {
        const created = await createJob(db, { name: 'Job Descrição Trello Teste' });
        expect(created.trelloDescription).toBeNull();

        const updated = await setTrelloDescription(db, created.id, 'Briefing completo do job.');

        expect(updated.trelloDescription).toBe('Briefing completo do job.');
        const found = await getJobById(db, created.id);
        expect(found?.trelloDescription).toBe('Briefing completo do job.');
      });
    });

    it('accepts null to clear a previously stored description', async () => {
      await withTestTransaction(async (db) => {
        const created = await createJob(db, { name: 'Job Descrição Trello Limpa Teste' });
        await setTrelloDescription(db, created.id, 'Texto antigo.');

        const updated = await setTrelloDescription(db, created.id, null);

        expect(updated.trelloDescription).toBeNull();
      });
    });
  });

  describe('searchJobs', () => {
    it('returns an empty list for a term shorter than 2 characters', async () => {
      await withTestTransaction(async (db) => {
        await createJob(db, { name: 'Colgate - Busca Teste' });
        expect(await searchJobs(db, 'c')).toEqual([]);
        expect(await searchJobs(db, '')).toEqual([]);
      });
    });

    it('matches by name, client, and code with no matchContext', async () => {
      await withTestTransaction(async (db) => {
        const job = await createJob(db, {
          name: 'Colgate - Busca Nome Teste',
          client: 'Colgate Brasil',
          code: 'CLG-0099',
        });

        const byName = await searchJobs(db, 'Busca Nome');
        expect(byName.map((r) => r.id)).toContain(job.id);
        expect(byName.find((r) => r.id === job.id)?.matchContext).toBeNull();

        const byClient = await searchJobs(db, 'Colgate Brasil');
        expect(byClient.map((r) => r.id)).toContain(job.id);

        const byCode = await searchJobs(db, 'CLG-0099');
        expect(byCode.map((r) => r.id)).toContain(job.id);
      });
    });

    it('matches inside a Trello comment and returns a snippet as matchContext', async () => {
      await withTestTransaction(async (db) => {
        const job = await createJob(db, { name: 'Job Busca Comentário Teste' });
        await setTrelloStatusUpdates(db, job.id, [
          { author: 'Wilka', text: 'Arquivo final aprovado pelo cliente hoje.', postedAt: '2026-08-21T00:00:00.000Z' },
        ]);

        const results = await searchJobs(db, 'aprovado pelo cliente');
        const match = results.find((r) => r.id === job.id);

        expect(match).toBeDefined();
        expect(match?.matchContext).toContain('Comentário do Trello');
        expect(match?.matchContext).toContain('aprovado pelo cliente');
      });
    });

    it('matches inside the Trello description and returns a snippet as matchContext', async () => {
      await withTestTransaction(async (db) => {
        const job = await createJob(db, { name: 'Job Busca Descrição Teste' });
        await setTrelloDescription(db, job.id, 'Briefing: gravação externa marcada para sexta-feira.');

        const results = await searchJobs(db, 'gravação externa');
        const match = results.find((r) => r.id === job.id);

        expect(match).toBeDefined();
        expect(match?.matchContext).toContain('Descrição do Trello');
        expect(match?.matchContext).toContain('gravação externa');
      });
    });

    it('does not match jobs with no relevant field', async () => {
      await withTestTransaction(async (db) => {
        const job = await createJob(db, { name: 'Job Sem Relação Teste', client: 'Outro Cliente' });

        const results = await searchJobs(db, 'termo-que-nao-existe-em-nada');

        expect(results.map((r) => r.id)).not.toContain(job.id);
      });
    });
  });
});
