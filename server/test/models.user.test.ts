import { describe, it, expect } from 'vitest';
import {
  findUserByEmail,
  activateUser,
  getUserById,
  inviteUser,
  listUsers,
  setUserRole,
  setUserStatus,
} from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

describe('inviteUser / findUserByEmail', () => {
  it('creates an invited user with no googleSub or name yet', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'convidado.teste@ilhacrossmidia.com.br', role: 'member' });

      expect(invited.id).toBeGreaterThan(0);
      expect(invited.status).toBe('invited');
      expect(invited.role).toBe('member');
      expect(invited.googleSub).toBeNull();
      expect(invited.name).toBeNull();

      const found = await findUserByEmail(db, 'convidado.teste@ilhacrossmidia.com.br');
      expect(found?.id).toBe(invited.id);
    });
  });

  it('returns null for an email that was never invited', async () => {
    await withTestTransaction(async (db) => {
      expect(await findUserByEmail(db, 'nunca-convidado@ilhacrossmidia.com.br')).toBeNull();
    });
  });

  it('finds an invited user by email regardless of case', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'CaseTeste@ilhacrossmidia.com.br', role: 'member' });

      const found = await findUserByEmail(db, 'caseteste@ilhacrossmidia.com.br');

      expect(found?.id).toBe(invited.id);
      expect(found?.email).toBe('caseteste@ilhacrossmidia.com.br');
    });
  });
});

describe('activateUser', () => {
  it('fills in googleSub/name and flips status to active', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'ativacao.teste@ilhacrossmidia.com.br', role: 'admin' });

      const activated = await activateUser(db, invited.id, {
        googleSub: 'google-sub-ativacao-teste',
        name: 'Pessoa Teste',
      });

      expect(activated.status).toBe('active');
      expect(activated.googleSub).toBe('google-sub-ativacao-teste');
      expect(activated.name).toBe('Pessoa Teste');
      expect(activated.role).toBe('admin');
    });
  });
});

describe('getUserById', () => {
  it('returns the user matching the id', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'busca.teste@ilhacrossmidia.com.br', role: 'member' });

      const found = await getUserById(db, invited.id);
      expect(found).toEqual(invited);
    });
  });

  it('returns null when no user matches the id', async () => {
    await withTestTransaction(async (db) => {
      expect(await getUserById(db, -1)).toBeNull();
    });
  });
});

describe('listUsers', () => {
  it('includes an invited user in the list', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'listagem.teste@ilhacrossmidia.com.br', role: 'member' });

      const users = await listUsers(db);
      expect(users.some((u) => u.id === invited.id)).toBe(true);
    });
  });
});

describe('setUserRole / setUserStatus', () => {
  it('changes a user role', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'papel.teste@ilhacrossmidia.com.br', role: 'member' });

      const updated = await setUserRole(db, invited.id, 'admin');

      expect(updated?.role).toBe('admin');
    });
  });

  it('returns null when changing the role of a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      expect(await setUserRole(db, -1, 'admin')).toBeNull();
    });
  });

  it('revokes and reactivates a user', async () => {
    await withTestTransaction(async (db) => {
      const invited = await inviteUser(db, { email: 'revogacao.teste@ilhacrossmidia.com.br', role: 'member' });
      await activateUser(db, invited.id, { googleSub: 'google-sub-revogacao-teste', name: 'Pessoa Revogada' });

      const revoked = await setUserStatus(db, invited.id, 'revoked');
      expect(revoked?.status).toBe('revoked');

      const reactivated = await setUserStatus(db, invited.id, 'active');
      expect(reactivated?.status).toBe('active');
    });
  });

  it('returns null when changing the status of a nonexistent user', async () => {
    await withTestTransaction(async (db) => {
      expect(await setUserStatus(db, -1, 'revoked')).toBeNull();
    });
  });
});
