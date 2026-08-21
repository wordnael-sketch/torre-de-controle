import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import type { TrelloClient, TrelloCardDetail } from '../src/services/trello';
import { createJob, getJobById } from '../src/models/job';
import { setTrelloLink } from '../src/models/trelloLink';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';
const WEBHOOK_SECRET = 'webhook-secret-teste';
const WEBHOOK_CALLBACK_URL = 'https://exemplo.test/api/trello-webhook';

async function getAtendimentoPersonId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
  );
  return result.rows[0].id;
}

function fakeTrelloClient(overrides: Partial<TrelloClient> = {}): TrelloClient {
  return {
    listBoardCards: async () => [],
    getCard: async () => null,
    ...overrides,
  };
}

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return {
    classify: async () => suggestions,
  };
}

function buildApp(
  db: AppDatabase,
  extra: {
    classifier?: Classifier;
    trelloClient?: TrelloClient;
    trelloWebhookSecret?: string;
    trelloWebhookCallbackUrl?: string;
  } = {},
) {
  return createApp({
    db,
    verifyIdToken: async () => ({ sub: 'google-sub-1', email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka' }),
    jwtSecret: JWT_SECRET,
    allowedDomain: ALLOWED_DOMAIN,
    frontendUrl: FRONTEND_URL,
    ...extra,
  });
}

function sign(payload: unknown, secret: string, callbackUrl: string): string {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return crypto
    .createHmac('sha1', secret)
    .update(Buffer.concat([rawBody, Buffer.from(callbackUrl)]))
    .digest('base64');
}

describe('HEAD /api/trello-webhook', () => {
  it('responds 200 with no processing (Trello liveness check)', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).head('/api/trello-webhook');
      expect(res.status).toBe(200);
    });
  });
});

describe('POST /api/trello-webhook', () => {
  it('responds 200 without processing when Trello webhook credentials are not fully configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app)
        .post('/api/trello-webhook')
        .send({ action: { data: { card: { id: 'card1' } } } });

      expect(res.status).toBe(200);
    });
  });

  it('rejects a request with an invalid signature', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', 'assinatura-forjada')
        .send({ action: { data: { card: { id: 'card1' } } } });

      expect(res.status).toBe(401);
    });
  });

  it('accepts a validly signed request with no card in the payload and does nothing', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { type: 'addMemberToBoard', data: {} } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  it('accepts a validly signed request for a card not linked to any job and does nothing', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card-sem-job' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  it('syncs the linked job and applies a suggestion the manual sync would have left pending', async () => {
    await withTestTransaction(async (db) => {
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const job = await createJob(db, { name: 'Job Webhook Trello Teste', atendimentoPersonId });
      await setTrelloLink(db, job.id, 'card1');

      const cardDetail: TrelloCardDetail = {
        name: 'Job Webhook Trello Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        comments: [],
        members: [],
      };
      // Confiança 0.7 ficaria "pendente" no fluxo manual (limiar de 85% pra
      // auto-aplicar) — prova que o webhook aplica mesmo sem confiança alta.
      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'Atualização vinda do card do Trello',
        },
      ]);
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({ getCard: async () => cardDetail }),
        classifier,
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card1' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await getJobById(db, job.id);
      expect(updated?.statusName).toBe('Briefing Recebido');
    });
  });

  it('still matches Trello card members to Atendimento even without a classifier configured', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Webhook Sem IA Teste' });
      await setTrelloLink(db, job.id, 'card1');

      const cardDetail: TrelloCardDetail = {
        name: 'Job Webhook Sem IA Teste',
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
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({ getCard: async () => cardDetail }),
        // classifier deliberately omitted — member/Atendimento matching is
        // deterministic and must not depend on ANTHROPIC_API_KEY.
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card1' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await getJobById(db, job.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`);
      expect(updated?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('still responds 200 when the sync pipeline throws (e.g. a Trello/DB failure)', async () => {
    await withTestTransaction(async (db) => {
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const job = await createJob(db, { name: 'Job Webhook Trello Falha', atendimentoPersonId });
      await setTrelloLink(db, job.id, 'card1');

      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({
          getCard: async () => {
            throw new Error('Trello API indisponível');
          },
        }),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card1' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  it('creates a new job when a "createCard" action arrives for a card with no matching job, using the creator as Atendimento', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'Job Novo Via Webhook Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/card-webhook-novo',
        labels: [],
        latestComment: null,
        comments: [],
        members: [],
        closed: false,
      };
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({ getCard: async () => cardDetail }),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = {
        action: {
          type: 'createCard',
          memberCreator: { fullName: 'Wilka Nepomoceno' },
          data: { card: { id: 'card-webhook-novo' } },
        },
      };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);

      const created = (
        await db.query<{ id: number }>(`SELECT id FROM jobs WHERE name = 'Job Novo Via Webhook Teste'`)
      ).rows[0];
      expect(created).toBeDefined();
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`);
      const job = await getJobById(db, created.id);
      expect(job?.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(job?.trelloCardId).toBe('card-webhook-novo');
    });
  });

  it('does not create a job for other action types on a card with no matching job (only "createCard" triggers import)', async () => {
    await withTestTransaction(async (db) => {
      const before = (await db.query<{ count: string }>('SELECT COUNT(*) FROM jobs')).rows[0].count;
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({ getCard: async () => null }),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = {
        action: { type: 'commentCard', data: { card: { id: 'card-antigo-nunca-vinculado' } } },
      };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
      const after = (await db.query<{ count: string }>('SELECT COUNT(*) FROM jobs')).rows[0].count;
      expect(after).toBe(before);
    });
  });
});
