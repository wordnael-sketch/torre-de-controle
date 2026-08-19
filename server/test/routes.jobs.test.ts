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
