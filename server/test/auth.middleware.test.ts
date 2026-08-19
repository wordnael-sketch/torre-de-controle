import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireAuth, requireActiveUser, requireAdmin, SESSION_COOKIE } from '../src/auth/middleware';
import { signSession } from '../src/auth/session';
import type { AppDatabase } from '../src/db';
import { inviteUser, activateUser, setUserStatus } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';

function buildTestApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/protected', requireAuth(JWT_SECRET), (req, res) => {
    res.json({ user: req.user });
  });
  return app;
}

describe('requireAuth', () => {
  it('returns 401 when there is no session cookie', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the session cookie is invalid', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=garbage`);
    expect(res.status).toBe(401);
  });

  it('attaches req.user and calls next when the session is valid', async () => {
    const app = buildTestApp();
    const token = signSession({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' }, JWT_SECRET);

    const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ userId: 1, email: 'wilka@ilhacrossmidia.com.br' });
  });
});

function buildAppWithDb(db: AppDatabase, requireAdminToo = false) {
  const app = express();
  app.use(cookieParser());
  const middlewares = [requireAuth(JWT_SECRET), requireActiveUser(db)];
  if (requireAdminToo) {
    middlewares.push(requireAdmin());
  }
  app.get('/protected', ...middlewares, (req, res) => {
    res.json({ currentUser: req.currentUser });
  });
  return app;
}

describe('requireActiveUser', () => {
  it('returns 401 when the session is for a user that no longer exists', async () => {
    await withTestTransaction(async (db) => {
      const app = buildAppWithDb(db);
      const token = signSession({ userId: -1, email: 'ninguem@ilhacrossmidia.com.br' }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(401);
    });
  });

  it('returns 401 when the account has been revoked', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogado.middleware.teste@ilhacrossmidia.com.br', role: 'member' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-teste', name: 'Pessoa' });
      await setUserStatus(db, active.id, 'revoked');

      const app = buildAppWithDb(db);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(401);
    });
  });

  it('attaches req.currentUser and calls next when the account is active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'ativo.middleware.teste@ilhacrossmidia.com.br', role: 'admin' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-ativo-teste', name: 'Pessoa Ativa' });

      const app = buildAppWithDb(db);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(200);
      expect(res.body.currentUser).toMatchObject({ id: active.id, role: 'admin', status: 'active' });
    });
  });
});

describe('requireAdmin', () => {
  it('returns 403 when the current user is not an admin', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'membro.middleware.teste@ilhacrossmidia.com.br', role: 'member' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-membro-teste', name: 'Membro' });

      const app = buildAppWithDb(db, true);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(403);
    });
  });

  it('calls next when the current user is an admin', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'admin.middleware.teste@ilhacrossmidia.com.br', role: 'admin' });
      const active = await activateUser(db, invited.id, { googleSub: 'google-sub-mw-admin-teste', name: 'Admin' });

      const app = buildAppWithDb(db, true);
      const token = signSession({ userId: active.id, email: active.email }, JWT_SECRET);

      const res = await request(app).get('/protected').set('Cookie', `${SESSION_COOKIE}=${token}`);

      expect(res.status).toBe(200);
    });
  });
});
