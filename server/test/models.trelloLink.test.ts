import { describe, it, expect } from 'vitest';
import { createJob, getJobById, setAtendimentoBackup } from '../src/models/job';
import {
  setTrelloLink,
  autoUnlinkTrello,
  syncTrelloMembersToRoles,
  syncTrelloMembersToAtendimento,
  syncJobFromTrello,
  createJobFromTrelloCard,
} from '../src/models/trelloLink';
import { getJobRoleAssignments, setJobRoleAssignment } from '../src/models/jobRoleAssignments';
import { createPerson } from '../src/models/people';
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
        `SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`,
      );
      expect(result.rows[0].atendimento_person_id).toBe(wilka.rows[0].id);
    });
  });

  it('does not overwrite an Atendimento that is already set', async () => {
    await withTestTransaction(async (db) => {
      const camila = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Camila Müller' AND area = 'Atendimento'`,
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

  it('matches a person whose system name carries a city disambiguator (e.g. "Fulana (RJ)") against their plain Trello full name', async () => {
    await withTestTransaction(async (db) => {
      // Bug real: o sufixo "(RJ)"/"(Brasília)" existe só pra desambiguar no
      // cadastro interno — nunca aparece no nome de ninguém no Trello —
      // então a comparação por substring falhava sempre pra essas pessoas.
      // Pessoa criada aqui mesmo (não depende de nenhum registro seedado):
      // toda a base real de Atendimento hoje usa nomes completos do Trello,
      // sem parênteses, então esse cenário só existe pra este teste.
      const disambiguated = await createPerson(db, { name: 'Fulana (RJ)', area: 'Atendimento' });
      const job = await createJob(db, { name: 'Job Trello Atendimento Desambiguado Teste' });

      await syncTrelloMembersToAtendimento(db, job.id, null, ['Fulana Qualquer Sobrenome']);

      const result = await db.query<{ atendimento_person_id: number | null }>(
        'SELECT atendimento_person_id FROM jobs WHERE id = $1',
        [job.id],
      );
      expect(result.rows[0].atendimento_person_id).toBe(disambiguated.id);
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
      expect(updated?.trelloAutoUnlinkedAt).not.toBeNull();
    });
  });

  it('unlinks the job and returns card_archived when the Trello card is archived (closed: true)', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Card Arquivado Teste' });
      await setTrelloLink(db, created.id, 'card-arquivado');
      const job = (await getJobById(db, created.id))!;
      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Card Arquivado Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        members: [],
        comments: [],
        closed: true,
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier = fakeClassifier([]);

      const result = await syncJobFromTrello(db, trelloClient, classifier, job, { bypassConfidenceGate: false });

      expect(result.status).toBe('card_archived');
      const updated = await getJobById(db, created.id);
      expect(updated?.trelloCardId).toBeNull();
      expect(updated?.trelloAutoUnlinkedAt).not.toBeNull();
    });
  });

  it('still returns synced (with everything else already saved) when the classifier itself throws', async () => {
    await withTestTransaction(async (db) => {
      // Reproduz o bug real de produção: créditos da Anthropic esgotados
      // faziam classifyAndApply lançar, e como isso não era pego, o sync
      // inteiro "falhava" mesmo com nome/checklist/comentários já gravados.
      const created = await createJob(db, { name: 'Job Sync IA Falha Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync IA Falha Teste',
        listName: 'Em Pós Produção',
        checklistItems: [{ name: 'Item 1', checked: true }],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: 'Comentário novo',
        members: [],
        comments: [{ author: 'Alguém', text: 'Comentário novo', postedAt: '2026-08-21T00:00:00.000Z' }],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const failingClassifier: Classifier = {
        classify: async () => {
          throw new Error('Your credit balance is too low to access the Anthropic API.');
        },
      };

      const result = await syncJobFromTrello(db, trelloClient, failingClassifier, job, {
        bypassConfidenceGate: false,
      });

      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.suggestions).toEqual([]);
      }

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloChecklistItems).toEqual([{ name: 'Item 1', checked: true }]);
      expect(updatedJob?.trelloStatusUpdates).toEqual([
        { author: 'Alguém', text: 'Comentário novo', postedAt: '2026-08-21T00:00:00.000Z' },
      ]);
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        expect(result.trelloCard).toEqual({
          name: 'Job Sync Padrão Teste',
          listName: 'Em Captação 2026',
          description: null,
          url: 'https://trello.com/c/test',
          labels: [],
          members: [],
          people: [],
        });
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: 'Bora',
        members: [],
        comments: [{ author: 'Wilka Nepomoceno', text: 'Bora', postedAt: '2026-08-20T13:51:00.000Z' }],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('also matches Atendimento/roles from label names — this board uses labels to mark responsible people', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Etiqueta Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Etiqueta Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [{ name: 'Wilka Nepomoceno', color: 'purple' }],
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('corrects Atendimento to whoever posted the most recent STATUS comment, even overwriting one already set', async () => {
    await withTestTransaction(async (db) => {
      const camila = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Camila Müller' AND area = 'Atendimento'`);
      const created = await createJob(db, {
        name: 'Job Sync Status Corrige Atendimento Teste',
        atendimentoPersonId: camila.rows[0].id,
      });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Status Corrige Atendimento Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: 'STATUS 20.08',
        members: [],
        comments: [
          { author: 'Wilka Nepomoceno', text: 'STATUS 20.08\nTudo em dia.', postedAt: '2026-08-20T13:51:00.000Z' },
        ],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
    });
  });

  it('creates the STATUS author in Atendimento when no one matches, and overwrites the previous responsável with them', async () => {
    await withTestTransaction(async (db) => {
      const camila = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Camila Müller' AND area = 'Atendimento'`);
      const created = await createJob(db, {
        name: 'Job Sync Status Autor Desconhecido Teste',
        atendimentoPersonId: camila.rows[0].id,
      });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Status Autor Desconhecido Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: 'STATUS 20.08',
        members: [],
        comments: [{ author: 'Autora Nova Não Cadastrada', text: 'STATUS 20.08\nAprovado!', postedAt: '2026-08-20T13:51:00.000Z' }],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      // Ninguém chamado "Autora Nova Não Cadastrada" existia em Atendimento —
      // o autor do STATUS é o único sinal forte o bastante pra criar a
      // pessoa na hora e assumir o job, mesmo sobrescrevendo Camila.
      const newPerson = await db.query<{ id: number; active: boolean }>(
        `SELECT id, active FROM people WHERE name = 'Autora Nova Não Cadastrada' AND area = 'Atendimento'`,
      );
      expect(newPerson.rows).toHaveLength(1);
      expect(newPerson.rows[0].active).toBe(true);

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.atendimentoPersonId).toBe(newPerson.rows[0].id);
    });
  });

  describe('Atendimento backup (segundo membro do card)', () => {
    it('sets the other of exactly 2 Trello members as backup, creating them if unregistered', async () => {
      await withTestTransaction(async (db) => {
        const created = await createJob(db, { name: 'Job Backup Cria Teste' });
        await setTrelloLink(db, created.id, 'card1');
        const job = (await getJobById(db, created.id))!;

        const cardDetail: TrelloCardDetail = {
          name: 'Job Backup Cria Teste',
          listName: 'Em Pós Produção',
          checklistItems: [],
          due: null,
          description: null,
          url: 'https://trello.com/c/test',
          labels: [],
          latestComment: 'STATUS 20.08',
          members: ['Wilka Nepomoceno', 'Backup Nova Pessoa'],
          comments: [
            { author: 'Wilka Nepomoceno', text: 'STATUS 20.08\nTudo em dia.', postedAt: '2026-08-20T13:51:00.000Z' },
          ],
        };
        const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

        await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

        const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
        const backupPerson = await db.query<{ id: number }>(
          `SELECT id FROM people WHERE name = 'Backup Nova Pessoa' AND area = 'Atendimento'`,
        );
        expect(backupPerson.rows).toHaveLength(1);

        const updatedJob = await getJobById(db, created.id);
        expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
        expect(updatedJob?.atendimentoBackupPersonId).toBe(backupPerson.rows[0].id);
      });
    });

    it('does not touch the backup when the card has only 1 member', async () => {
      await withTestTransaction(async (db) => {
        const created = await createJob(db, { name: 'Job Backup Um Membro Teste' });
        await setTrelloLink(db, created.id, 'card1');
        const job = (await getJobById(db, created.id))!;

        const cardDetail: TrelloCardDetail = {
          name: 'Job Backup Um Membro Teste',
          listName: 'Em Pós Produção',
          checklistItems: [],
          due: null,
          description: null,
          url: 'https://trello.com/c/test',
          labels: [],
          latestComment: 'STATUS 20.08',
          members: ['Wilka Nepomoceno'],
          comments: [
            { author: 'Wilka Nepomoceno', text: 'STATUS 20.08\nTudo em dia.', postedAt: '2026-08-20T13:51:00.000Z' },
          ],
        };
        const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

        await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

        const updatedJob = await getJobById(db, created.id);
        expect(updatedJob?.atendimentoBackupPersonId).toBeNull();
      });
    });

    it('never overwrites an already-set backup', async () => {
      await withTestTransaction(async (db) => {
        const backupPerson = await createPerson(db, { name: 'Backup Já Definido Pessoa Teste', area: 'Atendimento' });
        const created = await createJob(db, { name: 'Job Backup Já Definido Teste' });
        await setTrelloLink(db, created.id, 'card1');
        await setAtendimentoBackup(db, created.id, backupPerson.id);
        const job = (await getJobById(db, created.id))!;
        expect(job.atendimentoBackupPersonId).toBe(backupPerson.id);

        const cardDetail: TrelloCardDetail = {
          name: 'Job Backup Já Definido Teste',
          listName: 'Em Pós Produção',
          checklistItems: [],
          due: null,
          description: null,
          url: 'https://trello.com/c/test',
          labels: [],
          latestComment: 'STATUS 20.08',
          members: ['Wilka Nepomoceno', 'Outra Pessoa Qualquer'],
          comments: [
            { author: 'Wilka Nepomoceno', text: 'STATUS 20.08\nTudo em dia.', postedAt: '2026-08-20T13:51:00.000Z' },
          ],
        };
        const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

        await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

        const updatedJob = await getJobById(db, created.id);
        expect(updatedJob?.atendimentoBackupPersonId).toBe(backupPerson.id);
      });
    });

    it('defaults to the first of exactly 2 Trello members as principal when there is no STATUS comment yet, and the second as backup', async () => {
      await withTestTransaction(async (db) => {
        const created = await createJob(db, { name: 'Job Sem Status Ainda Teste' });
        await setTrelloLink(db, created.id, 'card1');
        const job = (await getJobById(db, created.id))!;
        expect(job.atendimentoPersonId).toBeNull();

        const cardDetail: TrelloCardDetail = {
          name: 'Job Sem Status Ainda Teste',
          listName: 'Em Pós Produção',
          checklistItems: [],
          due: null,
          description: null,
          url: 'https://trello.com/c/test',
          labels: [],
          latestComment: null,
          members: ['Pessoa Principal Nova', 'Pessoa Backup Nova'],
          comments: [],
        };
        const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

        await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

        const principal = await db.query<{ id: number }>(
          `SELECT id FROM people WHERE name = 'Pessoa Principal Nova' AND area = 'Atendimento'`,
        );
        const backup = await db.query<{ id: number }>(
          `SELECT id FROM people WHERE name = 'Pessoa Backup Nova' AND area = 'Atendimento'`,
        );
        expect(principal.rows).toHaveLength(1);
        expect(backup.rows).toHaveLength(1);

        const updatedJob = await getJobById(db, created.id);
        expect(updatedJob?.atendimentoPersonId).toBe(principal.rows[0].id);
        expect(updatedJob?.atendimentoBackupPersonId).toBe(backup.rows[0].id);
      });
    });
  });

  it('returns a faithful trelloCard view: description, url, labels, and a deduped members+labels people list', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Card Fiel Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Card Fiel Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: 'Briefing: https://drive.google.com/drive/folders/abc123',
        url: 'https://trello.com/c/card-fiel',
        // "Wilka Nepomoceno" está tanto como membro quanto (redundantemente)
        // como etiqueta — não deve duplicar na lista de pessoas envolvidas.
        labels: [{ name: 'Wilka Nepomoceno', color: 'purple' }, { name: '', color: 'green' }],
        latestComment: null,
        members: ['Wilka Nepomoceno', 'Camila'],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      const result = await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      expect(result.status).toBe('synced');
      if (result.status === 'synced') {
        expect(result.trelloCard).toEqual({
          name: 'Job Sync Card Fiel Teste',
          listName: 'Em Pós Produção',
          description: 'Briefing: https://drive.google.com/drive/folders/abc123',
          url: 'https://trello.com/c/card-fiel',
          labels: [{ name: 'Wilka Nepomoceno', color: 'purple' }, { name: '', color: 'green' }],
          members: ['Wilka Nepomoceno', 'Camila'],
          people: ['Wilka Nepomoceno', 'Camila'],
        });
      }
    });
  });

  it('persists every recent comment, not just ones that look like a team STATUS update', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Status Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Status Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        { author: 'Cliente', text: 'Ficou ótimo, obrigado!', postedAt: '2026-08-20T10:00:00.000Z' },
        {
          author: 'Bianca de Souza Andrade',
          text: 'STATUS 19.08 às 14h40\nPrevisto envio no fim do dia.',
          postedAt: '2026-08-19T14:40:00.000Z',
        },
      ]);
    });
  });

  it('still uses only the STATUS-tagged comment to correct Atendimento, even when a more recent non-STATUS comment exists', async () => {
    await withTestTransaction(async (db) => {
      const camila = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Camila Müller' AND area = 'Atendimento'`);
      const created = await createJob(db, {
        name: 'Job Sync Comentário Não Status Não Corrige Teste',
        atendimentoPersonId: camila.rows[0].id,
      });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Comentário Não Status Não Corrige Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: 'Ficou ótimo, obrigado!',
        members: [],
        comments: [
          // Mais recente, mas não é um "STATUS" — não deve virar sinal de
          // correção de Atendimento, só entra no espelho de comentários.
          { author: 'Cliente', text: 'Ficou ótimo, obrigado!', postedAt: '2026-08-20T15:00:00.000Z' },
          {
            author: 'Wilka Nepomoceno',
            text: 'STATUS 20.08\nTudo em dia.',
            postedAt: '2026-08-20T13:51:00.000Z',
          },
        ],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      expect(updatedJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(updatedJob?.trelloStatusUpdates).toHaveLength(2);
    });
  });

  it('does not write a no-op update when the extracted comments already match what is stored', async () => {
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        members: [],
        comments: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
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

  it('mirrors the Trello description onto the job, so it becomes searchable', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Descrição Espelho Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;
      expect(job.trelloDescription).toBeNull();

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Descrição Espelho Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: 'Briefing: gravação externa marcada para sexta-feira.',
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloDescription).toBe('Briefing: gravação externa marcada para sexta-feira.');
    });
  });

  it('does not write a no-op update when the Trello description is unchanged', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Sync Descrição Sem Mudança Teste' });
      await setTrelloLink(db, created.id, 'card1');
      const job = (await getJobById(db, created.id))!;
      expect(job.trelloDescription).toBeNull();

      const cardDetail: TrelloCardDetail = {
        name: 'Job Sync Descrição Sem Mudança Teste',
        listName: 'Em Pós Produção',
        checklistItems: [],
        due: null,
        description: null,
        url: 'https://trello.com/c/test',
        labels: [],
        latestComment: null,
        members: [],
        comments: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });

      await syncJobFromTrello(db, trelloClient, undefined, job, { bypassConfidenceGate: false });

      const updatedJob = await getJobById(db, created.id);
      expect(updatedJob?.trelloDescription).toBeNull();
      expect(updatedJob?.updatedAt).toBe(job.updatedAt);
    });
  });
});

describe('autoUnlinkTrello', () => {
  it('clears the link and sets trelloAutoUnlinkedAt', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Auto Desvincular Teste' });
      await setTrelloLink(db, created.id, 'card1');

      await autoUnlinkTrello(db, created.id);

      const updated = await getJobById(db, created.id);
      expect(updated?.trelloCardId).toBeNull();
      expect(updated?.trelloAutoUnlinkedAt).not.toBeNull();
    });
  });
});

describe('setTrelloLink clearing the auto-unlink warning', () => {
  it('clears trelloAutoUnlinkedAt when the job is linked to a card again', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Relink Depois De Auto Teste' });
      await setTrelloLink(db, created.id, 'card1');
      await autoUnlinkTrello(db, created.id);

      await setTrelloLink(db, created.id, 'card-novo');

      const updated = await getJobById(db, created.id);
      expect(updated?.trelloCardId).toBe('card-novo');
      expect(updated?.trelloAutoUnlinkedAt).toBeNull();
    });
  });
});

function trelloCard(overrides: Partial<TrelloCardDetail> = {}): TrelloCardDetail {
  return {
    name: 'Card Novo Teste',
    listName: 'Em Captação 2026',
    checklistItems: [],
    due: null,
    description: null,
    url: 'https://trello.com/c/card-novo',
    labels: [],
    latestComment: null,
    members: [],
    comments: [],
    closed: false,
    ...overrides,
  };
}

describe('createJobFromTrelloCard', () => {
  it('creates a new job matching the Atendimento of whoever created the card', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({ getCard: async () => trelloCard({ name: 'Job Criado Do Zero Teste' }) });

      const result = await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', 'Wilka Nepomoceno');

      expect(result.status).toBe('synced');
      const created = (await db.query<{ id: number }>(`SELECT id FROM jobs WHERE name = 'Job Criado Do Zero Teste'`))
        .rows[0];
      expect(created).toBeDefined();
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      const createdJob = await getJobById(db, created.id);
      expect(createdJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(createdJob?.trelloCardId).toBe('card-novo');
    });
  });

  it('creates the card creator in Atendimento when they cannot be matched, and assigns them to the new job', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        getCard: async () => trelloCard({ name: 'Job Criador Desconhecido Teste' }),
      });

      await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', 'Alguém De Fora');

      const created = (
        await db.query<{ id: number }>(`SELECT id FROM jobs WHERE name = 'Job Criador Desconhecido Teste'`)
      ).rows[0];
      const newPerson = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Alguém De Fora' AND area = 'Atendimento'`,
      );
      expect(newPerson.rows).toHaveLength(1);
      const createdJob = await getJobById(db, created.id);
      expect(createdJob?.atendimentoPersonId).toBe(newPerson.rows[0].id);
    });
  });

  it('also assigns the other Trello member as backup when creating a job from a card with exactly 2 members', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        getCard: async () =>
          trelloCard({
            name: 'Job Criado Com Backup Teste',
            members: ['Wilka Nepomoceno', 'Backup Da Criação Nova'],
          }),
      });

      await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', 'Wilka Nepomoceno');

      const created = (
        await db.query<{ id: number }>(`SELECT id FROM jobs WHERE name = 'Job Criado Com Backup Teste'`)
      ).rows[0];
      const wilka = await db.query<{ id: number }>(`SELECT id FROM people WHERE name = 'Wilka Nepomoceno' AND area = 'Atendimento'`);
      const backupPerson = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Backup Da Criação Nova' AND area = 'Atendimento'`,
      );
      expect(backupPerson.rows).toHaveLength(1);

      const createdJob = await getJobById(db, created.id);
      expect(createdJob?.atendimentoPersonId).toBe(wilka.rows[0].id);
      expect(createdJob?.atendimentoBackupPersonId).toBe(backupPerson.rows[0].id);
    });
  });

  it('creates the job without an Atendimento when no creator name is provided', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({ getCard: async () => trelloCard({ name: 'Job Sem Criador Teste' }) });

      await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', undefined);

      const created = (await db.query<{ id: number }>(`SELECT id FROM jobs WHERE name = 'Job Sem Criador Teste'`))
        .rows[0];
      const createdJob = await getJobById(db, created.id);
      expect(createdJob?.atendimentoPersonId).toBeNull();
    });
  });

  it('links to an existing unlinked job with the exact same name instead of creating a duplicate', async () => {
    await withTestTransaction(async (db) => {
      const existing = await createJob(db, { name: 'Job Já Existe Sem Vínculo Teste' });
      const trelloClient = fakeTrelloClient({
        getCard: async () => trelloCard({ name: 'Job Já Existe Sem Vínculo Teste' }),
      });

      await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', undefined);

      const updated = await getJobById(db, existing.id);
      expect(updated?.trelloCardId).toBe('card-novo');
      const dupCount = (
        await db.query<{ count: string }>(
          `SELECT COUNT(*) FROM jobs WHERE lower(trim(name)) = lower(trim('Job Já Existe Sem Vínculo Teste'))`,
        )
      ).rows[0].count;
      expect(dupCount).toBe('1');
    });
  });

  it('skips creating a job when a job with that exact name already exists and is linked to a different card', async () => {
    await withTestTransaction(async (db) => {
      const existing = await createJob(db, { name: 'Job Já Vinculado A Outro Card Teste' });
      await setTrelloLink(db, existing.id, 'card-antigo');
      const trelloClient = fakeTrelloClient({
        getCard: async () => trelloCard({ name: 'Job Já Vinculado A Outro Card Teste' }),
      });

      const result = await createJobFromTrelloCard(db, trelloClient, undefined, 'card-novo', undefined);

      expect(result.status).toBe('skipped');
      const stillOnOldCard = await getJobById(db, existing.id);
      expect(stillOnOldCard?.trelloCardId).toBe('card-antigo');
    });
  });

  it('skips when the card no longer exists or is archived', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({ getCard: async () => null });
      const result = await createJobFromTrelloCard(db, trelloClient, undefined, 'card-sumiu', undefined);
      expect(result.status).toBe('skipped');
    });
  });
});
