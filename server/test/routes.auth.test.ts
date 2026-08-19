import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { GoogleProfile } from '../src/routes/auth';
import type { AppDatabase } from '../src/db';
import { inviteUser, setUserStatus } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

describe('POST /api/auth/google', () => {
  it('logs in a user who was invited beforehand and sets a session cookie', async () => {
    await withTestTransaction(async (db) => {
      await inviteUser(db, { email: 'convidada.login.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-login-teste',
        email: 'convidada.login.teste@ilhacrossmidia.com.br',
        name: 'Convidada Teste',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('convidada.login.teste@ilhacrossmidia.com.br');
      expect(res.body.user.status).toBe('active');
      expect(res.headers['set-cookie']?.[0]).toMatch(/^session=/);
    });
  });

  it('rejects an email that was never invited', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-nao-convidado-teste',
        email: 'nunca.convidado.teste@ilhacrossmidia.com.br',
        name: 'Ninguém',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_invited');
    });
  });

  it('rejects a revoked user even though they were once invited and active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogada.login.teste@ilhacrossmidia.com.br', role: 'member' });
      await setUserStatus(db, invited.id, 'revoked');

      const app = buildApp(db, async () => ({
        sub: 'google-sub-revogada-teste',
        email: 'revogada.login.teste@ilhacrossmidia.com.br',
        name: 'Revogada',
      }));

      const res = await request(app).post('/api/auth/google').send({ idToken: 'fake-token' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('not_invited');
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
      expect(res.body.error).toBe('domain_not_allowed');
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
      await inviteUser(db, { email: 'me.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-me-teste',
        email: 'me.teste@ilhacrossmidia.com.br',
        name: 'Pessoa Me',
      }));

      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(
        expect.objectContaining({ email: 'me.teste@ilhacrossmidia.com.br', name: 'Pessoa Me' }),
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

  it('returns 401 for a session whose account was revoked after login', async () => {
    await withTestTransaction(async (db) => {
      await inviteUser(db, { email: 'revogada.sessao.teste@ilhacrossmidia.com.br', role: 'member' });

      const app = buildApp(db, async () => ({
        sub: 'google-sub-revogada-sessao-teste',
        email: 'revogada.sessao.teste@ilhacrossmidia.com.br',
        name: 'Pessoa',
      }));

      const agent = request.agent(app);
      const loginRes = await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      await setUserStatus(db, loginRes.body.user.id, 'revoked');

      const res = await agent.get('/api/auth/me');

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
