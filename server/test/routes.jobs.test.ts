import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import type { TrelloClient, TrelloCardSummary, TrelloCardDetail } from '../src/services/trello';
import { inviteUser, activateUser } from '../src/models/user';
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

async function loggedInMemberAgent(db: AppDatabase) {
  const invited = await inviteUser(db, { email: 'membro.jobs.rota.teste@ilhacrossmidia.com.br', role: 'member' });
  await activateUser(db, invited.id, { googleSub: 'google-sub-membro-jobs-rota-teste', name: 'Membro Jobs Rota Teste' });

  const app = buildApp(db, async () => ({
    sub: 'google-sub-membro-jobs-rota-teste',
    email: 'membro.jobs.rota.teste@ilhacrossmidia.com.br',
    name: 'Membro Jobs Rota Teste',
  }));
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

async function getAtendimentoPersonId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
  );
  return result.rows[0].id;
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      await agent.post('/api/jobs').send({ name: 'Job criado no teste GET /api/jobs', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      await agent.post('/api/jobs').send({ name: 'Job Listagem Enriquecida Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate - Color Correct Wave 2', code: '0307-2026', client: 'Colgate', atendimentoPersonId });

      expect(res.status).toBe(201);
      expect(res.body.job.name).toBe('Colgate - Color Correct Wave 2');
      expect(res.body.job.atendimentoPersonId).toBe(atendimentoPersonId);

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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Detalhe Rota Teste', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}`);

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Prospecção');
      expect(res.body.job.triggerLabel).toBe('Avançar para: Briefing Recebido');
      expect(res.body.job.roleAssignments.map((a: { area: string }) => a.area).sort()).toEqual([
        'Comercial',
        'Produção Executiva',
      ]);
      expect(res.body.job.statusHistory.length).toBeGreaterThanOrEqual(1);
      expect(res.body.job.atendimentoPersonId).toBe(atendimentoPersonId);
      expect(res.body.job.atendimentoPersonName).toBe('Wilka');
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Avanço Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Inválido Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Atribuição Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      // Job starts in Fase 1 ("Comercial e Orçamento"), which does not have a
      // "Financeiro" role (that's a Fase 2 role) — this must be rejected, not
      // silently insert an orphan row.
      const created = await agent.post('/api/jobs').send({ name: 'Job Área Inválida Rota Teste', atendimentoPersonId });

      const res = await agent.put(`/api/jobs/${created.body.job.id}/roles/Financeiro`).send({ personId: null });

      expect(res.status).toBe(400);
    });
  });

  it('accepts an area containing a slash when the client encodes it', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      // Job starts in Fase 1, which doesn't have "Jurídico/Base" — move it to
      // Fase 2 first (which does) via the manual status route.
      const created = await agent.post('/api/jobs').send({ name: 'Job Área Com Barra Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent.post('/api/jobs').send({ name: 'Job Limite de Fase Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent.post('/api/jobs').send({ name: 'Job Status Inexistente Teste', atendimentoPersonId });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/status`).send({ statusId: 999999999 });

      expect(res.status).toBe(400);
    });
  });

  it('PUT /api/jobs/:id/roles/:area returns 400 for a nonexistent personId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent.post('/api/jobs').send({ name: 'Job Pessoa Inexistente Teste', atendimentoPersonId });

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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Bola Com Inválida Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Última Atividade Rota Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Limpar Última Atividade Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Data Inválida Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Campo Omitido Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Sem IA Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Com IA Teste', atendimentoPersonId });
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
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Classify Texto Vazio Teste', atendimentoPersonId });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/classify`).send({ text: '' });

      expect(res.status).toBe(400);
    });
  });
});

describe('POST /api/jobs — atendimentoPersonId validation', () => {
  it('rejects a job without atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.post('/api/jobs').send({ name: 'Job Sem Atendimento Teste' });

      expect(res.status).toBe(400);
    });
  });

  it('rejects an atendimentoPersonId that belongs to a different area', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const anne = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Área Errada Teste', atendimentoPersonId: anne.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects an inactive atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );
      await db.query('UPDATE people SET active = false WHERE id = $1', [wilka.rows[0].id]);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Inativo Teste', atendimentoPersonId: wilka.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects a nonexistent atendimentoPersonId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent
        .post('/api/jobs')
        .send({ name: 'Job Atendimento Inexistente Teste', atendimentoPersonId: 999999999 });

      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/jobs/:id/atendimento', () => {
  it('reassigns the responsible person and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Rota Teste', atendimentoPersonId });

      const camila = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Camila' AND area = 'Atendimento'`,
      );

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/atendimento`)
        .send({ personId: camila.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.job.atendimentoPersonId).toBe(camila.rows[0].id);
      expect(res.body.job.atendimentoPersonName).toBe('Camila');
    });
  });

  it('rejects a personId from a different area', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Área Errada Teste', atendimentoPersonId });

      const anne = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/atendimento`)
        .send({ personId: anne.rows[0].id });

      expect(res.status).toBe(400);
    });
  });

  it('rejects a missing personId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Reatribuição Sem Pessoa Teste', atendimentoPersonId });

      const res = await agent.patch(`/api/jobs/${created.body.job.id}/atendimento`).send({});

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const res = await agent
        .patch('/api/jobs/999999999/atendimento')
        .send({ personId: atendimentoPersonId });

      expect(res.status).toBe(404);
    });
  });
});

describe('PATCH /api/jobs/:id/name', () => {
  it('renames the job and returns the updated job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Nome Original Rota Teste', atendimentoPersonId });

      const res = await agent
        .patch(`/api/jobs/${created.body.job.id}/name`)
        .send({ name: 'Nome Renomeado Rota Teste' });

      expect(res.status).toBe(200);
      expect(res.body.job.name).toBe('Nome Renomeado Rota Teste');
    });
  });

  it('rejects an empty name', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Nome Vazio Teste', atendimentoPersonId });

      const res = await agent.patch(`/api/jobs/${created.body.job.id}/name`).send({ name: '   ' });

      expect(res.status).toBe(400);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.patch('/api/jobs/999999999/name').send({ name: 'Novo Nome' });

      expect(res.status).toBe(404);
    });
  });

  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);

      const res = await request(app).patch('/api/jobs/1/name').send({ name: 'Novo Nome' });

      expect(res.status).toBe(401);
    });
  });
});

function fakeTrelloClient(overrides: Partial<TrelloClient> = {}): TrelloClient {
  return {
    listBoardCards: async () => [],
    getCard: async () => null,
    ...overrides,
  };
}

function buildAppWithDeps(db: AppDatabase, extra: { classifier?: Classifier; trelloClient?: TrelloClient }) {
  return createApp({
    db,
    verifyIdToken: async () => ({
      sub: 'google-sub-1',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    }),
    jwtSecret: JWT_SECRET,
    allowedDomain: ALLOWED_DOMAIN,
    frontendUrl: FRONTEND_URL,
    ...extra,
  });
}

describe('GET /api/jobs/:id/trello-candidates', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Candidatos Teste', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(503);
    });
  });

  it('returns scored candidates from the configured board', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async (): Promise<TrelloCardSummary[]> => [
          { id: 'card1', name: 'WPP:: Colgate Campanha Teste', listName: 'Em Captação 2026' },
        ],
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate Campanha Teste', client: 'Colgate', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].id).toBe('card1');
      expect(res.body.candidates[0].strongMatch).toBe(true);
    });
  });

  it('returns 502 when the Trello API call fails', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => {
          throw new Error('Trello API error 429');
        },
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Erro Teste', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(502);
    });
  });
});

describe('GET /api/jobs/:id/trello-cards', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Todos Cards Teste', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-cards`);

      expect(res.status).toBe(503);
    });
  });

  it('returns every board card, unscored and unfiltered', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async (): Promise<TrelloCardSummary[]> => [
          { id: 'card1', name: 'WPP:: Colgate Campanha Teste', listName: 'Em Captação 2026' },
          { id: 'card2', name: 'Card sem nenhuma relação com o job', listName: 'Concluído' },
        ],
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate Campanha Teste', client: 'Colgate', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-cards`);

      expect(res.status).toBe(200);
      expect(res.body.cards).toHaveLength(2);
      expect(res.body.cards.map((c: { id: string }) => c.id)).toEqual(['card1', 'card2']);
    });
  });

  it('returns 502 when the Trello API call fails', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => {
          throw new Error('Trello API error 429');
        },
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Cards Erro Teste', atendimentoPersonId });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-cards`);

      expect(res.status).toBe(502);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient();
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);

      const res = await agent.get('/api/jobs/999999999/trello-cards');

      expect(res.status).toBe(404);
    });
  });
});

describe('POST /api/jobs/:id/trello-link', () => {
  it('links a job to a Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Link Teste', atendimentoPersonId });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/trello-link`)
        .send({ trelloCardId: 'card1' });

      expect(res.status).toBe(200);
      expect(res.body.job.trelloCardId).toBe('card1');
    });
  });

  it('unlinks when trelloCardId is null', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Unlink Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/trello-link`)
        .send({ trelloCardId: null });

      expect(res.status).toBe(200);
      expect(res.body.job.trelloCardId).toBeNull();
    });
  });

  it('rejects a body missing trelloCardId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Link Inválido Teste', atendimentoPersonId });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('POST /api/jobs/:id/trello-sync', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Sem Config Teste', atendimentoPersonId });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(503);
    });
  });

  it('returns 400 when the job has no linked card', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient();
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Não Vinculado Teste', atendimentoPersonId });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(400);
    });
  });

  it('unlinks and returns 404 when the linked card no longer exists', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({ getCard: async () => null });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Card Sumiu Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(404);

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(jobRes.body.job.trelloCardId).toBeNull();
    });
  });

  it('unlinks and returns 404 with an auto-unlink warning when the linked card was archived', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'Job Trello Card Arquivado Rota Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        members: [],
        closed: true,
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Trello Card Arquivado Rota Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('trello_card_archived');

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(jobRes.body.job.trelloCardId).toBeNull();
      expect(jobRes.body.job.trelloAutoUnlinkedAt).not.toBeNull();
    });
  });

  it('builds evidence text from the Trello card and classifies it', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Captação 2026',
        checklistItems: [{ name: 'Contrato assinado', checked: true }],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifyMock = async (input: { pastedText: string }): Promise<RawSuggestion[]> => {
        expect(input.pastedText).toContain('Em Captação 2026');
        expect(input.pastedText).toContain('Contrato assinado');
        return [
          {
            tipo: 'checklist_item',
            valor: 'Briefing Recebido',
            confidence: 0.9,
            evidencia: 'Lista atual no Trello: Em Captação 2026',
          },
        ];
      };
      const classifier: Classifier = { classify: classifyMock };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Sucesso Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].outcome).toBe('auto_aplicado');
      expect(res.body.trelloCard).toEqual({
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Captação 2026',
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        members: [],
        people: [],
      });
    });
  });

  it('syncs members even without a classifier configured, returning empty suggestions instead of 503', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'Job Trello Sync Sem IA Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        members: ['Wilka Nepomoceno'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Trello Sync Sem IA Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
    });
  });

  it('returns 502 when the Trello API call fails', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        getCard: async () => {
          throw new Error('Trello API error 500');
        },
      });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Erro API Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(502);
    });
  });

  it('auto-assigns an empty role area from the card members, alongside the AI suggestions', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Orçamento 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        // Job novo começa na fase "Comercial e Orçamento", que tem a área "Comercial" —
        // "Anne Something" deve bater com a pessoa "Anne" (área Comercial) já seedada.
        members: ['Anne Something'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Membro Rota Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      const comercial = jobRes.body.job.roleAssignments.find((a: { area: string }) => a.area === 'Comercial');
      expect(comercial.personName).toBe('Anne');
    });
  });

  it('does NOT overwrite the Atendimento chosen at job creation, even if a different member matches', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Orçamento 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        // O card do Trello traz Camila como membro, mas o job já foi criado com
        // Wilka como Atendimento responsável — a sincronização nunca deve trocar
        // isso, mesmo achando um match diferente.
        members: ['Camila'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Trello Atendimento Não Sobrescreve Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(jobRes.body.job.atendimentoPersonId).toBe(atendimentoPersonId);
      expect(jobRes.body.job.atendimentoPersonName).toBe('Wilka');
    });
  });

  it('fills a null Atendimento (legacy job, predating the requirement) from a matching Trello member', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Orçamento 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        members: ['Wilka Nepomoceno'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Job Trello Atendimento Legado Teste', atendimentoPersonId });
      // Simula um job anterior à obrigatoriedade de Atendimento (os 27 jobs reais
      // importados antes do plano "Atendimento Responsável") — a rota de criação
      // não permite isso diretamente, então zeramos o campo direto no banco, o
      // mesmo estado em que aqueles jobs ficaram.
      await db.query('UPDATE jobs SET atendimento_person_id = NULL WHERE id = $1', [created.body.job.id]);
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(jobRes.body.job.atendimentoPersonName).toBe('Wilka');
    });
  });
});

describe('POST /api/jobs — duplicate name prevention', () => {
  it('rejects creating a job whose name already exists (case/whitespace-insensitive)', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      await agent.post('/api/jobs').send({ name: 'WPP :: Duplicado :: Teste', atendimentoPersonId });
      const res = await agent
        .post('/api/jobs')
        .send({ name: '  wpp :: duplicado :: teste  ', atendimentoPersonId });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('job_name_ja_existe');
    });
  });
});

describe('POST /api/jobs/:id/trello-link — duplicate card prevention', () => {
  it('rejects linking a card that is already linked to a different job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const jobA = await agent.post('/api/jobs').send({ name: 'Job Card Duplicado A Teste', atendimentoPersonId });
      const jobB = await agent.post('/api/jobs').send({ name: 'Job Card Duplicado B Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${jobA.body.job.id}/trello-link`).send({ trelloCardId: 'card-ja-vinculado' });

      const res = await agent
        .post(`/api/jobs/${jobB.body.job.id}/trello-link`)
        .send({ trelloCardId: 'card-ja-vinculado' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('trello_card_ja_vinculado');
      expect(res.body.existingJobId).toBe(jobA.body.job.id);
    });
  });

  it('allows re-linking the same card to the same job it is already linked to', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const job = await agent.post('/api/jobs').send({ name: 'Job Card Relink Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${job.body.job.id}/trello-link`).send({ trelloCardId: 'card-relink' });

      const res = await agent
        .post(`/api/jobs/${job.body.job.id}/trello-link`)
        .send({ trelloCardId: 'card-relink' });

      expect(res.status).toBe(200);
    });
  });
});

describe('DELETE /api/jobs/:id', () => {
  it('deletes the job when the caller is an admin', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await agent.post('/api/jobs').send({ name: 'Job Exclusão Rota Teste', atendimentoPersonId });

      const res = await agent.delete(`/api/jobs/${created.body.job.id}`);

      expect(res.status).toBe(204);
      const getRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  it('returns 403 for a non-admin member', async () => {
    await withTestTransaction(async (db) => {
      const adminApp = buildApp(db);
      const adminAgent = await loggedInAgent(adminApp);
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const created = await adminAgent
        .post('/api/jobs')
        .send({ name: 'Job Exclusão Sem Permissão Teste', atendimentoPersonId });

      const memberAgent = await loggedInMemberAgent(db);
      const res = await memberAgent.delete(`/api/jobs/${created.body.job.id}`);

      expect(res.status).toBe(403);
      const getRes = await adminAgent.get(`/api/jobs/${created.body.job.id}`);
      expect(getRes.status).toBe(200);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.delete('/api/jobs/999999999');
      expect(res.status).toBe(404);
    });
  });
});

describe('POST /api/jobs/trello-link-all', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/jobs/trello-link-all');
      expect(res.status).toBe(503);
    });
  });

  it('links every job whose name exactly matches a board card, skipping ones with no match', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => [
          { id: 'card1', name: 'WPP:: Colgate Campanha Teste', listName: 'Em Captação 2026' },
          { id: 'card2', name: 'Card Sem Job Nenhum', listName: 'Em Orçamento 2026' },
        ],
        getCard: async (id) =>
          id === 'card1'
            ? {
                name: 'WPP:: Colgate Campanha Teste',
                listName: 'Em Captação 2026',
                checklistItems: [],
                due: null,
                latestComment: null,
                comments: [],
                members: [],
                description: null,
                url: 'https://trello.com/c/card1',
                labels: [],
              }
            : null,
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const jobA = await agent.post('/api/jobs').send({ name: 'WPP:: Colgate Campanha Teste', atendimentoPersonId });
      const jobB = await agent
        .post('/api/jobs')
        .send({ name: 'Job Sem Card Correspondente', atendimentoPersonId });

      const res = await agent.post('/api/jobs/trello-link-all');

      expect(res.status).toBe(200);
      expect(res.body.linkedCount).toBe(1);

      const linkedA = await agent.get(`/api/jobs/${jobA.body.job.id}`);
      expect(linkedA.body.job.trelloCardId).toBe('card1');
      const linkedB = await agent.get(`/api/jobs/${jobB.body.job.id}`);
      expect(linkedB.body.job.trelloCardId).toBeNull();
    });
  });

  it('does not link a job whose exact-match card is already linked to a different job', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => [
          { id: 'card-compartilhado', name: 'Job Card Compartilhado Teste', listName: 'Em Captação 2026' },
        ],
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const jobA = await agent
        .post('/api/jobs')
        .send({ name: 'Job Card Compartilhado Teste', atendimentoPersonId });
      const jobB = await agent
        .post('/api/jobs')
        .send({ name: 'Job Card Compartilhado Teste 2', atendimentoPersonId });
      await agent
        .post(`/api/jobs/${jobA.body.job.id}/trello-link`)
        .send({ trelloCardId: 'card-compartilhado' });

      const res = await agent.post('/api/jobs/trello-link-all');

      expect(res.status).toBe(200);
      expect(res.body.linkedCount).toBe(0);
      const stillUnlinked = await agent.get(`/api/jobs/${jobB.body.job.id}`);
      expect(stillUnlinked.body.job.trelloCardId).toBeNull();
    });
  });

  it('skips a job that is already linked to a card', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => [
          { id: 'outro-card', name: 'Job Já Vinculado Teste', listName: 'Em Captação 2026' },
        ],
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);
      const atendimentoPersonId = await getAtendimentoPersonId(db);

      const job = await agent.post('/api/jobs').send({ name: 'Job Já Vinculado Teste', atendimentoPersonId });
      await agent.post(`/api/jobs/${job.body.job.id}/trello-link`).send({ trelloCardId: 'card-ja-vinculado' });

      const res = await agent.post('/api/jobs/trello-link-all');

      expect(res.status).toBe(200);
      expect(res.body.linkedCount).toBe(0);
      const stillLinked = await agent.get(`/api/jobs/${job.body.job.id}`);
      expect(stillLinked.body.job.trelloCardId).toBe('card-ja-vinculado');
    });
  });
});
