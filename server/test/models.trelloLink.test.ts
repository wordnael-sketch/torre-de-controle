import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { setTrelloLink, syncTrelloMembersToRoles, syncTrelloMembersToAtendimento } from '../src/models/trelloLink';
import { getJobRoleAssignments, setJobRoleAssignment } from '../src/models/jobRoleAssignments';
import { withTestTransaction } from './helpers/testDb';

describe('setTrelloLink', () => {
  it('links a job to a card id and records the timestamp', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Link Model Teste' });

      await setTrelloLink(db, job.id, 'card1');

      const result = await db.query<{ trello_card_id: string; trello_linked_at: Date }>(
        'SELECT trello_card_id, trello_linked_at FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].trello_card_id).toBe('card1');
      expect(result.rows[0].trello_linked_at).not.toBeNull();
    });
  });

  it('clears both fields when unlinking with null', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Unlink Model Teste' });
      await setTrelloLink(db, job.id, 'card1');

      await setTrelloLink(db, job.id, null);

      const result = await db.query<{ trello_card_id: string | null; trello_linked_at: Date | null }>(
        'SELECT trello_card_id, trello_linked_at FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].trello_card_id).toBeNull();
      expect(result.rows[0].trello_linked_at).toBeNull();
    });
  });
});

describe('syncTrelloMembersToRoles', () => {
  it('assigns a person whose name matches a Trello member, for an empty role area', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Membros Teste' });
      // Job começa na fase 1 (Comercial e Orçamento), que tem a área "Comercial".
      const phaseRow = await db.query<{ id: number }>(`SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`);
      const phaseId = phaseRow.rows[0].id;

      await syncTrelloMembersToRoles(db, job.id, phaseId, ['Anne Something', 'Pessoa Desconhecida']);

      const assignments = await getJobRoleAssignments(db, job.id, phaseId);
      const comercial = assignments.find((a) => a.area === 'Comercial');
      expect(comercial?.personName).toBe('Anne');
    });
  });

  it('does not overwrite an area that already has someone assigned', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Já Atribuído Teste' });
      const phaseRow = await db.query<{ id: number }>(`SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`);
      const phaseId = phaseRow.rows[0].id;
      const personRow = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Ronaldo' AND area = 'Comercial'`);
      await setJobRoleAssignment(db, job.id, phaseId, 'Comercial', personRow.rows[0].id);

      await syncTrelloMembersToRoles(db, job.id, phaseId, ['Anne']);

      const assignments = await getJobRoleAssignments(db, job.id, phaseId);
      const comercial = assignments.find((a) => a.area === 'Comercial');
      expect(comercial?.personName).toBe('Ronaldo');
    });
  });

  it('does nothing when no Trello member matches anyone in the area', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Sem Match Teste' });
      const phaseRow = await db.query<{ id: number }>(`SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`);
      const phaseId = phaseRow.rows[0].id;

      await syncTrelloMembersToRoles(db, job.id, phaseId, ['Alguém Que Não Existe']);

      const assignments = await getJobRoleAssignments(db, job.id, phaseId);
      expect(assignments.every((a) => a.personId === null)).toBe(true);
    });
  });

  it('does nothing when the member list is empty', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Membros Vazio Teste' });
      const phaseRow = await db.query<{ id: number }>(`SELECT id FROM phases WHERE name = 'Comercial e Orçamento'`);
      const phaseId = phaseRow.rows[0].id;

      await syncTrelloMembersToRoles(db, job.id, phaseId, []);

      const assignments = await getJobRoleAssignments(db, job.id, phaseId);
      expect(assignments.every((a) => a.personId === null)).toBe(true);
    });
  });
});

describe('syncTrelloMembersToAtendimento', () => {
  it('assigns Atendimento when the current value is null and a Trello member matches', async () => {
    await withTestTransaction(async (db) => {
      // createJob (nível de modelo, não a rota) aceita atendimentoPersonId ausente —
      // simula exatamente os jobs anteriores ao plano "Atendimento Responsável",
      // que ficam com o campo nulo até alguém preencher.
      const job = await createJob(db, { name: 'Job Trello Atendimento Vazio Teste' });

      await syncTrelloMembersToAtendimento(db, job.id, null, ['Wilka Nepomoceno']);

      const result = await db.query<{ atendimento_person_id: number | null }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      const wilka = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
      );
      expect(result.rows[0].atendimento_person_id).toBe(wilka.rows[0].id);
    });
  });

  it('does not overwrite an Atendimento that is already set', async () => {
    await withTestTransaction(async (db) => {
      const camila = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Camila' AND area = 'Atendimento'`,
      );
      const job = await createJob(db, {
        name: 'Job Trello Atendimento Já Definido Teste',
        atendimentoPersonId: camila.rows[0].id,
      });

      await syncTrelloMembersToAtendimento(db, job.id, camila.rows[0].id, ['Wilka Nepomoceno']);

      const result = await db.query<{ atendimento_person_id: number }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].atendimento_person_id).toBe(camila.rows[0].id);
    });
  });

  it('does nothing when no Trello member matches anyone in Atendimento', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Atendimento Sem Match Teste' });

      await syncTrelloMembersToAtendimento(db, job.id, null, ['Alguém Que Não Existe']);

      const result = await db.query<{ atendimento_person_id: number | null }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].atendimento_person_id).toBeNull();
    });
  });

  it('does nothing when the member list is empty', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Trello Atendimento Membros Vazio Teste' });

      await syncTrelloMembersToAtendimento(db, job.id, null, []);

      const result = await db.query<{ atendimento_person_id: number | null }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].atendimento_person_id).toBeNull();
    });
  });
});
