import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase) {
  const verifyIdToken = async (): Promise<GoogleProfile> => ({
    sub: 'google-sub-1',
    email: 'wilka@ilhacrossmidia.com.br',
    name: 'Wilka',
  });
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

async function loggedInAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/reference', () => {
  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).get('/api/reference');
      expect(res.status).toBe(401);
    });
  });

  it('returns the 6 phases with statuses', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/reference');

      expect(res.status).toBe(200);
      expect(res.body.phases).toHaveLength(6);
    });
  });
});

describe('GET /api/people', () => {
  it('returns the seeded people list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/people');

      expect(res.status).toBe(200);
      expect(res.body.people.some((p: { name: string }) => p.name === 'Wilka')).toBe(true);
    });
  });
});

describe('POST /api/people', () => {
  it('creates a person', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/people').send({ name: 'Rota Teste Pessoa', area: 'Comercial' });

      expect(res.status).toBe(201);
      expect(res.body.person.name).toBe('Rota Teste Pessoa');
    });
  });

  it('rejects missing name', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/people').send({ area: 'Comercial' });

      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/people/:id/active', () => {
  it('toggles active state', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const created = await agent.post('/api/people').send({ name: 'Rota Toggle Pessoa', area: 'Comercial' });

      const res = await agent.patch(`/api/people/${created.body.person.id}/active`).send({ active: false });

      expect(res.status).toBe(200);
      expect(res.body.person.active).toBe(false);
    });
  });

  it('returns 404 for a nonexistent person', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.patch('/api/people/999999999/active').send({ active: false });
      expect(res.status).toBe(404);
    });
  });
});
