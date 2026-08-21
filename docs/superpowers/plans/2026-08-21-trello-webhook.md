# Webhook do Trello Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Trello avisar o Torre de Controle automaticamente quando um card vinculado muda, em vez de só sincronizar quando alguém abre o job.

**Architecture:** Um endpoint novo (`POST /api/trello-webhook`), sem login, protegido por verificação de assinatura HMAC do Trello, que reaproveita o mesmo pipeline de sincronização já em produção (`getCard` → atribuir responsáveis pelos membros do card → `classifyAndApply`), extraído para uma função compartilhada (`syncJobFromTrello`) usada tanto pela sincronização manual existente quanto pelo webhook novo. A única diferença de comportamento entre os dois caminhos é uma flag (`bypassConfidenceGate`) que remove a faixa de confiança do classificador só para atualizações vindas do webhook.

**Tech Stack:** Node.js/Express/TypeScript (backend já existente), `crypto` nativo do Node para HMAC-SHA1, Vitest + Supertest (testes já existentes no projeto).

**Spec:** `docs/superpowers/specs/2026-08-21-trello-webhook-design.md`

## Global Constraints

- O webhook só afeta jobs já vinculados a um card (`jobs.trello_card_id` preenchido) — não tenta descobrir/vincular jobs novos.
- O bypass da faixa de confiança (`bypassConfidenceGate: true`) vale **só** para o caminho do webhook. A sincronização manual (`POST /:id/trello-sync`, disparada ao abrir o job) continua chamando `classifyAndApply` com `bypassConfidenceGate: false` (85%/60% de hoje, sem mudança).
- Mesmo com `bypassConfidenceGate: true`, duas travas continuam valendo sempre: nunca aplicar uma sugestão que retroceda a fase do job, e nunca reescrever um status/lado que o job já está (evita duplicar histórico).
- Toda chamada ao endpoint precisa vir assinada pelo Trello (`X-Trello-Webhook` = `base64(HMAC-SHA1(TRELLO_API_SECRET, corpo_bruto + TRELLO_WEBHOOK_CALLBACK_URL))`). Assinatura ausente ou inválida → `401`, nada é processado.
- Fora isso, o endpoint sempre responde `200` para qualquer evento que processe (mesmo sem achar job, mesmo se a IA não estiver configurada) — nunca deixa o Trello acumular respostas de erro e desativar o webhook. Erros são só registrados no log do servidor.
- Cinco variáveis de ambiente juntas controlam se o Trello está configurado: `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_BOARD_ID` (já existentes) e as duas novas, `TRELLO_API_SECRET` e `TRELLO_WEBHOOK_CALLBACK_URL`. Faltando qualquer uma, o endpoint responde `200` sem processar (mesmo padrão de degradação silenciosa já usado no resto da integração Trello).
- Registrar o webhook no Trello (`POST https://api.trello.com/1/webhooks`) é um passo manual, feito uma vez depois do deploy — não é uma task deste plano (ver seção final).

---

### Task 1: `getJobByTrelloCardId`

**Files:**
- Modify: `server/src/models/job.ts` (adicionar depois de `getJobById`, hoje nas linhas 127-133)
- Test: `server/test/models.job.test.ts`

**Interfaces:**
- Consumes: `JOB_SELECT`, `rowToJob`, `JobRow` (já existentes em `job.ts`, não exportados — usados internamente).
- Produces: `getJobByTrelloCardId(db: AppDatabase, trelloCardId: string): Promise<Job | null>`, exportada de `server/src/models/job.ts`. Tarefas seguintes (Task 4) vão importar essa função.

- [ ] **Step 1: Escrever os testes que falham**

Abra `server/test/models.job.test.ts`. Na linha 2, o import atual é:

```ts
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus, setAtendimento } from '../src/models/job';
```

Troque por:

```ts
import {
  createJob,
  listJobs,
  getJobById,
  getJobByTrelloCardId,
  advanceJobStatus,
  setJobStatus,
  setAtendimento,
} from '../src/models/job';
```

Dentro do `describe('job model', ...)` já existente, adicione estes dois testes (em qualquer ponto do bloco, por exemplo logo depois do primeiro teste):

```ts
  it('finds a job by its linked Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Busca Por Trello Card Teste' });
      await db.query('UPDATE jobs SET trello_card_id = $1 WHERE id = $2', ['card-xyz', job.id]);

      const found = await getJobByTrelloCardId(db, 'card-xyz');

      expect(found?.id).toBe(job.id);
    });
  });

  it('returns null when no job has the given Trello card id', async () => {
    await withTestTransaction(async (db) => {
      const found = await getJobByTrelloCardId(db, 'card-inexistente');

      expect(found).toBeNull();
    });
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd server && npx vitest run test/models.job.test.ts`
Expected: FAIL — `getJobByTrelloCardId` não existe (`TypeError` ou erro de import/compilação).

- [ ] **Step 3: Implementar `getJobByTrelloCardId`**

Em `server/src/models/job.ts`, logo depois da função `getJobById` (que termina assim):

```ts
export async function getJobById(db: AppDatabase, id: number): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}
```

adicione:

```ts
export async function getJobByTrelloCardId(db: AppDatabase, trelloCardId: string): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.trello_card_id = $1`, [trelloCardId]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd server && npx vitest run test/models.job.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo os dois novos).

- [ ] **Step 5: Commit**

```bash
git add server/src/models/job.ts server/test/models.job.test.ts
git commit -m "feat(server): add getJobByTrelloCardId lookup"
```

---

### Task 2: Bypass da faixa de confiança em `classifyAndApply`

**Files:**
- Modify: `server/src/models/classification.ts` (arquivo inteiro tem 167 linhas hoje)
- Test: `server/test/models.classification.test.ts`

**Interfaces:**
- Consumes: nada novo — usa os mesmos tipos já existentes em `classification.ts` (`Classifier`, `RawSuggestion`, `ResolvedSuggestion`, `Status`, `BolaCom`).
- Produces: `classifyAndApply(db, classifier, jobId, pastedText, options?: { bypassConfidenceGate?: boolean }): Promise<ResolvedSuggestion[]>` — assinatura estendida de forma retrocompatível (todo código que já chama `classifyAndApply` com 4 argumentos continua funcionando idêntico, porque `options` tem default `{}` e `bypassConfidenceGate` é opcional). Task 3 vai passar essa opção explicitamente.

- [ ] **Step 1: Escrever os testes que falham**

No fim de `server/test/models.classification.test.ts`, logo antes do `});` que fecha o `describe('classifyAndApply', ...)` (linha 285 hoje), adicione um novo `describe` com estes 4 testes:

```ts
describe('classifyAndApply with bypassConfidenceGate', () => {
  it('auto-applies a mid-confidence suggestion that would otherwise be pending', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bypass Confiança Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'Atualização automática vinda do Trello',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto qualquer', {
        bypassConfidenceGate: true,
      });

      expect(resolved[0].outcome).toBe('auto_aplicado');
    });
  });

  it('still discards a suggestion with malformed confidence, even with bypassConfidenceGate', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bypass Confiança Malformada Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: '0.9' as unknown as number,
          evidencia: 'texto',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto qualquer', {
        bypassConfidenceGate: true,
      });

      expect(resolved[0].outcome).toBe('descartado');
    });
  });

  it('still never auto-applies a phase regression, even with bypassConfidenceGate', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bypass Confiança Retrocesso Teste' });

      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Orçamento e Decupagem'`,
      );
      await db.query('UPDATE jobs SET status_id = $1 WHERE id = $2', [targetStatus.rows[0].id, job.id]);

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.95,
          evidencia: 'Card do Trello movido de volta por engano',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto qualquer', {
        bypassConfidenceGate: true,
      });

      expect(resolved[0].outcome).toBe('pendente');

      const updated = await db.query<{ status_id: number }>('SELECT status_id FROM jobs WHERE id = $1', [job.id]);
      expect(updated.rows[0].status_id).toBe(targetStatus.rows[0].id);
    });
  });

  it('still discards a bypassed suggestion that only re-confirms the current status, without a no-op history row', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Bypass Confiança Reconfirma Teste' });

      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: job.statusName!,
          confidence: 0.95,
          evidencia: 'confirma que já estava feito',
        },
      ]);

      const resolved = await classifyAndApply(db, classifier, job.id, 'texto qualquer', {
        bypassConfidenceGate: true,
      });

      expect(resolved[0].outcome).toBe('descartado');

      const history = await db.query<{ count: string }>(
        'SELECT count(*) FROM job_status_history WHERE job_id = $1',
        [job.id],
      );
      expect(Number(history.rows[0].count)).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd server && npx vitest run test/models.classification.test.ts`
Expected: FAIL — o quarto argumento `options` não é aceito pela assinatura atual de `classifyAndApply` (erro de tipo/compilação do TypeScript via `tsx`/`vitest`).

- [ ] **Step 3: Implementar o bypass**

Em `server/src/models/classification.ts`, a função `classifyAndApply` (linhas 16-80 hoje) e `resolveAndApply` (linhas 107-166 hoje) mudam assim. Primeiro, a assinatura e o corpo de `classifyAndApply`:

```ts
export async function classifyAndApply(
  db: AppDatabase,
  classifier: Classifier,
  jobId: number,
  pastedText: string,
  options: { bypassConfidenceGate?: boolean } = {},
): Promise<ResolvedSuggestion[]> {
  const job = await getJobById(db, jobId);
  if (!job || !job.phaseId) {
    throw new Error('Job not found or has no current phase');
  }

  const phases = await listPhasesWithStatuses(db);
  const phase = phases.find((p) => p.id === job.phaseId);
  if (!phase) {
    throw new Error('Job phase not found in reference data');
  }

  const currentStatus = phase.statuses.find((s) => s.id === job.statusId);
  const startingOrder = currentStatus?.order ?? 0;

  const checklist = phase.statuses.map((status) => ({
    name: status.name,
    done: status.order <= startingOrder,
  }));

  const raw = await classifier.classify({
    jobName: job.name,
    phaseName: phase.name,
    checklist,
    bolaCom: job.bolaCom,
    pastedText,
  });

  let trackedOrder = startingOrder;
  let trackedSide: BolaCom = job.bolaCom;
  const bypassConfidenceGate = options.bypassConfidenceGate ?? false;

  const resolved: ResolvedSuggestion[] = [];
  for (const suggestion of raw) {
    const { outcome, appliedOrder, appliedSide } = await resolveAndApply(
      db,
      jobId,
      phase.statuses,
      trackedOrder,
      trackedSide,
      suggestion,
      bypassConfidenceGate,
    );
    if (appliedOrder !== undefined) {
      trackedOrder = appliedOrder;
    }
    if (appliedSide !== undefined) {
      trackedSide = appliedSide;
    }
    resolved.push({ ...suggestion, outcome });
  }

  return resolved;
}
```

(O comentário grande sobre `trackedOrder`/`trackedSide` que já existe antes desse bloco continua exatamente igual — não mexa nele, só na assinatura e no corpo da função acima dele.)

Agora `resolveAndApply` ganha um parâmetro novo no fim, e usa ele em dois pontos:

```ts
async function resolveAndApply(
  db: AppDatabase,
  jobId: number,
  statuses: Status[],
  currentOrder: number,
  currentSide: BolaCom,
  suggestion: RawSuggestion,
  bypassConfidenceGate: boolean,
): Promise<ResolveResult> {
  if (!isValidRawSuggestion(suggestion)) {
    return { outcome: 'descartado' };
  }

  if (!bypassConfidenceGate && suggestion.confidence < SUGGEST_THRESHOLD) {
    return { outcome: 'descartado' };
  }

  if (suggestion.tipo === 'checklist_item') {
    const target = statuses.find((s) => s.name === suggestion.valor);
    if (!target) {
      return { outcome: 'descartado' };
    }

    if (target.order === currentOrder) {
      // Re-confirming the milestone the job is already on: nothing changed,
      // so there is nothing to write. Writing anyway would insert a fresh
      // job_status_history row and silently reset the alert-level clock for
      // a job that may have been stuck at this status for days.
      return { outcome: 'descartado' };
    }

    const isRegression = target.order < currentOrder;
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    const meetsConfidence = bypassConfidenceGate || suggestion.confidence >= AUTO_APPLY_THRESHOLD;

    if (meetsConfidence && !isRegression) {
      await setJobStatus(db, jobId, target.id, evidenceNote);
      return { outcome: 'auto_aplicado', appliedOrder: target.order };
    }

    return { outcome: 'pendente' };
  }

  if (suggestion.valor !== 'ilha' && suggestion.valor !== 'cliente') {
    return { outcome: 'descartado' };
  }

  if (suggestion.valor === currentSide) {
    // Re-confirming the side the ball is already with: nothing changed, so
    // there is nothing to write. Writing anyway would insert a fresh
    // job_bola_com_history row and silently zero an in-progress streak.
    return { outcome: 'descartado' };
  }

  const meetsConfidence = bypassConfidenceGate || suggestion.confidence >= AUTO_APPLY_THRESHOLD;
  if (meetsConfidence) {
    const evidenceNote = `IA (${suggestion.confidence.toFixed(2)}): ${suggestion.evidencia}`;
    await setBolaCom(db, jobId, suggestion.valor, evidenceNote);
    return { outcome: 'auto_aplicado', appliedSide: suggestion.valor };
  }

  return { outcome: 'pendente' };
}
```

`isValidRawSuggestion` não muda — a validação estrutural (confiança precisa ser um número finito) continua valendo sempre, com ou sem bypass, porque não é sobre política de confiança, é sobre a sugestão ser utilizável.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd server && npx vitest run test/models.classification.test.ts`
Expected: PASS (todos os testes do arquivo — os 10 já existentes e os 4 novos).

- [ ] **Step 5: Commit**

```bash
git add server/src/models/classification.ts server/test/models.classification.test.ts
git commit -m "feat(server): add bypassConfidenceGate option to classifyAndApply"
```

---

### Task 3: Função compartilhada `syncJobFromTrello`

**Files:**
- Modify: `server/src/models/trelloLink.ts` (arquivo inteiro tem 107 linhas hoje)
- Modify: `server/src/routes/jobs.ts:1-21` (imports) e `:433-484` (rota `/:id/trello-sync`)
- Test: `server/test/models.trelloLink.test.ts`

**Interfaces:**
- Consumes: `classifyAndApply(db, classifier, jobId, pastedText, options?: { bypassConfidenceGate?: boolean })` (Task 2), `buildTrelloEvidenceText(card: TrelloCardDetail): string` (já existe em `server/src/models/trelloMatch.ts`), `Job` (tipo já existente em `server/src/models/job.ts`).
- Produces: `syncJobFromTrello(db: AppDatabase, trelloClient: TrelloClient, classifier: Classifier, job: Job, options: { bypassConfidenceGate: boolean }): Promise<TrelloSyncResult>`, onde `TrelloSyncResult = { status: 'synced'; suggestions: ResolvedSuggestion[]; trelloCard: { name: string; listName: string } } | { status: 'card_not_found' }`, exportada de `server/src/models/trelloLink.ts`. Task 4 vai importar `syncJobFromTrello` e `TrelloSyncResult`.

- [ ] **Step 1: Escrever os testes que falham**

No fim de `server/test/models.trelloLink.test.ts`, depois do `describe('syncTrelloMembersToAtendimento', ...)` (termina na linha 167 hoje), adicione:

No topo do arquivo, o import atual (linha 1-5) é:

```ts
import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import { setTrelloLink, syncTrelloMembersToRoles, syncTrelloMembersToAtendimento } from '../src/models/trelloLink';
import { getJobRoleAssignments, setJobRoleAssignment } from '../src/models/jobRoleAssignments';
import { withTestTransaction } from './helpers/testDb';
```

Troque por:

```ts
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
```

E adicione este novo `describe` no fim do arquivo:

```ts
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
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd server && npx vitest run test/models.trelloLink.test.ts`
Expected: FAIL — `syncJobFromTrello` não existe ainda em `trelloLink.ts`.

- [ ] **Step 3: Implementar `syncJobFromTrello` em `trelloLink.ts`**

No topo de `server/src/models/trelloLink.ts`, o import atual (linhas 1-4) é:

```ts
import type { AppDatabase } from '../db';
import { listPeople, type Person } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';
import { setAtendimento } from './job';
```

Troque por:

```ts
import type { AppDatabase } from '../db';
import { listPeople, type Person } from './people';
import { getJobRoleAssignments, setJobRoleAssignment } from './jobRoleAssignments';
import { setAtendimento, type Job } from './job';
import { classifyAndApply, type ResolvedSuggestion } from './classification';
import { buildTrelloEvidenceText } from './trelloMatch';
import type { Classifier } from '../services/classifier';
import type { TrelloClient } from '../services/trello';
```

No fim do arquivo (depois de `syncTrelloMembersToAtendimento`, que hoje termina na linha 107), adicione:

```ts
export type TrelloSyncResult =
  | { status: 'synced'; suggestions: ResolvedSuggestion[]; trelloCard: { name: string; listName: string } }
  | { status: 'card_not_found' };

/**
 * Shared by both the manual "open the job" sync (POST /:id/trello-sync,
 * bypassConfidenceGate: false) and the Trello webhook (POST
 * /api/trello-webhook, bypassConfidenceGate: true) — the only difference
 * between the two triggers is whether classifyAndApply's confidence gate
 * applies. See docs/superpowers/specs/2026-08-21-trello-webhook-design.md.
 */
export async function syncJobFromTrello(
  db: AppDatabase,
  trelloClient: TrelloClient,
  classifier: Classifier,
  job: Job,
  options: { bypassConfidenceGate: boolean },
): Promise<TrelloSyncResult> {
  if (!job.trelloCardId) {
    throw new Error('job is not linked to a Trello card');
  }

  const card = await trelloClient.getCard(job.trelloCardId);
  if (!card) {
    await setTrelloLink(db, job.id, null);
    return { status: 'card_not_found' };
  }

  if (job.phaseId) {
    await syncTrelloMembersToRoles(db, job.id, job.phaseId, card.members);
  }
  await syncTrelloMembersToAtendimento(db, job.id, job.atendimentoPersonId, card.members);

  const evidenceText = buildTrelloEvidenceText(card);
  const suggestions = await classifyAndApply(db, classifier, job.id, evidenceText, {
    bypassConfidenceGate: options.bypassConfidenceGate,
  });

  return { status: 'synced', suggestions, trelloCard: { name: card.name, listName: card.listName } };
}
```

- [ ] **Step 4: Rodar os testes de `trelloLink` e confirmar que passam**

Run: `cd server && npx vitest run test/models.trelloLink.test.ts`
Expected: PASS (todos — os já existentes e os 4 novos de `syncJobFromTrello`).

- [ ] **Step 5: Refatorar a rota `/:id/trello-sync` para usar `syncJobFromTrello`**

Em `server/src/routes/jobs.ts`, o import atual (linhas 16-17) é:

```ts
import { findTrelloCandidates, buildTrelloEvidenceText } from '../models/trelloMatch';
import { setTrelloLink, syncTrelloMembersToRoles, syncTrelloMembersToAtendimento } from '../models/trelloLink';
```

Troque por:

```ts
import { findTrelloCandidates } from '../models/trelloMatch';
import { setTrelloLink, syncJobFromTrello } from '../models/trelloLink';
```

(`classifyAndApply` continua importado normalmente — a rota `/:id/classify`, linha 367, ainda usa ele diretamente.)

A rota `POST /:id/trello-sync` inteira (linhas 433-484 hoje) vira:

```ts
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

      let result;
      try {
        result = await syncJobFromTrello(deps.db, deps.trelloClient, deps.classifier, job, {
          bypassConfidenceGate: false,
        });
      } catch {
        res.status(502).json({ error: 'trello_api_error' });
        return;
      }

      if (result.status === 'card_not_found') {
        res.status(404).json({ error: 'trello_card_not_found' });
        return;
      }

      res.json({ suggestions: result.suggestions, trelloCard: result.trelloCard });
    }),
  );
```

- [ ] **Step 6: Rodar a suíte inteira do servidor e confirmar que nada quebrou**

Run: `cd server && npm test`
Expected: PASS em tudo, incluindo os testes já existentes de `POST /api/jobs/:id/trello-sync` em `routes.jobs.test.ts` (esses testes não mudam — a rota continua respondendo os mesmos status e o mesmo formato de resposta de antes, só que por dentro chama `syncJobFromTrello`). O único teste que pode falhar sem relação com esta task é `models.bolaCom.test.ts` (`currentStreakDays` por diferença de relógio de 1ms) — é uma falha instável já conhecida e sem relação com Trello; se só ela falhar, está tudo certo.

- [ ] **Step 7: Commit**

```bash
git add server/src/models/trelloLink.ts server/src/routes/jobs.ts server/test/models.trelloLink.test.ts
git commit -m "refactor(server): extract syncJobFromTrello shared by manual sync and future webhook"
```

---

### Task 4: Endpoint `POST /api/trello-webhook`

**Files:**
- Create: `server/src/types/express.d.ts`
- Create: `server/src/routes/trelloWebhook.ts`
- Modify: `server/src/app.ts` (arquivo inteiro tem 44 linhas hoje)
- Modify: `server/src/createAppFromEnv.ts` (arquivo inteiro tem 45 linhas hoje)
- Test: `server/test/routes.trelloWebhook.test.ts`

**Interfaces:**
- Consumes: `getJobByTrelloCardId(db, trelloCardId)` (Task 1), `syncJobFromTrello(db, trelloClient, classifier, job, options)` (Task 3).
- Produces: `POST /api/trello-webhook` e `HEAD /api/trello-webhook` (endpoints HTTP, sem autenticação de usuário); `createTrelloWebhookRouter(deps: TrelloWebhookRouterDeps): Router`, exportada de `server/src/routes/trelloWebhook.ts`; `AppDeps.trelloWebhookSecret?: string` e `AppDeps.trelloWebhookCallbackUrl?: string` em `server/src/app.ts`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `server/test/routes.trelloWebhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { Classifier, RawSuggestion } from '../src/services/classifier';
import type { TrelloClient, TrelloCardDetail } from '../src/services/trello';
import { createJob, getJobById } from '../src/models/job';
import { setTrelloLink } from '../src/models/trelloLink';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';
const WEBHOOK_SECRET = 'webhook-secret-teste';
const WEBHOOK_CALLBACK_URL = 'https://exemplo.test/api/trello-webhook';

async function getAtendimentoPersonId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT id FROM people WHERE name = 'Wilka' AND area = 'Atendimento'`,
  );
  return result.rows[0].id;
}

function fakeTrelloClient(overrides: Partial<TrelloClient> = {}): TrelloClient {
  return {
    listBoardCards: async () => [],
    getCard: async () => null,
    ...overrides,
  };
}

function fakeClassifier(suggestions: RawSuggestion[]): Classifier {
  return {
    classify: async () => suggestions,
  };
}

function buildApp(
  db: AppDatabase,
  extra: {
    classifier?: Classifier;
    trelloClient?: TrelloClient;
    trelloWebhookSecret?: string;
    trelloWebhookCallbackUrl?: string;
  } = {},
) {
  return createApp({
    db,
    verifyIdToken: async () => ({ sub: 'google-sub-1', email: 'wilka@ilhacrossmidia.com.br', name: 'Wilka' }),
    jwtSecret: JWT_SECRET,
    allowedDomain: ALLOWED_DOMAIN,
    frontendUrl: FRONTEND_URL,
    ...extra,
  });
}

function sign(payload: unknown, secret: string, callbackUrl: string): string {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return crypto
    .createHmac('sha1', secret)
    .update(Buffer.concat([rawBody, Buffer.from(callbackUrl)]))
    .digest('base64');
}

describe('HEAD /api/trello-webhook', () => {
  it('responds 200 with no processing (Trello liveness check)', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).head('/api/trello-webhook');
      expect(res.status).toBe(200);
    });
  });
});

describe('POST /api/trello-webhook', () => {
  it('responds 200 without processing when Trello webhook credentials are not fully configured', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app)
        .post('/api/trello-webhook')
        .send({ action: { data: { card: { id: 'card1' } } } });

      expect(res.status).toBe(200);
    });
  });

  it('rejects a request with an invalid signature', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', 'assinatura-forjada')
        .send({ action: { data: { card: { id: 'card1' } } } });

      expect(res.status).toBe(401);
    });
  });

  it('accepts a validly signed request with no card in the payload and does nothing', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { type: 'addMemberToBoard', data: {} } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  it('accepts a validly signed request for a card not linked to any job and does nothing', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient(),
        classifier: fakeClassifier([]),
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card-sem-job' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);
    });
  });

  it('syncs the linked job and applies a suggestion the manual sync would have left pending', async () => {
    await withTestTransaction(async (db) => {
      const atendimentoPersonId = await getAtendimentoPersonId(db);
      const job = await createJob(db, { name: 'Job Webhook Trello Teste', atendimentoPersonId });
      await setTrelloLink(db, job.id, 'card1');

      const cardDetail: TrelloCardDetail = {
        name: 'Job Webhook Trello Teste',
        listName: 'Em Captação 2026',
        checklistItems: [],
        due: null,
        latestComment: null,
        members: [],
      };
      // Confiança 0.7 ficaria "pendente" no fluxo manual (limiar de 85% pra
      // auto-aplicar) — prova que o webhook aplica mesmo sem confiança alta.
      const classifier = fakeClassifier([
        {
          tipo: 'checklist_item',
          valor: 'Briefing Recebido',
          confidence: 0.7,
          evidencia: 'Atualização vinda do card do Trello',
        },
      ]);
      const app = buildApp(db, {
        trelloClient: fakeTrelloClient({ getCard: async () => cardDetail }),
        classifier,
        trelloWebhookSecret: WEBHOOK_SECRET,
        trelloWebhookCallbackUrl: WEBHOOK_CALLBACK_URL,
      });
      const payload = { action: { data: { card: { id: 'card1' } } } };

      const res = await request(app)
        .post('/api/trello-webhook')
        .set('x-trello-webhook', sign(payload, WEBHOOK_SECRET, WEBHOOK_CALLBACK_URL))
        .send(payload);

      expect(res.status).toBe(200);

      const updated = await getJobById(db, job.id);
      expect(updated?.statusName).toBe('Briefing Recebido');
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd server && npx vitest run test/routes.trelloWebhook.test.ts`
Expected: FAIL — `/api/trello-webhook` ainda não existe (404 em todas as chamadas), e `AppDeps` ainda não aceita `trelloWebhookSecret`/`trelloWebhookCallbackUrl` (erro de tipo).

- [ ] **Step 3: Criar o arquivo de tipos para o corpo bruto da requisição**

Crie `server/src/types/express.d.ts`:

```ts
import 'http';

// express.Request extends http.IncomingMessage, so augmenting IncomingMessage
// here is inherited by both express.json()'s `verify` callback (which types
// req as bare http.IncomingMessage) and by express.Request in route handlers.
// Augmenting express-serve-static-core.Request directly does NOT work — the
// verify callback's req type is never Request, only IncomingMessage.
declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}
```

- [ ] **Step 4: Criar a rota do webhook**

Crie `server/src/routes/trelloWebhook.ts`:

```ts
import { Router } from 'express';
import crypto from 'crypto';
import type { AppDatabase } from '../db';
import { getJobByTrelloCardId } from '../models/job';
import { syncJobFromTrello } from '../models/trelloLink';
import type { Classifier } from '../services/classifier';
import type { TrelloClient } from '../services/trello';
import { asyncHandler } from '../utils/asyncHandler';

export interface TrelloWebhookRouterDeps {
  db: AppDatabase;
  classifier?: Classifier;
  trelloClient?: TrelloClient;
  trelloWebhookSecret?: string;
  trelloWebhookCallbackUrl?: string;
}

interface TrelloWebhookPayload {
  action?: {
    data?: {
      card?: {
        id?: string;
      };
    };
  };
}

function isValidTrelloSignature(
  rawBody: Buffer,
  headerSignature: string | undefined,
  secret: string,
  callbackUrl: string,
): boolean {
  if (!headerSignature) {
    return false;
  }

  const computed = crypto
    .createHmac('sha1', secret)
    .update(Buffer.concat([rawBody, Buffer.from(callbackUrl)]))
    .digest('base64');

  const computedBuf = Buffer.from(computed);
  const headerBuf = Buffer.from(headerSignature);
  if (computedBuf.length !== headerBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(computedBuf, headerBuf);
}

/**
 * No user auth here — the Trello webhook is not a logged-in user. Security
 * comes entirely from the HMAC signature check below. Always responds 200
 * for anything it processes (even "nothing to do" cases) so Trello never
 * sees enough consecutive failures to disable the webhook; 401 is reserved
 * for a signature that doesn't verify. See
 * docs/superpowers/specs/2026-08-21-trello-webhook-design.md.
 */
export function createTrelloWebhookRouter(deps: TrelloWebhookRouterDeps): Router {
  const router = Router();

  router.head('/', (_req, res) => {
    res.status(200).end();
  });

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (
        !deps.trelloClient ||
        !deps.classifier ||
        !deps.trelloWebhookSecret ||
        !deps.trelloWebhookCallbackUrl
      ) {
        res.status(200).json({ ok: true });
        return;
      }

      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
      const signature = req.header('x-trello-webhook');

      if (!isValidTrelloSignature(rawBody, signature, deps.trelloWebhookSecret, deps.trelloWebhookCallbackUrl)) {
        res.status(401).json({ error: 'invalid_signature' });
        return;
      }

      const payload = req.body as TrelloWebhookPayload;
      const cardId = payload.action?.data?.card?.id;
      if (!cardId) {
        res.status(200).json({ ok: true });
        return;
      }

      const job = await getJobByTrelloCardId(deps.db, cardId);
      if (!job) {
        res.status(200).json({ ok: true });
        return;
      }

      try {
        await syncJobFromTrello(deps.db, deps.trelloClient, deps.classifier, job, {
          bypassConfidenceGate: true,
        });
      } catch (err) {
        console.error('trello webhook sync failed', err);
      }

      res.status(200).json({ ok: true });
    }),
  );

  return router;
}
```

- [ ] **Step 5: Ligar a rota em `app.ts`**

Substitua o conteúdo inteiro de `server/src/app.ts` por:

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';
import { createReferenceRouter } from './routes/reference';
import { createUsersRouter } from './routes/users';
import { createTrelloWebhookRouter } from './routes/trelloWebhook';
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
  trelloWebhookSecret?: string;
  trelloWebhookCallbackUrl?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.frontendUrl, credentials: true }));
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/trello-webhook', createTrelloWebhookRouter(deps));
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/jobs', createJobsRouter(deps));
  app.use('/api', createReferenceRouter(deps));
  app.use('/api/users', createUsersRouter(deps));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
```

- [ ] **Step 6: Ler as duas variáveis de ambiente novas em `createAppFromEnv.ts`**

Substitua o conteúdo inteiro de `server/src/createAppFromEnv.ts` por:

```ts
import 'dotenv/config';
import { createApp } from './app';
import { createDb } from './db';
import { createGoogleVerifier } from './auth/googleVerifier';
import { createAnthropicClassifier } from './services/classifier';
import { createHttpTrelloClient } from './services/trello';
import type { Express } from 'express';

export async function createAppFromEnv(): Promise<Express> {
  const connectionString = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN ?? 'ilhacrossmidia.com.br';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const trelloApiKey = process.env.TRELLO_API_KEY;
  const trelloToken = process.env.TRELLO_TOKEN;
  const trelloBoardId = process.env.TRELLO_BOARD_ID;
  const trelloWebhookSecret = process.env.TRELLO_API_SECRET;
  const trelloWebhookCallbackUrl = process.env.TRELLO_WEBHOOK_CALLBACK_URL;
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

  const db = await createDb(connectionString);

  return createApp({
    db,
    verifyIdToken: createGoogleVerifier(googleClientId),
    jwtSecret,
    allowedDomain,
    frontendUrl,
    classifier: anthropicApiKey ? createAnthropicClassifier(anthropicApiKey) : undefined,
    trelloClient: trelloConfigured
      ? createHttpTrelloClient(trelloApiKey!, trelloToken!, trelloBoardId!)
      : undefined,
    trelloWebhookSecret,
    trelloWebhookCallbackUrl,
  });
}
```

- [ ] **Step 7: Rodar os testes do webhook e confirmar que passam**

Run: `cd server && npx vitest run test/routes.trelloWebhook.test.ts`
Expected: PASS em todos os 6 testes.

- [ ] **Step 8: Rodar a suíte inteira e o build de TypeScript**

Run: `cd server && npm test`
Expected: PASS em tudo, com a mesma exceção já conhecida de `models.bolaCom.test.ts` (falha instável de relógio, sem relação com este plano).

Run: `cd server && npm run build`
Expected: build limpo, sem erros de tipo — confirma que a augmentação de `req.rawBody` em `express.d.ts` compila corretamente contra o `express.json({ verify })` em `app.ts`.

- [ ] **Step 9: Commit**

```bash
git add server/src/types/express.d.ts server/src/routes/trelloWebhook.ts server/src/app.ts server/src/createAppFromEnv.ts server/test/routes.trelloWebhook.test.ts
git commit -m "feat(server): add signed Trello webhook endpoint for automatic sync"
```

---

## Passo manual pós-merge (fora do escopo das tasks acima)

Depois que este plano estiver mergeado e o deploy em produção estiver no ar:

1. Pegar o **Secret** na mesma tela do Trello Power-Ups onde a `TRELLO_API_KEY` foi gerada (não é o `TRELLO_TOKEN`).
2. Configurar no Vercel (mesmo processo já usado para as outras variáveis do Trello):
   - `TRELLO_API_SECRET` = o Secret do passo 1.
   - `TRELLO_WEBHOOK_CALLBACK_URL` = `https://torre-de-controle-teal.vercel.app/api/trello-webhook` (ou o domínio de produção atual).
3. Redeploy (git push, nunca `vercel deploy` local, pelo mesmo motivo já registrado no plano de Deploy Online — evita vazar `.env` local).
4. Registrar o webhook no Trello com uma chamada única (feita por mim, com `curl`, usando a `TRELLO_API_KEY`/`TRELLO_TOKEN`/`TRELLO_API_SECRET` já configurados):

   ```bash
   curl -X POST "https://api.trello.com/1/webhooks" \
     -d key="$TRELLO_API_KEY" \
     -d token="$TRELLO_TOKEN" \
     -d callbackURL="https://torre-de-controle-teal.vercel.app/api/trello-webhook" \
     -d idModel="$TRELLO_BOARD_ID" \
     -d description="Torre de Controle - sincronização automática"
   ```

   O Trello confere a `callbackURL` com um `HEAD` antes de aceitar — por isso o deploy do passo 3 precisa estar no ar antes desse comando. Uma vez aceito, o webhook fica registrado do lado do Trello indefinidamente; não precisa repetir esse passo em deploys futuros, a não ser que a URL de produção mude.
5. Testar: mover um card vinculado a um job entre listas no Trello e conferir, no próprio Torre de Controle, que o job atualizou sozinho, sem ninguém abrir a página dele.
