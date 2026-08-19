import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { getJobRoleAssignments, setJobRoleAssignment } from '../src/models/jobRoleAssignments';
import { withTestTransaction } from './helpers/testDb';

describe('job role assignments', () => {
  it('returns one entry per phase role, unassigned by default', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Papéis Teste' });
      // Fase 1 (Comercial e Orçamento) has roles: Comercial, Produção Executiva
      const phaseRow = await db.query<{ id: number }>(
        `SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`,
      );

      const assignments = await getJobRoleAssignments(db, job.id, phaseRow.rows[0].id);

      expect(assignments.map((a) => a.area).sort()).toEqual(['Comercial', 'Produção Executiva']);
      expect(assignments.every((a) => a.personId === null)).toBe(true);
    });
  });

  it('assigns a person to a role and reflects it back', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Papel Atribuído Teste' });
      const phaseRow = await db.query<{ id: number }>(
        `SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`,
      );
      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const assignment = await setJobRoleAssignment(
        db,
        job.id,
        phaseRow.rows[0].id,
        'Comercial',
        personRow.rows[0].id,
      );

      expect(assignment.personName).toBe('Anne');

      const assignments = await getJobRoleAssignments(db, job.id, phaseRow.rows[0].id);
      const comercial = assignments.find((a) => a.area === 'Comercial');
      expect(comercial!.personId).toBe(personRow.rows[0].id);
    });
  });

  it('unassigns a role by passing personId null', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Desatribuição Teste' });
      const phaseRow = await db.query<{ id: number }>(
        `SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`,
      );
      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      await setJobRoleAssignment(db, job.id, phaseRow.rows[0].id, 'Comercial', personRow.rows[0].id);
      const cleared = await setJobRoleAssignment(db, job.id, phaseRow.rows[0].id, 'Comercial', null);

      expect(cleared.personId).toBeNull();
      expect(cleared.personName).toBeNull();
    });
  });
});
