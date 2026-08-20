# Integração Trello (leitura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler dados de um board fixo do Trello (por job, vinculado por nome/código) e alimentar o mesmo classificador de IA já existente, automaticamente toda vez que o job é aberto — sem nunca escrever de volta no Trello.

**Architecture:** Um cliente HTTP fino pro Trello (`server/src/services/trello.ts`, mesma forma de `services/classifier.ts`), um par de campos novos em `jobs` pra guardar o vínculo job↔card, e três rotas novas que reaproveitam `classifyAndApply` sem alterá-la — o texto colado manualmente do WhatsApp e o texto derivado de um card do Trello entram pelo mesmo cano.

**Tech Stack:** Node.js + Express + TypeScript, `pg`, `vitest` + `supertest` (backend); React + Vite + TypeScript, Vitest + Testing Library (frontend). Sem dependência nova — a API REST do Trello é chamada via `fetch` (já usado por outras partes do projeto/runtime Node).

**Spec:** [docs/superpowers/specs/2026-08-20-integracao-trello-design.md](../specs/2026-08-20-integracao-trello-design.md)

## Global Constraints

- Só leitura: nenhuma chamada de escrita à API do Trello em nenhum lugar deste plano.
- Um board só, configurado via `TRELLO_BOARD_ID` — nunca implementar suporte a múltiplos boards.
- Credencial única da equipe (`TRELLO_API_KEY` + `TRELLO_TOKEN`), nunca por usuário, nunca exposta ao frontend — só lida em `server/src/index.ts`, mesmo padrão do `ANTHROPIC_API_KEY`.
- Sem as três variáveis configuradas, as rotas novas respondem `503` sem quebrar nada — mesmo padrão de `POST /api/jobs/:id/classify` quando `ANTHROPIC_API_KEY` não está configurada.
- A interpretação do texto do Trello (lista → fase, itens do checklist → status) passa inteiramente por `classifyAndApply` (`server/src/models/classification.ts`) — nenhuma lógica nova de mapeamento determinístico lista↔fase ou item↔status, nenhuma mudança na própria `classifyAndApply`.
- Toda rota nova fica atrás do `requireAuth`/`requireActiveUser` já aplicado em `createJobsRouter` (`server/src/routes/jobs.ts:26-27`) — não criar um router separado, não bypassar essa cadeia.
- Toda escrita que atualiza `jobs` deve continuar seguindo os padrões já estabelecidos no arquivo (`updated_at = now()` em toda escrita).

---

### Task 1: Cliente HTTP do Trello + colunas de vínculo

**Files:**
- Modify: `server/src/db/schema.sql`
- Create: `server/src/services/trello.ts`
- Test: `server/test/services.trello.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (task fundacional).
- Produces: `TrelloCardSummary { id, name, listName }`, `TrelloChecklistItem { name, checked }`, `TrelloCardDetail { name, listName, checklistItems, due, latestComment, members }`, `TrelloClient { listBoardCards(): Promise<TrelloCardSummary[]>; getCard(cardId: string): Promise<TrelloCardDetail | null> }`, `createHttpTrelloClient(apiKey, token, boardId, fetchImpl?): TrelloClient` — todos exportados de `server/src/services/trello.ts`, usados pela Task 2.

- [ ] **Step 1: Adicionar as colunas de vínculo ao schema**

No final de `server/src/db/schema.sql` (depois do último bloco já existente), adicione:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_card_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trello_linked_at TIMESTAMPTZ;
```

- [ ] **Step 2: Escrever os testes que falham para o cliente do Trello**

Crie `server/test/services.trello.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createHttpTrelloClient } from '../src/services/trello';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('createHttpTrelloClient', () => {
  describe('listBoardCards', () => {
    it('joins cards with their list names', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/boards/board123/lists')) {
          return jsonResponse([
            { id: 'list1', name: 'Em Captação 2026' },
            { id: 'list2', name: 'Concluído' },
          ]);
        }
        if (url.includes('/boards/board123/cards')) {
          return jsonResponse([
            { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', idList: 'list1' },
            { id: 'card2', name: 'NOVA:: SESCOOP', idList: 'list2' },
          ]);
        }
        throw new Error(`unexpected URL: ${url}`);
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const cards = await client.listBoardCards();

      expect(cards).toEqual([
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
        { id: 'card2', name: 'NOVA:: SESCOOP', listName: 'Concluído' },
      ]);
    });

    it('includes the api key and token as query params on every request', async () => {
      const fetchMock = vi.fn(async () => jsonResponse([]));
      const client = createHttpTrelloClient('my-key', 'my-token', 'board123', fetchMock as unknown as typeof fetch);

      await client.listBoardCards();

      const calledUrls = fetchMock.mock.calls.map((call) => call[0] as string);
      expect(calledUrls.length).toBeGreaterThan(0);
      expect(calledUrls.every((url) => url.includes('key=my-key') && url.includes('token=my-token'))).toBe(true);
    });
  });

  describe('getCard', () => {
    it('returns null for a 404 (deleted/invalid card)', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: 'not found' }, 404));
      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);

      const result = await client.getCard('missing-card');

      expect(result).toBeNull();
    });

    it('parses name, list name, checklist items, due date, comment, and members', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/cards/card1/actions')) {
          return jsonResponse([{ data: { text: 'Cliente aprovou o orçamento hoje' } }]);
        }
        return jsonResponse({
          name: 'WPP:: COLGATE:: CAMPANHA',
          due: '2026-08-28T00:00:00.000Z',
          list: { name: 'Em Captação 2026' },
          checklists: [
            {
              checkItems: [
                { name: 'Contrato assinado', state: 'complete' },
                { name: 'Equipamento reservado', state: 'incomplete' },
              ],
            },
          ],
          members: [{ fullName: 'Wilka Nepomoceno' }],
        });
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const card = await client.getCard('card1');

      expect(card).toEqual({
        name: 'WPP:: COLGATE:: CAMPANHA',
        listName: 'Em Captação 2026',
        checklistItems: [
          { name: 'Contrato assinado', checked: true },
          { name: 'Equipamento reservado', checked: false },
        ],
        due: '2026-08-28T00:00:00.000Z',
        latestComment: 'Cliente aprovou o orçamento hoje',
        members: ['Wilka Nepomoceno'],
      });
    });

    it('returns latestComment null when there are no comments', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes('/actions')) {
          return jsonResponse([]);
        }
        return jsonResponse({
          name: 'Card sem comentário',
          due: null,
          list: { name: 'Em Orçamento 2026' },
          checklists: [],
          members: [],
        });
      });

      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);
      const card = await client.getCard('card2');

      expect(card?.latestComment).toBeNull();
    });

    it('throws on a non-404 error response, for the caller to handle', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: 'rate limited' }, 429));
      const client = createHttpTrelloClient('key', 'token', 'board123', fetchMock as unknown as typeof fetch);

      await expect(client.getCard('card1')).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `cd server && npx vitest run test/services.trello.test.ts`
Expected: FAIL — `Cannot find module '../src/services/trello'`.

- [ ] **Step 4: Criar `server/src/services/trello.ts`**

```typescript
export interface TrelloCardSummary {
  id: string;
  name: string;
  listName: string;
}

export interface TrelloChecklistItem {
  name: string;
  checked: boolean;
}

export interface TrelloCardDetail {
  name: string;
  listName: string;
  checklistItems: TrelloChecklistItem[];
  due: string | null;
  latestComment: string | null;
  members: string[];
}

export interface TrelloClient {
  listBoardCards(): Promise<TrelloCardSummary[]>;
  getCard(cardId: string): Promise<TrelloCardDetail | null>;
}

type FetchFn = typeof fetch;

interface TrelloListResponse {
  id: string;
  name: string;
}

interface TrelloCardListResponse {
  id: string;
  name: string;
  idList: string;
}

interface TrelloCheckItemResponse {
  name: string;
  state: 'complete' | 'incomplete';
}

interface TrelloChecklistResponse {
  checkItems: TrelloCheckItemResponse[];
}

interface TrelloMemberResponse {
  fullName: string;
}

interface TrelloCardDetailResponse {
  name: string;
  due: string | null;
  list?: { name: string };
  checklists?: TrelloChecklistResponse[];
  members?: TrelloMemberResponse[];
}

interface TrelloCommentActionResponse {
  data: { text: string };
}

export function createHttpTrelloClient(
  apiKey: string,
  token: string,
  boardId: string,
  fetchImpl: FetchFn = fetch,
): TrelloClient {
  const authQuery = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;

  async function trelloGet<T>(path: string, extraParams: string): Promise<T> {
    const res = await fetchImpl(`https://api.trello.com/1${path}?${authQuery}${extraParams}`);
    if (!res.ok) {
      throw new Error(`Trello API error ${res.status} on ${path}`);
    }
    return (await res.json()) as T;
  }

  return {
    async listBoardCards(): Promise<TrelloCardSummary[]> {
      const [lists, cards] = await Promise.all([
        trelloGet<TrelloListResponse[]>(`/boards/${boardId}/lists`, '&fields=name'),
        trelloGet<TrelloCardListResponse[]>(`/boards/${boardId}/cards`, '&fields=name,idList'),
      ]);
      const listNameById = new Map(lists.map((l) => [l.id, l.name]));
      return cards.map((card) => ({
        id: card.id,
        name: card.name,
        listName: listNameById.get(card.idList) ?? '',
      }));
    },

    async getCard(cardId: string): Promise<TrelloCardDetail | null> {
      const res = await fetchImpl(
        `https://api.trello.com/1/cards/${cardId}?${authQuery}` +
          '&fields=name,due&checklists=all&checklist_fields=name&list=true&members=true&member_fields=fullName',
      );

      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error(`Trello API error ${res.status} on /cards/${cardId}`);
      }

      const card = (await res.json()) as TrelloCardDetailResponse;

      const checklistItems: TrelloChecklistItem[] = (card.checklists ?? []).flatMap((checklist) =>
        checklist.checkItems.map((item) => ({
          name: item.name,
          checked: item.state === 'complete',
        })),
      );

      const comments = await trelloGet<TrelloCommentActionResponse[]>(
        `/cards/${cardId}/actions`,
        '&filter=commentCard&limit=1',
      );

      return {
        name: card.name,
        listName: card.list?.name ?? '',
        checklistItems,
        due: card.due,
        latestComment: comments[0]?.data.text ?? null,
        members: (card.members ?? []).map((m) => m.fullName),
      };
    },
  };
}
```

- [ ] **Step 5: Rodar os testes de novo e ver passar**

Run: `cd server && npx vitest run test/services.trello.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 6: Rodar a suíte inteira e o build**

Run: `cd server && npm test`
Expected: 20 arquivos de teste anteriores + 1 novo, todos passando (134 + 6 = 140).

Run: `cd server && npm run build`
Expected: compila sem erro.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/schema.sql server/src/services/trello.ts server/test/services.trello.test.ts
git commit -m "feat(trello): add read-only Trello HTTP client"
```

---

### Task 2: Vinculação, sincronização e rotas

**Files:**
- Create: `server/src/models/trelloMatch.ts`
- Create: `server/src/models/trelloLink.ts`
- Test: `server/test/models.trelloMatch.test.ts`
- Test: `server/test/models.trelloLink.test.ts`
- Modify: `server/src/models/job.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/jobs.ts`
- Modify: `server/.env.example`
- Test: `server/test/routes.jobs.test.ts`

**Interfaces:**
- Consumes: `TrelloClient`, `TrelloCardSummary`, `TrelloCardDetail` (Task 1); `classifyAndApply` de `server/src/models/classification.ts` (já existente, sem alterações); `Job`/`getJobById` de `server/src/models/job.ts`; `listPeople` de `server/src/models/people.ts`; `getJobRoleAssignments`/`setJobRoleAssignment` de `server/src/models/jobRoleAssignments.ts` (todos já existentes, sem alterações).
- Produces: `findTrelloCandidates(job, cards): TrelloCandidate[]` e `buildTrelloEvidenceText(card): string` de `trelloMatch.ts`; `setTrelloLink(db, jobId, trelloCardId): Promise<void>` e `syncTrelloMembersToRoles(db, jobId, phaseId, trelloMemberNames): Promise<void>` de `trelloLink.ts`; `Job.trelloCardId: string | null` e `Job.trelloLinkedAt: string | null`; rotas `GET /api/jobs/:id/trello-candidates`, `POST /api/jobs/:id/trello-link`, `POST /api/jobs/:id/trello-sync`.

- [ ] **Step 1: Escrever os testes que falham para o casamento de candidatos**

Crie `server/test/models.trelloMatch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findTrelloCandidates } from '../src/models/trelloMatch';

describe('findTrelloCandidates', () => {
  const cards = [
    { id: 'c1', name: 'WPP:: COLGATE:: CAMPANHA LW COLOR CORRECT WAVE 2', listName: 'Em Captação 2026' },
    { id: 'c2', name: 'NOVA:: SESCOOP:: LICITAÇÃO', listName: 'Em Pré-Produção 2026' },
    { id: 'c3', name: '6P:: BARÃO DE MAUÁ:: VESTIBULAR 2027', listName: 'Em Pós Produção' },
  ];

  it('finds a strong match when every job word appears in the card name', () => {
    const candidates = findTrelloCandidates(
      { name: 'Campanha Color Correct Wave 2', client: 'Colgate', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c1');
    expect(candidates[0].strongMatch).toBe(true);
  });

  it('does not mark a partial match as strong', () => {
    const candidates = findTrelloCandidates(
      { name: 'Vestibular 2028', client: 'Barão de Mauá', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c3');
    expect(candidates[0].strongMatch).toBe(false);
  });

  it('returns an empty list when nothing matches', () => {
    const candidates = findTrelloCandidates({ name: 'Job Sem Relação Nenhuma', client: null, code: null }, cards);

    expect(candidates).toEqual([]);
  });

  it('is accent- and case-insensitive', () => {
    const candidates = findTrelloCandidates(
      { name: 'campanha color correct wave 2', client: 'colgate', code: null },
      cards,
    );

    expect(candidates[0].id).toBe('c1');
  });

  it('caps results at 10 candidates', () => {
    const manyCards = Array.from({ length: 15 }, (_, i) => ({
      id: `c${i}`,
      name: `TESTE:: CLIENTE:: JOB ${i}`,
      listName: 'Em Orçamento 2026',
    }));

    const candidates = findTrelloCandidates({ name: 'Job', client: 'Cliente', code: null }, manyCards);

    expect(candidates.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd server && npx vitest run test/models.trelloMatch.test.ts`
Expected: FAIL — `Cannot find module '../src/models/trelloMatch'`.

- [ ] **Step 3: Criar `server/src/models/trelloMatch.ts`**

```typescript
import type { TrelloCardDetail, TrelloCardSummary } from '../services/trello';

export interface TrelloCandidate {
  id: string;
  name: string;
  listName: string;
  strongMatch: boolean;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findTrelloCandidates(
  job: { name: string; client: string | null; code: string | null },
  cards: TrelloCardSummary[],
): TrelloCandidate[] {
  const jobWords = new Set(
    [job.name, job.client, job.code]
      .filter((v): v is string => Boolean(v && v.trim()))
      .flatMap((v) => normalize(v).split(' '))
      .filter((w) => w.length > 2),
  );

  if (jobWords.size === 0) {
    return [];
  }

  return cards
    .map((card) => {
      const cardWords = new Set(normalize(card.name).split(' ').filter((w) => w.length > 2));
      const matchedWords = [...jobWords].filter((w) => cardWords.has(w));
      return {
        id: card.id,
        name: card.name,
        listName: card.listName,
        score: matchedWords.length,
        strongMatch: matchedWords.length === jobWords.size,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ id, name, listName, strongMatch }) => ({ id, name, listName, strongMatch }));
}

export function buildTrelloEvidenceText(card: TrelloCardDetail): string {
  const lines = [`Lista atual no Trello: ${card.listName}`];

  if (card.checklistItems.length > 0) {
    const checklistLines = card.checklistItems
      .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.name}`)
      .join('\n');
    lines.push('Checklist do Trello:', checklistLines);
  }

  if (card.due) {
    lines.push(`Prazo: ${new Date(card.due).toLocaleDateString('pt-BR')}`);
  }

  if (card.latestComment) {
    lines.push(`Comentário mais recente: "${card.latestComment}"`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Rodar de novo e ver passar**

Run: `cd server && npx vitest run test/models.trelloMatch.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Escrever os testes que falham para `trelloLink.ts`**

Os avatares de membro que aparecem em cada card do Trello precisam
alimentar "quem é o responsável" nas áreas já cadastradas (ex.:
Atendimento) — sem passar pela IA, já que é uma correspondência de
identidade literal (nome do Trello = nome cadastrado em `people`), não
uma inferência de texto. Crie `server/test/models.trelloLink.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { setTrelloLink, syncTrelloMembersToRoles } from '../src/models/trelloLink';
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
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `cd server && npx vitest run test/models.trelloLink.test.ts`
Expected: FAIL — `Cannot find module '../src/models/trelloLink'`.

- [ ] **Step 7: Criar `server/src/models/trelloLink.ts`**

```typescript
import type { AppDatabase } from '../db';
import { listPeople } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';

export async function setTrelloLink(
  db: AppDatabase,
  jobId: number,
  trelloCardId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE jobs
     SET trello_card_id = $1,
         trello_linked_at = CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
         updated_at = now()
     WHERE id = $2`,
    [trelloCardId, jobId],
  );
}

function normalizePersonName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Deterministic (no AI): a Trello card's assigned members are a literal
 * identity match against `people`, not a fuzzy status inference, so this
 * never goes through the classifier. Only fills role areas that are
 * currently unassigned for this job/phase — never overwrites an existing
 * assignment, whether it was set manually or by a previous sync.
 */
export async function syncTrelloMembersToRoles(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
  trelloMemberNames: string[],
): Promise<void> {
  if (trelloMemberNames.length === 0) {
    return;
  }

  const [roleAssignments, people] = await Promise.all([
    getJobRoleAssignments(db, jobId, phaseId),
    listPeople(db, { activeOnly: true }),
  ]);

  const normalizedMembers = trelloMemberNames.map(normalizePersonName);

  for (const assignment of roleAssignments) {
    if (assignment.personId !== null) {
      continue;
    }

    const match = people.find((person) => {
      if (person.area !== assignment.area) {
        return false;
      }
      const normalizedPersonName = normalizePersonName(person.name);
      return normalizedMembers.some(
        (member) => member.includes(normalizedPersonName) || normalizedPersonName.includes(member),
      );
    });

    if (match) {
      await setJobRoleAssignment(db, jobId, phaseId, assignment.area, match.id);
    }
  }
}
```

- [ ] **Step 8: Rodar de novo e ver passar**

Run: `cd server && npx vitest run test/models.trelloLink.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 9: Ligar `trelloCardId`/`trelloLinkedAt` ao tipo `Job`**

Em `server/src/models/job.ts`, adicione à interface `Job` (depois de `triggerLabel`):

```typescript
  triggerLabel: string | null;
  trelloCardId: string | null;
  trelloLinkedAt: string | null;
```

Adicione à interface `JobRow` (depois de `status_trigger_label`):

```typescript
  status_trigger_label: string | null;
  trello_card_id: string | null;
  trello_linked_at: string | Date | null;
```

Em `rowToJob`, adicione ao objeto retornado (depois de `triggerLabel: row.status_trigger_label,`):

```typescript
    triggerLabel: row.status_trigger_label,
    trelloCardId: row.trello_card_id,
    trelloLinkedAt: row.trello_linked_at ? new Date(row.trello_linked_at).toISOString() : null,
```

Não precisa mudar `JOB_SELECT` — ele já faz `j.*`, então as colunas novas aparecem automaticamente.

- [ ] **Step 10: Ligar o `TrelloClient` opcional em `app.ts` e `index.ts`**

Em `server/src/app.ts`, atualize o import e a interface `AppDeps`:

```typescript
import type { Classifier } from './services/classifier';
import type { TrelloClient } from './services/trello';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
  classifier?: Classifier;
  trelloClient?: TrelloClient;
}
```

Em `server/src/routes/jobs.ts`, atualize `JobsRouterDeps`:

```typescript
export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
  classifier?: Classifier;
  trelloClient?: TrelloClient;
}
```

(adicione `import type { TrelloClient } from '../services/trello';` junto aos outros imports do topo do arquivo.)

Em `server/src/index.ts`, atualize:

```typescript
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';
import { createHttpTrelloClient } from './services/trello';

const port = Number(process.env.PORT ?? 4000);
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const trelloApiKey = process.env.TRELLO_API_KEY;
const trelloToken = process.env.TRELLO_TOKEN;
const trelloBoardId = process.env.TRELLO_BOARD_ID;
const trelloConfigured = Boolean(trelloApiKey && trelloToken && trelloBoardId);

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
if (!googleClientId) {
  throw new Error('GOOGLE_CLIENT_ID environment variable is required');
}

async function main() {
  const db = await createDb(connectionString!);

  const app = createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId!),
    jwtSecret: jwtSecret!,
    allowedDomain,
    frontendUrl,
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
    trelloClient: trelloConfigured
      ? createHttpTrelloClient(trelloApiKey!, trelloToken!, trelloBoardId!)
      : undefined,
  });

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    if (!anthropicApiKey) {
      console.warn('ANTHROPIC_API_KEY not set — POST /api/jobs/:id/classify will return 503');
    }
    if (!trelloConfigured) {
      console.warn(
        'TRELLO_API_KEY/TRELLO_TOKEN/TRELLO_BOARD_ID not fully set — Trello integration endpoints will return 503',
      );
    }
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

- [ ] **Step 11: Adicionar as 3 rotas em `server/src/routes/jobs.ts`**

Atualize os imports do topo do arquivo:

```typescript
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setLastWhatsappActivity } from '../models/job';
import { setBolaCom, getBolaComDayCounts, getBolaComDayCountsForJobs } from '../models/bolaCom';
import { getJobStatusHistory } from '../models/jobStatusHistory';
import { getJobRoleAssignments, setJobRoleAssignment } from '../models/jobRoleAssignments';
import { classifyAndApply } from '../models/classification';
import { findTrelloCandidates, buildTrelloEvidenceText } from '../models/trelloMatch';
import { setTrelloLink, syncTrelloMembersToRoles } from '../models/trelloLink';
import { requireAuth, requireActiveUser } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';
import type { Classifier } from '../services/classifier';
import type { TrelloClient } from '../services/trello';
```

Adicione as três rotas depois da rota `POST /:id/classify` (antes do `return router;` final):

```typescript
  router.get(
    '/:id/trello-candidates',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      if (!deps.trelloClient) {
        res.status(503).json({ error: 'trello_nao_configurado' });
        return;
      }

      const job = await getJobById(deps.db, jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      let cards;
      try {
        cards = await deps.trelloClient.listBoardCards();
      } catch {
        res.status(502).json({ error: 'trello_api_error' });
        return;
      }

      const candidates = findTrelloCandidates(job, cards);
      res.json({ candidates });
    }),
  );

  router.post(
    '/:id/trello-link',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      if (!('trelloCardId' in req.body)) {
        res.status(400).json({ error: 'trelloCardId is required (use null to unlink)' });
        return;
      }

      const { trelloCardId } = req.body as { trelloCardId: string | null };

      const existing = await getJobById(deps.db, jobId);
      if (!existing) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      await setTrelloLink(deps.db, jobId, trelloCardId);
      const job = await getJobById(deps.db, jobId);
      res.json({ job });
    }),
  );

  router.post(
    '/:id/trello-sync',
    asyncHandler(async (req, res) => {
      const jobId = parseId(req.params.id);
      if (jobId === null) {
        res.status(400).json({ error: 'invalid job id' });
        return;
      }

      if (!deps.trelloClient) {
        res.status(503).json({ error: 'trello_nao_configurado' });
        return;
      }
      if (!deps.classifier) {
        res.status(503).json({ error: 'ia_nao_configurada' });
        return;
      }

      const job = await getJobById(deps.db, jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      if (!job.trelloCardId) {
        res.status(400).json({ error: 'job is not linked to a Trello card' });
        return;
      }

      let card;
      try {
        card = await deps.trelloClient.getCard(job.trelloCardId);
      } catch {
        res.status(502).json({ error: 'trello_api_error' });
        return;
      }

      if (!card) {
        await setTrelloLink(deps.db, jobId, null);
        res.status(404).json({ error: 'trello_card_not_found' });
        return;
      }

      if (job.phaseId) {
        await syncTrelloMembersToRoles(deps.db, jobId, job.phaseId, card.members);
      }

      const evidenceText = buildTrelloEvidenceText(card);
      const suggestions = await classifyAndApply(deps.db, deps.classifier, jobId, evidenceText);
      res.json({ suggestions, trelloCard: { name: card.name, listName: card.listName } });
    }),
  );
```

- [ ] **Step 12: Adicionar `.env.example`**

Em `server/.env.example`, adicione ao final:

```
TRELLO_API_KEY=
TRELLO_TOKEN=
TRELLO_BOARD_ID=
```

- [ ] **Step 13: Escrever os testes de rota**

Em `server/test/routes.jobs.test.ts`, atualize o import do topo (junto aos outros tipos já importados de `classifier`):

```typescript
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import type { TrelloClient, TrelloCardSummary, TrelloCardDetail } from '../src/services/trello';
```

Adicione ao final do arquivo:

```typescript
function fakeTrelloClient(overrides: Partial<TrelloClient> = {}): TrelloClient {
  return {
    listBoardCards: async () => [],
    getCard: async () => null,
    ...overrides,
  };
}

function buildAppWithDeps(db: AppDatabase, extra: { classifier?: Classifier; trelloClient?: TrelloClient }) {
  return createApp({
    db,
    verifyIdToken: async () => ({
      sub: 'google-sub-1',
      email: 'wilka@ilhacrossmidia.com.br',
      name: 'Wilka',
    }),
    jwtSecret: JWT_SECRET,
    allowedDomain: ALLOWED_DOMAIN,
    frontendUrl: FRONTEND_URL,
    ...extra,
  });
}

describe('GET /api/jobs/:id/trello-candidates', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Candidatos Teste' });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(503);
    });
  });

  it('returns scored candidates from the configured board', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async (): Promise<TrelloCardSummary[]> => [
          { id: 'card1', name: 'WPP:: Colgate Campanha Teste', listName: 'Em Captação 2026' },
        ],
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);

      const created = await agent
        .post('/api/jobs')
        .send({ name: 'Colgate Campanha Teste', client: 'Colgate' });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].id).toBe('card1');
      expect(res.body.candidates[0].strongMatch).toBe(true);
    });
  });

  it('returns 502 when the Trello API call fails', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        listBoardCards: async () => {
          throw new Error('Trello API error 429');
        },
      });
      const app = buildAppWithDeps(db, { trelloClient });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Erro Teste' });
      const res = await agent.get(`/api/jobs/${created.body.job.id}/trello-candidates`);

      expect(res.status).toBe(502);
    });
  });
});

describe('POST /api/jobs/:id/trello-link', () => {
  it('links a job to a Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Link Teste' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/trello-link`)
        .send({ trelloCardId: 'card1' });

      expect(res.status).toBe(200);
      expect(res.body.job.trelloCardId).toBe('card1');
    });
  });

  it('unlinks when trelloCardId is null', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Unlink Teste' });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });
      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/trello-link`)
        .send({ trelloCardId: null });

      expect(res.status).toBe(200);
      expect(res.body.job.trelloCardId).toBeNull();
    });
  });

  it('rejects a body missing trelloCardId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Link Inválido Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('POST /api/jobs/:id/trello-sync', () => {
  it('returns 503 when Trello is not configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Sem Config Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(503);
    });
  });

  it('returns 400 when the job has no linked card', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient();
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Não Vinculado Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(400);
    });
  });

  it('unlinks and returns 404 when the linked card no longer exists', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({ getCard: async () => null });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Card Sumiu Teste' });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(404);

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      expect(jobRes.body.job.trelloCardId).toBeNull();
    });
  });

  it('builds evidence text from the Trello card and classifies it', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Captação 2026',
        checklistItems: [{ name: 'Contrato assinado', checked: true }],
        due: null,
        latestComment: null,
        members: [],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifyMock = async (input: { pastedText: string }): Promise<RawSuggestion[]> => {
        expect(input.pastedText).toContain('Em Captação 2026');
        expect(input.pastedText).toContain('Contrato assinado');
        return [
          {
            tipo: 'checklist_item',
            valor: 'Briefing Recebido',
            confidence: 0.9,
            evidencia: 'Lista atual no Trello: Em Captação 2026',
          },
        ];
      };
      const classifier: Classifier = { classify: classifyMock };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Sucesso Teste' });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].outcome).toBe('auto_aplicado');
      expect(res.body.trelloCard).toEqual({ name: 'WPP:: Colgate Campanha Teste', listName: 'Em Captação 2026' });
    });
  });

  it('returns 502 when the Trello API call fails', async () => {
    await withTestTransaction(async (db) => {
      const trelloClient = fakeTrelloClient({
        getCard: async () => {
          throw new Error('Trello API error 500');
        },
      });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Sync Erro API Teste' });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      const res = await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      expect(res.status).toBe(502);
    });
  });

  it('auto-assigns an empty role area from the card members, alongside the AI suggestions', async () => {
    await withTestTransaction(async (db) => {
      const cardDetail: TrelloCardDetail = {
        name: 'WPP:: Colgate Campanha Teste',
        listName: 'Em Orçamento 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        // Job novo começa na fase "Comercial e Orçamento", que tem a área "Comercial" —
        // "Anne Something" deve bater com a pessoa "Anne" (área Comercial) já seedada.
        members: ['Anne Something'],
      };
      const trelloClient = fakeTrelloClient({ getCard: async () => cardDetail });
      const classifier: Classifier = { classify: async () => [] };
      const app = buildAppWithDeps(db, { trelloClient, classifier });
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Trello Membro Rota Teste' });
      await agent.post(`/api/jobs/${created.body.job.id}/trello-link`).send({ trelloCardId: 'card1' });

      await agent.post(`/api/jobs/${created.body.job.id}/trello-sync`).send({});

      const jobRes = await agent.get(`/api/jobs/${created.body.job.id}`);
      const comercial = jobRes.body.job.roleAssignments.find((a: { area: string }) => a.area === 'Comercial');
      expect(comercial.personName).toBe('Anne');
    });
  });
});
```

- [ ] **Step 14: Rodar a suíte inteira e o build**

Run: `cd server && npm test`
Expected: todos os testes passam (140 anteriores + 5 de `trelloMatch` + os novos de rota = confira a contagem final no output, todos verdes).

Run: `cd server && npm run build`
Expected: compila sem erro de tipos.

- [ ] **Step 15: Commit**

```bash
git add server/src/models/trelloMatch.ts server/src/models/trelloLink.ts server/src/models/job.ts server/src/app.ts server/src/index.ts server/src/routes/jobs.ts server/.env.example server/test/models.trelloMatch.test.ts server/test/models.trelloLink.test.ts server/test/routes.jobs.test.ts
git commit -m "feat(trello): add card linking, member-to-role sync, and auto-sync-via-AI-classifier endpoints"
```

---

### Task 3: Frontend — vínculo automático e sincronização no JobDetail

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/pages/JobDetail.tsx`
- Modify: `web/src/pages/JobDetail.css`
- Modify: `web/test/JobDetail.test.tsx`

**Interfaces:**
- Consumes: `GET /trello-candidates`, `POST /trello-link`, `POST /trello-sync` (Task 2).
- Produces: nada consumido por task futura (é a última task do plano).

- [ ] **Step 1: Adicionar tipos e métodos ao `web/src/api/client.ts`**

Adicione a `Job` (depois de `triggerLabel: string | null;`):

```typescript
  triggerLabel: string | null;
  trelloCardId: string | null;
```

Adicione depois da interface `ClassifySuggestion`:

```typescript
export interface TrelloCandidate {
  id: string;
  name: string;
  listName: string;
  strongMatch: boolean;
}

export interface TrelloCardSummary {
  name: string;
  listName: string;
}
```

Adicione ao objeto `api`, depois de `classifyJob`:

```typescript
  getTrelloCandidates: (id: number) =>
    request<{ candidates: TrelloCandidate[] }>(`/api/jobs/${id}/trello-candidates`),
  setTrelloLink: (id: number, trelloCardId: string | null) =>
    request<{ job: Job }>(`/api/jobs/${id}/trello-link`, {
      method: 'POST',
      body: JSON.stringify({ trelloCardId }),
    }),
  syncTrello: (id: number) =>
    request<{ suggestions: ClassifySuggestion[]; trelloCard: TrelloCardSummary }>(
      `/api/jobs/${id}/trello-sync`,
      { method: 'POST' },
    ),
```

- [ ] **Step 2: Atualizar o fixture de teste do client**

Em `web/test/api.client.test.ts`, se houver algum fixture de `Job` usado em outros testes que constrói o objeto literal completo (verifique com uma busca por `phaseName:` no arquivo), adicione `trelloCardId: null,` a ele. Se não houver nenhum fixture desse tipo no arquivo (a maioria dos testes de `api.client.test.ts` usa respostas mockadas parciais, não objetos `Job` completos), pule este step.

- [ ] **Step 3: Ligar a busca/vínculo/sincronização automática ao `JobDetail.tsx`**

Em `web/src/pages/JobDetail.tsx`, atualize o import do topo:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  type ClassifySuggestion,
  type JobDetail as JobDetailType,
  type Phase,
  type Person,
  type TrelloCandidate,
  type TrelloCardSummary,
} from '../api/client';
import { phaseColor } from '../theme/phase';
import './JobDetail.css';
```

Dentro do componente, adicione os estados novos (junto aos `useState` já existentes):

```typescript
  const [trelloCandidates, setTrelloCandidates] = useState<TrelloCandidate[] | null>(null);
  const [trelloCard, setTrelloCard] = useState<TrelloCardSummary | null>(null);
  const trelloSyncedRef = useRef(false);
```

Substitua a função `refresh` inteira por:

```typescript
  async function refresh() {
    const [jobRes, referenceRes, peopleRes] = await Promise.all([
      api.getJob(jobId),
      api.getReference(),
      api.listPeople(),
    ]);
    setJob(jobRes.job);
    setPhases(referenceRes.phases);
    setPeople(peopleRes.people);
    setExpandedPhaseId((current) => current ?? jobRes.job.phaseId);

    if (!trelloSyncedRef.current) {
      trelloSyncedRef.current = true;
      void syncOrLinkTrello(jobRes.job);
    }
  }

  async function syncOrLinkTrello(currentJob: JobDetailType) {
    if (currentJob.trelloCardId) {
      try {
        const res = await api.syncTrello(currentJob.id);
        setSuggestions(res.suggestions);
        setTrelloCard(res.trelloCard);
        await refresh();
      } catch {
        // Sincronização automática falhou (Trello não configurado, indisponível, ou IA não
        // configurada) — falha silenciosa é aceitável aqui: é uma tentativa em segundo plano,
        // não uma ação que o usuário pediu diretamente. O painel de colar mensagens do
        // WhatsApp continua disponível como alternativa manual.
      }
      return;
    }

    try {
      const res = await api.getTrelloCandidates(currentJob.id);
      const strongMatches = res.candidates.filter((c) => c.strongMatch);
      if (strongMatches.length === 1) {
        await api.setTrelloLink(currentJob.id, strongMatches[0].id);
        await refresh();
      } else if (res.candidates.length > 0) {
        setTrelloCandidates(res.candidates);
      }
    } catch {
      // Trello não configurado ou indisponível — não mostra nada relacionado a Trello.
    }
  }
```

Substitua o `useEffect` de carregamento inicial por:

```typescript
  useEffect(() => {
    trelloSyncedRef.current = false;
    refresh().catch(() => setError('Não foi possível carregar o job.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
```

Adicione, junto aos outros handlers (por exemplo, depois de `handleAssignRole`):

```typescript
  async function handleLinkTrello(trelloCardId: string) {
    setError(null);
    try {
      await api.setTrelloLink(jobId, trelloCardId);
      setTrelloCandidates(null);
      await refresh();
    } catch {
      setError('Não foi possível vincular o card do Trello.');
    }
  }

  async function handleUnlinkTrello() {
    setError(null);
    try {
      await api.setTrelloLink(jobId, null);
      setTrelloCard(null);
      trelloSyncedRef.current = false;
      await refresh();
    } catch {
      setError('Não foi possível desvincular o card do Trello.');
    }
  }
```

No JSX, adicione o indicador de vínculo logo depois do bloco `{error && (...)}`:

```tsx
        {trelloCard && (
          <p className="job-detail-trello-indicator label-caps">
            Vinculado ao card: {trelloCard.name} ({trelloCard.listName}){' '}
            <button type="button" className="job-detail-link-btn" onClick={() => void handleUnlinkTrello()}>
              desvincular
            </button>
          </p>
        )}

        {trelloCandidates && trelloCandidates.length > 0 && (
          <div className="job-detail-trello-picker">
            <p className="label-caps">Vincular ao card do Trello</p>
            <ul>
              {trelloCandidates.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => void handleLinkTrello(c.id)}>
                    {c.name} <span className="job-detail-trello-list">({c.listName})</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setTrelloCandidates([])}>
              Nenhum desses
            </button>
          </div>
        )}
```

- [ ] **Step 4: Adicionar os estilos novos em `web/src/pages/JobDetail.css`**

Adicione ao final do arquivo:

```css
.job-detail-trello-indicator {
  margin: 0.5rem 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.job-detail-trello-picker {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  margin: 0.75rem 0;
}

.job-detail-trello-picker ul {
  list-style: none;
  margin: 0.5rem 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.job-detail-trello-picker button {
  text-align: left;
}

.job-detail-trello-list {
  color: var(--text-secondary);
  font-size: 0.8rem;
}
```

- [ ] **Step 5: Atualizar `web/test/JobDetail.test.tsx`**

Atualize o bloco `vi.mock('../src/api/client', ...)` pra incluir os 3 métodos novos:

```typescript
vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
      setBolaCom: vi.fn(),
      setLastActivity: vi.fn(),
      classifyJob: vi.fn(),
      getTrelloCandidates: vi.fn(),
      setTrelloLink: vi.fn(),
      syncTrello: vi.fn(),
    },
  };
});
```

Adicione `trelloCardId: null,` ao objeto `jobDetail` (depois de `triggerLabel: 'Avançar para: Briefing Recebido',`).

No `beforeEach`, adicione os resets e o mock padrão (depois de `mockedApi.classifyJob.mockReset();` e depois do bloco de `mockResolvedValue` já existente):

```typescript
    mockedApi.getTrelloCandidates.mockReset();
    mockedApi.setTrelloLink.mockReset();
    mockedApi.syncTrello.mockReset();

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true },
      ],
    });
    mockedApi.getTrelloCandidates.mockResolvedValue({ candidates: [] });
```

(Isso substitui o bloco de `mockResolvedValue` que já existia no `beforeEach` — mantenha só uma cópia de cada linha, a última adicionada é a que fica.)

Adicione os testes novos ao final do arquivo, antes do fechamento do `describe`:

```typescript
  it('auto-links when exactly one strong Trello match is found', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026', strongMatch: true },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });

    renderJobDetail();

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card1'));
  });

  it('shows a picker when multiple Trello candidates are found', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA A', listName: 'Em Captação 2026', strongMatch: false },
        { id: 'card2', name: 'WPP:: COLGATE:: CAMPANHA B', listName: 'Concluído', strongMatch: false },
      ],
    });

    renderJobDetail();

    expect(await screen.findByText('Vincular ao card do Trello')).toBeInTheDocument();
    expect(screen.getByText(/CAMPANHA A/)).toBeInTheDocument();
    expect(screen.getByText(/CAMPANHA B/)).toBeInTheDocument();
  });

  it('links to the chosen card when a picker option is clicked', async () => {
    mockedApi.getTrelloCandidates.mockResolvedValue({
      candidates: [
        { id: 'card1', name: 'WPP:: COLGATE:: CAMPANHA A', listName: 'Em Captação 2026', strongMatch: false },
      ],
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText(/CAMPANHA A/));

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, 'card1'));
  });

  it('syncs automatically and shows the linked card indicator when already linked', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.9,
          evidencia: 'Trello',
          outcome: 'auto_aplicado',
        },
      ],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });

    renderJobDetail();

    await waitFor(() => expect(mockedApi.syncTrello).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Vinculado ao card: WPP:: COLGATE:: CAMPANHA/)).toBeInTheDocument();
  });

  it('unlinks the Trello card when the unlink action is clicked', async () => {
    mockedApi.getJob.mockResolvedValue({ job: { ...jobDetail, trelloCardId: 'card1' } });
    mockedApi.syncTrello.mockResolvedValue({
      suggestions: [],
      trelloCard: { name: 'WPP:: COLGATE:: CAMPANHA', listName: 'Em Captação 2026' },
    });
    mockedApi.setTrelloLink.mockResolvedValue({ job: { ...jobDetail, trelloCardId: null } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByText('desvincular'));

    await waitFor(() => expect(mockedApi.setTrelloLink).toHaveBeenCalledWith(1, null));
  });
```

- [ ] **Step 6: Rodar a suíte inteira e o build**

Run: `cd web && npm test`
Expected: todos os arquivos de teste passam, incluindo os 5 testes novos de `JobDetail.test.tsx`.

Run: `cd web && npx tsc -b`
Expected: zero erros em todo o projeto `web/`.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/client.ts web/src/pages/JobDetail.tsx web/src/pages/JobDetail.css web/test/JobDetail.test.tsx
git commit -m "feat(web): auto-link and auto-sync Trello cards on JobDetail"
```

---

## Encerramento deste plano

Depois da Task 3, abrir um job sem vínculo tenta achar e ligar automaticamente o card certo no Trello (ou mostra um seletor se não tiver certeza), e um job já vinculado sincroniza sozinho a cada abertura: os membros do card preenchem automaticamente áreas de responsabilidade vazias (como Atendimento) por correspondência direta de nome, e o restante do card (lista + checklist + prazo + comentário) alimenta o mesmo classificador de IA que já processa o texto colado do WhatsApp — com as mesmas proteções de confiança e anti-retrocesso, já testadas e revisadas no plano anterior. Falta só configurar `TRELLO_API_KEY`, `TRELLO_TOKEN` e `TRELLO_BOARD_ID` num ambiente real pra ativar de verdade (sem eles, tudo funciona normalmente, só sem a parte do Trello).
