import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken?: () => Promise<GoogleProfile>) {
  const resolvedVerifyIdToken =
    verifyIdToken ??
    (async (): Promise<GoogleProfile> => ({
      sub: 'google-sub-1',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    }));
  return createApp({
    db,
    verifyIdToken: resolvedVerifyIdToken,
    jwtSecret: JWT_SECRET,
    allowedDomain: ALLOWED_DOMAIN,
    frontendUrl: FRONTEND_URL,
  });
}

async function loggedInAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/jobs', () => {
  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).get('/api/jobs');
      expect(res.status).toBe(401);
    });
  });

  it('includes a freshly created job in the list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      await agent.post('/api/jobs').send({ name: 'Job criado no teste GET /api/jobs' });
      const res = await agent.get('/api/jobs');

      expect(res.status).toBe(200);
      expect(
        res.body.jobs.some((job: { name: string }) => job.name === 'Job criado no teste GET /api/jobs'),
      ).toBe(true);
    });
  });

  it('includes bolaComDayCounts and triggerLabel on every job in the list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      await agent.post('/api/jobs').send({ name: 'Job Listagem Enriquecida Rota Teste' });
      const res = await agent.get('/api/jobs');

      const found = res.body.jobs.find(
        (j: { name: string }) => j.name === 'Job Listagem Enriquecida Rota Teste',
      );

      expect(found).toBeDefined();
      expect(found.bolaComDayCounts).toEqual({
        ilhaDays: 0,
        clienteDays: 0,
        currentSide: 'ilha',
        currentStreakDays: 0,
      });
      expect(found.triggerLabel).toBe('Avançar para: Briefing Recebido');
    });
  });
});

describe('POST /api/jobs', () => {
  it('creates a job and returns it', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate' });

      expect(res.status).toBe(201);
      expect(res.body.job.name).toBe('Colgate - Color Correct Wave 2');

      const list = await agent.get('/api/jobs');
      expect(
        list.body.jobs.some((job: { name: string }) => job.name === 'Colgate - Color Correct Wave 2'),
      ).toBe(true);
    });
  });

  it('rejects a job without a name', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.post('/api/jobs').send({ client: 'Colgate' });

      expect(res.status).toBe(400);
    });
  });
});

describe('error handling', () => {
  it('returns 500 instead of crashing when the database call fails during login', async () => {
    const failingDb: AppDatabase = {
      query: async () => {
        throw new Error('simulated database failure');
      },
    };
    const app = buildApp(failingDb, async () => ({
      sub: 'google-sub-err',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    }));

    const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

    expect(res.status).toBe(500);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the job detail with actionRequired, triggerLabel, roleAssignments, and history', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Detalhe Rota Teste' });
      const res = await agent.get(`/api/jobs/${created.body.job.id}`);

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Prospecção');
      expect(res.body.job.triggerLabel).toBe('Avançar para: Briefing Recebido');
      expect(res.body.job.roleAssignments.map((a: { area: string }) => a.area).sort()).toEqual([
        'Comercial',
        'Produção Executiva',
      ]);
      expect(res.body.job.statusHistory.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.get('/api/jobs/999999999');

      expect(res.status).toBe(404);
    });
  });
});

describe('POST /api/jobs/:id/advance', () => {
  it('advances the job to the next status within the phase', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Avanço Rota Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/advance`).send({});

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Briefing Recebido');
    });
  });
});

describe('POST /api/jobs/:id/status', () => {
  it('moves the job to a manually chosen status', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Rota Teste' });
      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'PPM aprovada pelo cliente'`,
      );

      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/status`)
        .send({ statusId: targetStatus.rows[0].id, note: 'Pulo manual via rota' });

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('PPM aprovada pelo cliente');
    });
  });

  it('rejects a missing statusId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Inválido Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/status`).send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /api/jobs/:id/roles/:area', () => {
  it('assigns a person to a role area for the job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Atribuição Rota Teste' });
      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .put(`/api/jobs/${created.body.job.id}/roles/Comercial`)
        .send({ personId: personRow.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.roleAssignment.personName).toBe('Anne');
    });
  });

  it('rejects an area that is not a valid role for the job\'s current phase', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      // Job starts in Fase 1 ("Comercial e Orçamento"), which does not have a
      // "Financeiro" role (that's a Fase 2 role) — this must be rejected, not
      // silently insert an orphan row.
      const created = await agent.post('/api/jobs').send({ name: 'Job Área Inválida Rota Teste' });

      const res = await agent.put(`/api/jobs/${created.body.job.id}/roles/Financeiro`).send({ personId: null });

      expect(res.status).toBe(400);
    });
  });

  it('accepts an area containing a slash when the client encodes it', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      // Job starts in Fase 1, which doesn't have "Jurídico/Base" — move it to
      // Fase 2 first (which does) via the manual status route.
      const created = await agent.post('/api/jobs').send({ name: 'Job Área Com Barra Teste' });
      const fase2Status = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Contrato assinado pelo cliente'`,
      );
      await agent.post(`/api/jobs/${created.body.job.id}/status`).send({ statusId: fase2Status.rows[0].id });

      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Carol' AND area = 'Jurídico/Base'`,
      );

      const res = await agent
        .put(`/api/jobs/${created.body.job.id}/roles/${encodeURIComponent('Jurídico/Base')}`)
        .send({ personId: personRow.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.roleAssignment.personName).toBe('Carol');
    });
  });
});

describe('error handling on jobs routes', () => {
  it('GET /api/jobs/:id returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/jobs/999999999');
      expect(res.status).toBe(404);
    });
  });

  it('GET /api/jobs/:id returns 400 for a non-numeric id', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/jobs/not-a-number');
      expect(res.status).toBe(400);
    });
  });

  it('POST /api/jobs/:id/advance returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/jobs/999999999/advance').send({});
      expect(res.status).toBe(404);
    });
  });

  it('POST /api/jobs/:id/advance returns 400 when already at the last status of its phase', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const created = await agent.post('/api/jobs').send({ name: 'Job Limite de Fase Teste' });
      const lastStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`,
      );
      await agent.post(`/api/jobs/${created.body.job.id}/status`).send({ statusId: lastStatus.rows[0].id });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/advance`).send({});

      expect(res.status).toBe(400);
    });
  });

  it('POST /api/jobs/:id/status returns 400 for a nonexistent statusId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const created = await agent.post('/api/jobs').send({ name: 'Job Status Inexistente Teste' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/status`).send({ statusId: 999999999 });

      expect(res.status).toBe(400);
    });
  });

  it('PUT /api/jobs/:id/roles/:area returns 400 for a nonexistent personId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const created = await agent.post('/api/jobs').send({ name: 'Job Pessoa Inexistente Teste' });

      const res = await agent
        .put(`/api/jobs/${created.body.job.id}/roles/Comercial`)
        .send({ personId: 999999999 });

      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/jobs/:id/bola-com', () => {
  it('switches bola-com and returns updated day counts', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Rota Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/bola-com`)
        .send({ bolaCom: 'cliente' });

      expect(res.status).toBe(200);
      expect(res.body.job.bolaCom).toBe('cliente');
      expect(res.body.bolaComDayCounts.currentSide).toBe('cliente');
    });
  });

  it('rejects an invalid bolaCom value', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Inválida Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/bola-com`)
        .send({ bolaCom: 'terceiro' });

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.patch('/api/jobs/999999999/bola-com').send({ bolaCom: 'ilha' });

      expect(res.status).toBe(404);
    });
  });
});

describe('PATCH /api/jobs/:id/last-activity', () => {
  it('sets the last WhatsApp activity timestamp', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Última Atividade Rota Teste' });
      const timestamp = '2026-08-18T10:00:00.000Z';
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: timestamp });

      expect(res.status).toBe(200);
      expect(res.body.job.lastWhatsappActivityAt).toBe(timestamp);
    });
  });

  it('clears the timestamp when null is sent', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Limpar Última Atividade Teste' });
      await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: '2026-08-18T10:00:00.000Z' });

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: null });

      expect(res.status).toBe(200);
      expect(res.body.job.lastWhatsappActivityAt).toBeNull();
    });
  });

  it('rejects an invalid date string', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Data Inválida Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({ lastWhatsappActivityAt: 'não é uma data' });

      expect(res.status).toBe(400);
    });
  });

  it('rejects an omitted field', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Campo Omitido Teste' });
      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/last-activity`)
        .send({});

      expect(res.status).toBe(400);
    });
  });
});

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return { classify: async () => suggestions };
}

describe('POST /api/jobs/:id/classify', () => {
  it('returns 503 when no classifier is configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Sem IA Teste' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/classify`)
        .send({ text: 'qualquer coisa' });

      expect(res.status).toBe(503);
    });
  });

  it('classifies pasted text and returns resolved suggestions', async () => {
    await withTestTransaction(async (db) => {
      const app = createApp({
        db,
        verifyIdToken: async () => ({
          sub: 'google-sub-1',
          email: 'wilka@ilhacrossmidia.com.br',
          name: 'Wilka',
        }),
        jwtSecret: JWT_SECRET,
        allowedDomain: ALLOWED_DOMAIN,
        frontendUrl: FRONTEND_URL,
        classifier: fakeClassifier([
          {
            tipo: 'checklist_item',
            valor: 'Briefing Recebido',
            confidence: 0.9,
            evidencia: 'Cliente confirmou o briefing',
          },
        ]),
      });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Com IA Teste' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/classify`)
        .send({ text: 'Cliente confirmou o briefing agora' });

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].outcome).toBe('auto_aplicado');
    });
  });

  it('rejects empty text', async () => {
    await withTestTransaction(async (db) => {
      // The route validates `text` before checking classifier availability, so
      // this can use the plain no-classifier buildApp(db) helper like the 503
      // test above — an empty-text request never reaches the classifier check.
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Texto Vazio Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/classify`).send({ text: '' });

      expect(res.status).toBe(400);
    });
  });
});
