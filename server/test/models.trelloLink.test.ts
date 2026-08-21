import { describe, it, expect } from 'vitest';
import { createJob, getJobById } from '../src/models/job';
import {
  setTrelloLink,
  syncTrelloMembersToRoles,
  syncTrelloMembersToAtendimento,
  syncJobFromTrello,
} from '../src/models/trelloLink';
import { getJobRoleAssignments, setJobRoleAssignment } from '../src/models/jobRoleAssignments';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import type { TrelloClient, TrelloCardDetail } from '../src/services/trello';
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

  it('matches a person whose system name carries a city disambiguator (e.g. "Bianca (Brasília)") against their plain Trello full name', async () => {
    await withTestTransaction(async (db) => {
      // Bug real: o sufixo "(Brasília)" existe só pra desambiguar no cadastro
      // interno — nunca aparece no nome de ninguém no Trello — então a
      // comparação por substring falhava sempre pra essas pessoas.
      const job = await createJob(db, { name: 'Job Trello Atendimento Desambiguado Teste' });

      await syncTrelloMembersToAtendimento(db, job.id, null, ['Bianca de Souza Andrade']);

      const result = await db.query<{ atendimento_person_id: number | null }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      const bianca = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Bianca (Brasília)' AND area = 'Atendimento'`,
      );
      expect(result.rows[0].atendimento_person_id).toBe(bianca.rows[0].id);
    });
  });
});

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return {
    classify: async () => suggestions,
  };
}

function fakeTrelloClient(overrides: Partial<TrelloClient> = {}): TrelloClient {
  return {
    listBoardCards: async () => [],
    getCard: async () => null,
    ...overrides,
  };
}

describe('syncJobFromTrello', () => {
  it('throws when the job has no linked Trello card', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Sync Sem Vínculo Teste' });
      const trelloClient = fakeTrelloClient();
      const classifier = fakeClassifier([]);

      await expect(
        syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false }),
      ).rejects.toThrow('job is not linked to a Trello card');
    });
  });

  it('unlinks the job and returns card_not_found when the Trello card no longer exists', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Card Sumiu Teste' });
      await setTrelloLink(db, created.id, 'card-sumiu');
      const job = (await getJobById(db, created.id))!;
      const trelloClient = fakeTrelloClient({ getCard: async () => null });
      const classifier = fakeClassifier([]);

      const result = await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      expect(result.status).toBe('card_not_found');
      const updated = await getJobById(db, created.id);
      expect(updated?.trelloCardId).toBeNull();
    });
  });

  it('syncs members and runs the classifier with bypassConfidenceGate: false by default', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Padrão Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Padrão Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        comments: [],
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'confiança média, não deveria auto-aplicar',
        },
      ]);

      const result = await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.suggestions[0].outcome).toBe('pendente');
        expect(result.trelloCard).toEqual({ name: 'Job Sync Padrão Teste', listName: 'Em Captação 2026' });
      }
    });
  });

  it('applies a mid-confidence suggestion when bypassConfidenceGate is true', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Bypass Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Bypass Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        comments: [],
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'confiança média, deveria auto-aplicar com bypass',
        },
      ]);

      const result = await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: true });

      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.suggestions[0].outcome).toBe('auto_aplicado');
      }
    });
  });

  it('syncs members and Atendimento even without a classifier configured, returning empty suggestions instead of throwing', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Sem IA Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Sem IA Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        comments: [],
        members: ['Wilka Nepomoceno'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      const result = await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.suggestions).toEqual([]);
      }

      // A associação de Atendimento é determinística (não passa pela IA) —
      // deve ter acontecido mesmo sem classifier nenhum.
      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('renames the job to match the Trello card name when they differ', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Nome Desatualizado No Sistema' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Nome Atual No Trello',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        comments: [],
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([]);

      await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.name).toBe('Nome Atual No Trello');
    });
  });

  it('does not write a no-op update when the job name already matches the Trello card', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Nome Já Igual' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Nome Já Igual',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        comments: [],
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([]);

      await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.name).toBe('Nome Já Igual');
      expect(updatedJob?.updatedAt).toBe(job.updatedAt);
    });
  });

  it('does not rename the job to a name that already belongs to a different job', async () => {
    await withTestTransaction(async (db) => {
      // Roda sem supervisão via webhook — se renomeasse mesmo assim, criaria
      // exatamente a duplicata de nome que a trava de unicidade existe pra
      // impedir.
      await createJob(db, { name: 'Nome Já Usado Por Outro Job' });
      const created = await createJob(db, { name: 'Nome Original Deste Job' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Nome Já Usado Por Outro Job',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([]);

      await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.name).toBe('Nome Original Deste Job');
    });
  });

  it('also matches Atendimento/roles from comment authors, not just card members', async () => {
    await withTestTransaction(async (db) => {
      // Quem está de fato tocando o job às vezes só aparece comentando os
      // status no Trello, sem estar marcado como "member" do card.
      const created = await createJob(db, { name: 'Job Sync Autor Comentário Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Autor Comentário Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: 'Bora',
        members: [],
        comments: [{ author: 'Wilka Nepomoceno', text: 'Bora', postedAt: '2026-08-20T13:51:00.000Z' }],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('persists only the comments that look like a team STATUS update, newest first', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Status Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Status Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        latestComment: '📌STATUS 20.08 às 13h51',
        members: [],
        comments: [
          {
            author: 'Bianca de Souza Andrade',
            text: '📌STATUS 20.08 às 13h51\nFilme em montagem.',
            postedAt: '2026-08-20T13:51:00.000Z',
          },
          { author: 'Cliente', text: 'Ficou ótimo, obrigado!', postedAt: '2026-08-20T10:00:00.000Z' },
          {
            author: 'Bianca de Souza Andrade',
            text: 'STATUS 19.08 às 14h40\nPrevisto envio no fim do dia.',
            postedAt: '2026-08-19T14:40:00.000Z',
          },
        ],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloStatusUpdates).toEqual([
        {
          author: 'Bianca de Souza Andrade',
          text: '📌STATUS 20.08 às 13h51\nFilme em montagem.',
          postedAt: '2026-08-20T13:51:00.000Z',
        },
        {
          author: 'Bianca de Souza Andrade',
          text: 'STATUS 19.08 às 14h40\nPrevisto envio no fim do dia.',
          postedAt: '2026-08-19T14:40:00.000Z',
        },
      ]);
    });
  });

  it('does not write a no-op update when the extracted status updates already match what is stored', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Status Sem Mudança Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;
      expect(job.trelloStatusUpdates).toEqual([]);

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Status Sem Mudança Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        latestComment: 'Sem status ainda',
        members: [],
        comments: [{ author: 'Alguém', text: 'Sem status ainda', postedAt: '2026-08-20T13:51:00.000Z' }],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloStatusUpdates).toEqual([]);
      expect(updatedJob?.updatedAt).toBe(job.updatedAt);
    });
  });

  it('mirrors the Trello checklist onto the job as a read-only snapshot', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Checklist Espelho Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Checklist Espelho Teste',
        listName: 'Em Pós Produção',
        checklistItems: [
          { name: 'Abrir card monstro no Trello', checked: true },
          { name: 'Entrega final do filme', checked: false },
        ],
        due: null,
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloChecklistItems).toEqual([
        { name: 'Abrir card monstro no Trello', checked: true },
        { name: 'Entrega final do filme', checked: false },
      ]);
    });
  });

  it('does not write a no-op update when the Trello checklist mirror is unchanged', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Checklist Sem Mudança Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;
      expect(job.trelloChecklistItems).toEqual([]);

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Checklist Sem Mudança Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloChecklistItems).toEqual([]);
      expect(updatedJob?.updatedAt).toBe(job.updatedAt);
    });
  });
});
