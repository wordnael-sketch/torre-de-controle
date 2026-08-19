import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { GoogleProfile } from '../src/routes/auth';
import type { AppDatabase } from '../src/db';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

describe('POST /api/auth/google', () => {
  it('logs in a user with an allowed domain and sets a session cookie', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('wilka@ilhacrossmidia.com.br');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=/);
    });
  });

  it('rejects a user outside the allowed domain', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-2',
        email: 'someone@gmail.com',
        name: 'Someone',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
    });
  });

  it('rejects an invalid Google token', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('invalid token');
      });

      const res = await request(app).post('/api/auth/google').send({ idToken: 'bad-token' });

      expect(res.status).toBe(401);
    });
  });

  it('rejects a request without an idToken', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('should not be called');
      });

      const res = await request(app).post('/api/auth/google').send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user when logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(
        expect.objectContaining({ email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka' }),
      );
      expect(res.body.user.id).toBeGreaterThan(0);
    });
  });

  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => {
        throw new Error('should not be called');
      });

      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
    });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-1',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      }));

      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(204);
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=;/);
    });
  });
});
