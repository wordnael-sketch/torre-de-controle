import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { inviteUser, activateUser } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase, verifyIdToken: (idToken: string) => Promise<GoogleProfile>) {
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

async function loggedInMemberAgent(db: AppDatabase) {
  const invited = await inviteUser(db, { email: 'membro.rota.teste@ilhacrossmidia.com.br', role: 'member' });
  await activateUser(db, invited.id, { googleSub: 'google-sub-membro-rota-teste', name: 'Membro Rota Teste' });

  const app = buildApp(db, async () => ({
    sub: 'google-sub-membro-rota-teste',
    email: 'membro.rota.teste@ilhacrossmidia.com.br',
    name: 'Membro Rota Teste',
  }));
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/users', () => {
  it('returns 403 for a member', async () => {
    await withTestTransaction(async (db) => {
      const agent = await loggedInMemberAgent(db);
      const res = await agent.get('/api/users');
      expect(res.status).toBe(403);
    });
  });

  it('lists users for an admin', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-rota-teste',
        email: 'admin.rota.teste@ilhacrossmidia.com.br',
        name: 'Admin Rota Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.rota.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-rota-teste', name: 'Admin Rota Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.get('/api/users');

      expect(res.status).toBe(200);
      expect(res.body.users.some((u: { email: string }) => u.email === 'admin.rota.teste@ilhacrossmidia.com.br')).toBe(true);
    });
  });
});

describe('POST /api/users/invite', () => {
  it('invites a new user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-convite-teste',
        email: 'admin.convite.teste@ilhacrossmidia.com.br',
        name: 'Admin Convite Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.convite.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-convite-teste', name: 'Admin Convite Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent
        .post('/api/users/invite')
        .send({ email: 'nova.pessoa.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('nova.pessoa.teste@ilhacrossmidia.com.br');
      expect(res.body.user.status).toBe('invited');
    });
  });

  it('rejects an email outside the allowed domain', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-dominio-teste',
        email: 'admin.dominio.teste@ilhacrossmidia.com.br',
        name: 'Admin Domínio Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.dominio.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-dominio-teste', name: 'Admin Domínio Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.post('/api/users/invite').send({ email: 'fora@gmail.com', role: 'member' });

      expect(res.status).toBe(400);
    });
  });

  it('rejects inviting an email that already exists', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-duplicado-teste',
        email: 'admin.duplicado.teste@ilhacrossmidia.com.br',
        name: 'Admin Duplicado Teste',
      }));
      const invited = await inviteUser(db, { email: 'admin.duplicado.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-admin-duplicado-teste', name: 'Admin Duplicado Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent
        .post('/api/users/invite')
        .send({ email: 'admin.duplicado.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(res.status).toBe(409);
    });
  });
});

describe('PATCH /api/users/:id/role', () => {
  it('changes a user role', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-papel-teste',
        email: 'admin.papel.teste@ilhacrossmidia.com.br',
        name: 'Admin Papel Teste',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.papel.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-papel-teste', name: 'Admin Papel Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const target = await inviteUser(db, { email: 'alvo.papel.teste@ilhacrossmidia.com.br', role: 'member' });

      const res = await agent.patch(`/api/users/${target.id}/role`).send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('admin');
    });
  });

  it('returns 404 for a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-papel-404-teste',
        email: 'admin.papel404.teste@ilhacrossmidia.com.br',
        name: 'Admin',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.papel404.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-papel-404-teste', name: 'Admin' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const res = await agent.patch('/api/users/999999999/role').send({ role: 'admin' });

      expect(res.status).toBe(404);
    });
  });
});

describe('PATCH /api/users/:id/status', () => {
  it('revokes and reactivates a user', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, async () => ({
        sub: 'google-sub-admin-status-teste',
        email: 'admin.status.teste@ilhacrossmidia.com.br',
        name: 'Admin Status Teste',
      }));
      const invitedAdmin = await inviteUser(db, { email: 'admin.status.teste@ilhacrossmidia.com.br', role: 'admin' });
      await activateUser(db, invitedAdmin.id, { googleSub: 'google-sub-admin-status-teste', name: 'Admin Status Teste' });
      const agent = request.agent(app);
      await agent.post('/api/auth/google').send({ idToken: 'fake-token' });

      const target = await inviteUser(db, { email: 'alvo.status.teste@ilhacrossmidia.com.br', role: 'member' });

      const revokeRes = await agent.patch(`/api/users/${target.id}/status`).send({ status: 'revoked' });
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.user.status).toBe('revoked');

      const reactivateRes = await agent.patch(`/api/users/${target.id}/status`).send({ status: 'active' });
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.user.status).toBe('active');
    });
  });
});
