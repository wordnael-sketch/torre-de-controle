import { describe, it, expect } from 'vitest';
import { findOrCreateUser, getUserById } from '../src/models/user';
import { withTestTransaction } from './helpers/testDb';

describe('findOrCreateUser', () => {
  it('creates a new user on first call', async () => {
    await withTestTransaction(async (db) => {
      const user = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      expect(user.id).toBeGreaterThan(0);
      expect(user.email).toBe('wilka@ilhacrossmidia.com.br');
    });
  });

  it('returns the same user on subsequent calls with the same googleSub', async () => {
    await withTestTransaction(async (db) => {
      const first = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });
      const second = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      expect(second.id).toBe(first.id);
    });
  });
});

describe('getUserById', () => {
  it('returns the user matching the id', async () => {
    await withTestTransaction(async (db) => {
      const created = await findOrCreateUser(db, {
        googleSub: 'google-sub-123',
        email: 'wilka@ilhacrossmidia.com.br',
        name: 'Wilka',
      });

      const found = await getUserById(db, created.id);

      expect(found).toEqual(created);
    });
  });

  it('returns null when no user matches the id', async () => {
    await withTestTransaction(async (db) => {
      expect(await getUserById(db, -1)).toBeNull();
    });
  });
});
