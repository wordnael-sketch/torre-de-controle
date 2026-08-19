import { describe, it, expect } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { requireAuth, SESSION_COOKIE } from '../src/auth/middleware';
import { signSession } from '../src/auth/session';

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
