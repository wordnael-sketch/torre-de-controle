import { describe, it, expect } from 'vitest';
import { listPeople, createPerson, setPersonActive } from '../src/models/people';
import { withTestTransaction } from './helpers/testDb';

describe('people model', () => {
  it('lists people including the seeded Wilka in Atendimento', async () => {
    await withTestTransaction(async (db) => {
      const people = await listPeople(db);
      expect(
        people.some((p) => p.name === 'Wilka' && p.area === 'Atendimento'),
      ).toBe(true);
    });
  });

  it('creates a new person and it appears in the list', async () => {
    await withTestTransaction(async (db) => {
      const created = await createPerson(db, { name: 'Pessoa Teste Referência', area: 'Comercial' });

      expect(created.id).toBeGreaterThan(0);
      expect(created.active).toBe(true);

      const people = await listPeople(db);
      expect(people.some((p) => p.id === created.id)).toBe(true);
    });
  });

  it('deactivates a person', async () => {
    await withTestTransaction(async (db) => {
      const created = await createPerson(db, { name: 'Pessoa Inativa Teste', area: 'Comercial' });
      const updated = await setPersonActive(db, created.id, false);

      expect(updated.active).toBe(false);

      const activeOnly = await listPeople(db, { activeOnly: true });
      expect(activeOnly.some((p) => p.id === created.id)).toBe(false);
    });
  });
});
