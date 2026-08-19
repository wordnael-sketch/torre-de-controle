# Kanban de Fases e Responsáveis (Módulo 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simplified flat job list with a Kanban of 6 fixed phases and ~25
statuses, where every status has a named responsible role, advancement is a manual
action recorded by the Gerente (not derived from Trello), and every status change is
recorded in a permanent history that later powers the alert "farol" and (in a future
plan) the Executive Dashboard.

**Architecture:** Extends the existing `server`/`web` foundation (Plan 1) in place — no
new services. The 6 phases and ~25 statuses are a fixed, seeded reference dataset (not
user-editable in this MVP). Job status advancement writes to a `job_status_history`
table on every change; the alert farol and the board's grouped view are both derived
from that history plus the fixed pipeline, computed at read time (no separate
materialized state beyond `jobs.status_id`).

**Tech Stack:** Same as Plan 1 — Node.js/Express/TypeScript + PostgreSQL (Supabase) on
the backend, React/Vite/TypeScript on the frontend, vitest+supertest for backend tests
(against the real Supabase project via `withTestTransaction`), vitest+Testing Library
for frontend tests.

**Spec:** `docs/superpowers/specs/2026-08-19-kanban-fases-jobs-design.md`

## Global Constraints

- Backend: async/Promise-based DB access only, via the existing `AppDatabase` interface
  (`{ query<T>(text, params?): Promise<QueryResult<T>> }`) — never synchronous calls.
  Postgres placeholders are `$1`, `$2`, ... — never `?`.
- All new route handlers that touch the database MUST be wrapped in the existing
  `asyncHandler` from `server/src/utils/asyncHandler.ts` (an unhandled rejection
  previously crashed the whole process — this is now guarded, keep it that way).
- Tests run against the REAL shared Supabase Postgres project (no mocks, no Docker) via
  `withTestTransaction` from `server/test/helpers/testDb.ts` (`BEGIN`/`ROLLBACK`
  isolation). Because the shared tables (`jobs`, `people`, etc.) can hold real rows
  outside any single test's transaction, list/aggregate assertions must check
  presence/relative-order, never absolute counts or exact-length arrays — except for the
  fixed reference tables (`phases`, `statuses`, `phase_roles`), which are seeded once via
  `schema.sql` with a known, exact, permanent content — tests against those tables MAY
  assert exact counts/content, since that data is a fixed part of the schema, not
  user-generated.
- `jobs.status_id` is nullable at the schema level (no `NOT NULL` constraint) — this
  system has no real production data yet, so there is no backfill migration to write.
  `createJob` always sets it explicitly at insert time; never leave it unset in new code.
- Timestamps from Postgres (`TIMESTAMPTZ` columns) come back as `Date` objects or
  strings depending on codepath — always normalize via `new Date(x).toISOString()`
  before returning from a model function, matching the existing `Job`/`User` pattern.
- Frontend: the API client (`web/src/api/client.ts`) is the single chokepoint for
  `fetch` — always `credentials: 'include'`, always throws `ApiError` on non-2xx.
  New frontend pages that render lists whose data ultimately comes from the shared
  `people`/`jobs` tables must not assume the list is empty in any test — mock the API
  responses explicitly per test case, exactly as `Dashboard.test.tsx` already does.

---

## Task 1: Schema — pipeline fixo de fases/status, papéis, pessoas e histórico

**Files:**
- Modify: `server/src/db/schema.sql`
- Test: `server/test/schema.pipeline.test.ts`

**Interfaces:**
- Produces (tables): `phases`, `statuses`, `phase_roles`, `people`, `job_role_assignments`,
  `job_status_history`; adds `jobs.status_id` (nullable FK to `statuses`), `jobs.completed_at`
  (nullable timestamp).

This task seeds the entire fixed pipeline described in the spec. The seed inserts are
idempotent (`ON CONFLICT ... DO NOTHING`) so re-running `schema.sql` (which happens on
every `createDb` call, including every test pool creation) never duplicates rows.

- [ ] **Step 1: Write the failing test**

`server/test/schema.pipeline.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../src/db';

describe('pipeline schema', () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required to run this test');
  }

  it('seeds exactly the 6 fixed phases in order', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ order: number; name: string }>(
        'SELECT "order", name FROM phases ORDER BY "order"',
      );
      expect(result.rows).toEqual([
        { order: 1, name: 'Comercial e Orçamento' },
        { order: 2, name: 'Dotação Financeira e Burocracia (Set-up)' },
        { order: 3, name: 'Pré-Produção' },
        { order: 4, name: 'Captação (Set de Gravação)' },
        { order: 5, name: 'Pós-Produção' },
        { order: 6, name: 'Encerramento e Auditoria' },
      ]);
    } finally {
      await db.end();
    }
  });

  it('seeds exactly 25 statuses across the 6 phases, each with a valid primary_role', async () => {
    const db = await createDb(connectionString);
    try {
      const countResult = await db.query<{ count: string }>('SELECT count(*) FROM statuses');
      expect(Number(countResult.rows[0].count)).toBe(25);

      const orphanRoles = await db.query(
        `SELECT s.id FROM statuses s
         WHERE NOT EXISTS (
           SELECT 1 FROM phase_roles pr WHERE pr.phase_id = s.phase_id AND pr.area = s.primary_role
         )`,
      );
      expect(orphanRoles.rows).toEqual([]);
    } finally {
      await db.end();
    }
  });

  it('seeds at least 38 people across the pre-loaded areas', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ count: string }>('SELECT count(*) FROM people');
      expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(38);
    } finally {
      await db.end();
    }
  });

  it('adds status_id and completed_at columns to jobs', async () => {
    const db = await createDb(connectionString);
    try {
      const result = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'jobs'
           AND column_name IN ('status_id', 'completed_at')`,
      );
      const names = result.rows.map((r) => r.column_name).sort();
      expect(names).toEqual(['completed_at', 'status_id']);
    } finally {
      await db.end();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `phases`/`statuses`/etc. don't exist yet, or have 0 rows.

- [ ] **Step 3: Append the pipeline schema to `server/src/db/schema.sql`**

Add this block after the existing `jobs` table definition (do not modify the existing
`users`/`jobs` `CREATE TABLE` statements above it):

```sql
CREATE TABLE IF NOT EXISTS phases (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE ("order"),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  action_required TEXT NOT NULL,
  trigger_label TEXT NOT NULL,
  primary_role TEXT NOT NULL,
  UNIQUE (phase_id, "order")
);

CREATE TABLE IF NOT EXISTS phase_roles (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  area TEXT NOT NULL,
  UNIQUE (phase_id, area)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (name, area)
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_id INTEGER REFERENCES statuses(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS job_role_assignments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  area TEXT NOT NULL,
  person_id INTEGER REFERENCES people(id),
  UNIQUE (job_id, phase_id, area)
);

CREATE TABLE IF NOT EXISTS job_status_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  from_status_id INTEGER REFERENCES statuses(id),
  to_status_id INTEGER NOT NULL REFERENCES statuses(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT
);

INSERT INTO phases ("order", name) VALUES
  (1, 'Comercial e Orçamento'),
  (2, 'Dotação Financeira e Burocracia (Set-up)'),
  (3, 'Pré-Produção'),
  (4, 'Captação (Set de Gravação)'),
  (5, 'Pós-Produção'),
  (6, 'Encerramento e Auditoria')
ON CONFLICT (name) DO NOTHING;

INSERT INTO phase_roles (phase_id, area)
SELECT p.id, v.area
FROM (VALUES
  ('Comercial e Orçamento', 'Comercial'),
  ('Comercial e Orçamento', 'Produção Executiva'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Atendimento'),
  ('Dotação Financeira e Burocracia (Set-up)', 'Jurídico/Base'),
  ('Pré-Produção', 'Produção'),
  ('Pré-Produção', 'Criativo'),
  ('Pré-Produção', 'Locação/Elenco/Arte'),
  ('Captação (Set de Gravação)', 'Técnica/Imagem'),
  ('Captação (Set de Gravação)', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 'Produção Executiva'),
  ('Captação (Set de Gravação)', 'Financeiro'),
  ('Pós-Produção', 'Pós'),
  ('Pós-Produção', 'Atendimento'),
  ('Encerramento e Auditoria', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 'Produção Executiva'),
  ('Encerramento e Auditoria', 'Marketing')
) AS v(phase_name, area)
JOIN phases p ON p.name = v.phase_name
ON CONFLICT (phase_id, area) DO NOTHING;

INSERT INTO statuses (phase_id, "order", name, action_required, trigger_label, primary_role)
SELECT p.id, v."order", v.name, v.action_required, v.trigger_label, v.primary_role
FROM (VALUES
  ('Comercial e Orçamento', 1, 'Prospecção',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Briefing Recebido', 'Comercial'),
  ('Comercial e Orçamento', 2, 'Briefing Recebido',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Orçamento e Decupagem', 'Comercial'),
  ('Comercial e Orçamento', 3, 'Orçamento e Decupagem',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Avançar para: Defesa da Proposta', 'Produção Executiva'),
  ('Comercial e Orçamento', 4, 'Defesa da Proposta',
    'Preenchimento do Briefing Padronizado e criação da Carta Orçamentária/Tratamento.',
    'Tocar a Buzina', 'Comercial'),

  ('Dotação Financeira e Burocracia (Set-up)', 1, 'Dotação e Travamento',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: Aguardando Contrato', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 2, 'Aguardando Contrato',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: NF Emitida', 'Jurídico/Base'),
  ('Dotação Financeira e Burocracia (Set-up)', 3, 'NF Emitida',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Avançar para: Grupos Criados', 'Financeiro'),
  ('Dotação Financeira e Burocracia (Set-up)', 4, 'Grupos Criados',
    'Fagner trava a edição das planilhas de orçamento no Drive, Atendimento define o Assistente de Direção (AD) e Jurídico aprova o contrato.',
    'Contrato assinado anexado no Drive e pastas movidas para "Em execução"', 'Atendimento'),

  ('Pré-Produção', 1, 'Reunião de Briefing',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Contratações (Logística/Freelas)', 'Produção'),
  ('Pré-Produção', 2, 'Contratações (Logística/Freelas)',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: Aprovação PPM', 'Produção'),
  ('Pré-Produção', 3, 'Aprovação PPM',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Avançar para: OD Enviada', 'Criativo'),
  ('Pré-Produção', 4, 'OD Enviada',
    'Aprovação da estética na PPM com o cliente e emissão dos seguros.',
    'Assistente de Direção (AD) envia a Ordem do Dia (OD) com 24h de antecedência', 'Criativo'),

  ('Captação (Set de Gravação)', 1, 'Pré-Light',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Em Captação', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 2, 'Em Captação',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Desmontagem', 'Técnica/Imagem'),
  ('Captação (Set de Gravação)', 3, 'Desmontagem',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Avançar para: Prestação de Contas', 'Elétrica/Maquinaria'),
  ('Captação (Set de Gravação)', 4, 'Prestação de Contas',
    'Executar as gravações respeitando a política máxima de 12h a 14h.',
    'Logger realiza backup em HD e Produção finaliza o "Realizado"', 'Produção Executiva'),

  ('Pós-Produção', 1, 'Ingest / Decupagem',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Montagem / Cor / Motion', 'Pós'),
  ('Pós-Produção', 2, 'Montagem / Cor / Motion',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: QC Interno', 'Pós'),
  ('Pós-Produção', 3, 'QC Interno',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Aprovação do Cliente', 'Pós'),
  ('Pós-Produção', 4, 'Aprovação do Cliente',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Avançar para: Acessibilidade', 'Atendimento'),
  ('Pós-Produção', 5, 'Acessibilidade',
    'Edição completa, aprovação interna (QC) e envio ao cliente.',
    'Cliente dá o "De Acordo/Aceite Final" e recursos como Libras/Legendas são finalizados', 'Pós'),

  ('Encerramento e Auditoria', 1, 'Entrega Final (Mestres)',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Pesquisa NPS', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 2, 'Pesquisa NPS',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Fechamento Orçado x Dotado x Realizado', 'Qualidade e RH'),
  ('Encerramento e Auditoria', 3, 'Fechamento Orçado x Dotado x Realizado',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Avançar para: Arquivamento', 'Produção Executiva'),
  ('Encerramento e Auditoria', 4, 'Arquivamento',
    'Material vai para Cold Storage, avaliações são colhidas e dados financeiros finais são fechados.',
    'Todos os checkboxes preenchidos — Job concluído', 'Qualidade e RH')
) AS v(phase_name, "order", name, action_required, trigger_label, primary_role)
JOIN phases p ON p.name = v.phase_name
ON CONFLICT (phase_id, "order") DO NOTHING;

INSERT INTO people (name, area) VALUES
  ('Anne', 'Comercial'),
  ('Ronaldo', 'Comercial'),
  ('Binho', 'Comercial'),
  ('Vic', 'Comercial'),
  ('Adriano', 'Produção Executiva'),
  ('Mônica', 'Produção Executiva'),
  ('Rodolpho', 'Produção Executiva'),
  ('Juliano', 'Produção Executiva'),
  ('Flávia Lebre', 'Produção Executiva'),
  ('Fagner', 'Financeiro'),
  ('Dani', 'Financeiro'),
  ('Wilka', 'Atendimento'),
  ('Carol', 'Jurídico/Base'),
  ('Maíce', 'Produção'),
  ('Camila', 'Produção'),
  ('Alex', 'Produção'),
  ('Rodrigo', 'Produção'),
  ('Mateus', 'Produção'),
  ('Brendow', 'Criativo'),
  ('Camila', 'Locação/Elenco/Arte'),
  ('Rita', 'Locação/Elenco/Arte'),
  ('Priscila', 'Locação/Elenco/Arte'),
  ('Tiago', 'Locação/Elenco/Arte'),
  ('Coghi', 'Técnica/Imagem'),
  ('Lirton', 'Técnica/Imagem'),
  ('Japa', 'Técnica/Imagem'),
  ('Samir', 'Técnica/Imagem'),
  ('Fino', 'Técnica/Imagem'),
  ('Rafa', 'Elétrica/Maquinaria'),
  ('Mateus', 'Elétrica/Maquinaria'),
  ('Gabriel Fernando', 'Pós'),
  ('Nathan', 'Pós'),
  ('Brunão', 'Pós'),
  ('Tavares', 'Pós'),
  ('Cedrique', 'Pós'),
  ('Bruno Okumura', 'Qualidade e RH'),
  ('Maria Alice', 'Qualidade e RH'),
  ('Julia', 'Qualidade e RH'),
  ('Gabriella', 'Marketing'),
  ('Danilo', 'Marketing')
ON CONFLICT (name, area) DO NOTHING;
```

Note on `Fase 4`'s roles: the spec's source text lists a combined "Produção Executiva e
Financeiro" role for this phase. That string can't be assigned to any single person
(each person's `area` is one specific area, e.g. `'Produção Executiva'` OR
`'Financeiro'`, never the combined string). This schema splits it into two separate
`phase_roles` rows (`'Produção Executiva'` and `'Financeiro'`, both already used
elsewhere) so the role-assignment UI can actually find matching people. `Prestação de
Contas`'s `primary_role` is set to `'Produção Executiva'` (matches "Produção finaliza o
Realizado" from the source gatilho text).

Note on `action_required`/`trigger_label`: the source data only describes one
"Ação exigida" and one "Gatilho de avanço" per PHASE (referring to the whole phase's
work and the trigger that ends it), not per individual status. This seed repeats the
phase's `action_required` text across all of that phase's statuses (it's valid context
regardless of which status within the phase the job is at), and uses a generic
"Avançar para: `<próximo status>`" as `trigger_label` for intra-phase transitions,
reserving the specific named business trigger (e.g. "Tocar a Buzina") for the status
that actually ends the phase — this is the literal, faithful mapping of what the source
data specifies.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql server/test/schema.pipeline.test.ts
git commit -m "feat(server): seed fixed 6-phase/25-status pipeline, roles, and people"
```

---

## Task 2: Modelos e rota de dados de referência (fases/status/pessoas)

**Files:**
- Create: `server/src/models/reference.ts`
- Create: `server/src/models/people.ts`
- Create: `server/src/routes/reference.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/models.reference.test.ts`
- Test: `server/test/models.people.test.ts`
- Test: `server/test/routes.reference.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (Task 2 of Plan 1), `requireAuth` (Plan 1), `asyncHandler`
  (Plan 1), `withTestTransaction` (Plan 1).
- Produces: `export interface Phase { id: number; order: number; name: string }`,
  `export interface Status { id: number; phaseId: number; order: number; name: string; actionRequired: string; triggerLabel: string; primaryRole: string }`,
  `export interface PhaseWithStatuses extends Phase { roles: string[]; statuses: Status[] }`,
  `listPhasesWithStatuses(db: AppDatabase): Promise<PhaseWithStatuses[]>`,
  `export interface Person { id: number; name: string; area: string; active: boolean }`,
  `listPeople(db: AppDatabase, opts?: { activeOnly?: boolean }): Promise<Person[]>`,
  `createPerson(db: AppDatabase, input: { name: string; area: string }): Promise<Person>`,
  `setPersonActive(db: AppDatabase, id: number, active: boolean): Promise<Person>`,
  `createReferenceRouter(deps: { db: AppDatabase; jwtSecret: string }): Router`.

- [ ] **Step 1: Write the failing tests**

`server/test/models.reference.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { listPhasesWithStatuses } from '../src/models/reference';
import { withTestTransaction } from './helpers/testDb';

describe('listPhasesWithStatuses', () => {
  it('returns the 6 fixed phases in order, each with its statuses and roles', async () => {
    await withTestTransaction(async (db) => {
      const phases = await listPhasesWithStatuses(db);

      expect(phases).toHaveLength(6);
      expect(phases.map((p) => p.name)).toEqual([
        'Comercial e Orçamento',
        'Dotação Financeira e Burocracia (Set-up)',
        'Pré-Produção',
        'Captação (Set de Gravação)',
        'Pós-Produção',
        'Encerramento e Auditoria',
      ]);

      const fase1 = phases[0];
      expect(fase1.roles).toEqual(['Comercial', 'Produção Executiva']);
      expect(fase1.statuses.map((s) => s.name)).toEqual([
        'Prospecção',
        'Briefing Recebido',
        'Orçamento e Decupagem',
        'Defesa da Proposta',
      ]);
      expect(fase1.statuses[3].triggerLabel).toBe('Tocar a Buzina');
    });
  });
});
```

`server/test/models.people.test.ts`:

```ts
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
```

`server/test/routes.reference.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { withTestTransaction } from './helpers/testDb';

const JWT_SECRET = 'test-secret';
const ALLOWED_DOMAIN = 'ilhacrossmidia.com.br';
const FRONTEND_URL = 'http://localhost:5173';

function buildApp(db: AppDatabase) {
  const verifyIdToken = async (): Promise<GoogleProfile> => ({
    sub: 'google-sub-1',
    email: 'wilka@ilhacrossmidia.com.br',
    name: 'Wilka',
  });
  return createApp({ db, verifyIdToken, jwtSecret: JWT_SECRET, allowedDomain: ALLOWED_DOMAIN, frontendUrl: FRONTEND_URL });
}

async function loggedInAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  await agent.post('/api/auth/google').send({ idToken: 'fake-token' });
  return agent;
}

describe('GET /api/reference', () => {
  it('returns 401 when not logged in', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const res = await request(app).get('/api/reference');
      expect(res.status).toBe(401);
    });
  });

  it('returns the 6 phases with statuses', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/reference');

      expect(res.status).toBe(200);
      expect(res.body.phases).toHaveLength(6);
    });
  });
});

describe('GET /api/people', () => {
  it('returns the seeded people list', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.get('/api/people');

      expect(res.status).toBe(200);
      expect(res.body.people.some((p: { name: string }) => p.name === 'Wilka')).toBe(true);
    });
  });
});

describe('POST /api/people', () => {
  it('creates a person', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/people').send({ name: 'Rota Teste Pessoa', area: 'Comercial' });

      expect(res.status).toBe(201);
      expect(res.body.person.name).toBe('Rota Teste Pessoa');
    });
  });

  it('rejects missing name', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const res = await agent.post('/api/people').send({ area: 'Comercial' });

      expect(res.status).toBe(400);
    });
  });
});

describe('PATCH /api/people/:id/active', () => {
  it('toggles active state', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);
      const created = await agent.post('/api/people').send({ name: 'Rota Toggle Pessoa', area: 'Comercial' });

      const res = await agent.patch(`/api/people/${created.body.person.id}/active`).send({ active: false });

      expect(res.status).toBe(200);
      expect(res.body.person.active).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — none of the new files exist yet.

- [ ] **Step 3: Implement `server/src/models/reference.ts`**

```ts
import type { AppDatabase } from '../db';

export interface Phase {
  id: number;
  order: number;
  name: string;
}

export interface Status {
  id: number;
  phaseId: number;
  order: number;
  name: string;
  actionRequired: string;
  triggerLabel: string;
  primaryRole: string;
}

export interface PhaseWithStatuses extends Phase {
  roles: string[];
  statuses: Status[];
}

interface PhaseRow {
  id: number;
  order: number;
  name: string;
}

interface StatusRow {
  id: number;
  phase_id: number;
  order: number;
  name: string;
  action_required: string;
  trigger_label: string;
  primary_role: string;
}

interface RoleRow {
  phase_id: number;
  area: string;
}

function toStatus(row: StatusRow): Status {
  return {
    id: row.id,
    phaseId: row.phase_id,
    order: row.order,
    name: row.name,
    actionRequired: row.action_required,
    triggerLabel: row.trigger_label,
    primaryRole: row.primary_role,
  };
}

export async function listPhasesWithStatuses(db: AppDatabase): Promise<PhaseWithStatuses[]> {
  const [phasesResult, statusesResult, rolesResult] = await Promise.all([
    db.query<PhaseRow>('SELECT id, "order", name FROM phases ORDER BY "order"'),
    db.query<StatusRow>(
      'SELECT id, phase_id, "order", name, action_required, trigger_label, primary_role FROM statuses ORDER BY phase_id, "order"',
    ),
    db.query<RoleRow>('SELECT phase_id, area FROM phase_roles ORDER BY phase_id, area'),
  ]);

  return phasesResult.rows.map((phase) => ({
    id: phase.id,
    order: phase.order,
    name: phase.name,
    roles: rolesResult.rows.filter((r) => r.phase_id === phase.id).map((r) => r.area),
    statuses: statusesResult.rows.filter((s) => s.phase_id === phase.id).map(toStatus),
  }));
}
```

- [ ] **Step 4: Implement `server/src/models/people.ts`**

```ts
import type { AppDatabase } from '../db';

export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

interface PersonRow {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    active: row.active,
  };
}

export async function listPeople(
  db: AppDatabase,
  opts: { activeOnly?: boolean } = {},
): Promise<Person[]> {
  const query = opts.activeOnly
    ? 'SELECT * FROM people WHERE active = true ORDER BY area, name'
    : 'SELECT * FROM people ORDER BY area, name';
  const result = await db.query<PersonRow>(query);
  return result.rows.map(toPerson);
}

export async function createPerson(
  db: AppDatabase,
  input: { name: string; area: string },
): Promise<Person> {
  const result = await db.query<PersonRow>(
    'INSERT INTO people (name, area) VALUES ($1, $2) RETURNING *',
    [input.name, input.area],
  );
  return toPerson(result.rows[0]);
}

export async function setPersonActive(
  db: AppDatabase,
  id: number,
  active: boolean,
): Promise<Person> {
  const result = await db.query<PersonRow>(
    'UPDATE people SET active = $1 WHERE id = $2 RETURNING *',
    [active, id],
  );
  return toPerson(result.rows[0]);
}
```

- [ ] **Step 5: Implement `server/src/routes/reference.ts`**

```ts
import { Router } from 'express';
import type { AppDatabase } from '../db';
import { listPhasesWithStatuses } from '../models/reference';
import { listPeople, createPerson, setPersonActive } from '../models/people';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

export interface ReferenceRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
}

export function createReferenceRouter(deps: ReferenceRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));

  router.get(
    '/reference',
    asyncHandler(async (_req, res) => {
      res.json({ phases: await listPhasesWithStatuses(deps.db) });
    }),
  );

  router.get(
    '/people',
    asyncHandler(async (_req, res) => {
      res.json({ people: await listPeople(deps.db) });
    }),
  );

  router.post(
    '/people',
    asyncHandler(async (req, res) => {
      const { name, area } = req.body as { name?: string; area?: string };

      if (!name || !name.trim() || !area || !area.trim()) {
        res.status(400).json({ error: 'name and area are required' });
        return;
      }

      const person = await createPerson(deps.db, { name: name.trim(), area: area.trim() });
      res.status(201).json({ person });
    }),
  );

  router.patch(
    '/people/:id/active',
    asyncHandler(async (req, res) => {
      const { active } = req.body as { active?: boolean };

      if (typeof active !== 'boolean') {
        res.status(400).json({ error: 'active must be a boolean' });
        return;
      }

      const person = await setPersonActive(deps.db, Number(req.params.id), active);
      res.json({ person });
    }),
  );

  return router;
}
```

- [ ] **Step 6: Wire the router into `server/src/app.ts`**

Add the import and mount it at `/api` (not `/api/reference`, since this router defines
both `/reference` and `/people` sub-paths internally):

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppDatabase } from './db';
import { createAuthRouter, type VerifyIdToken } from './routes/auth';
import { createJobsRouter } from './routes/jobs';
import { createReferenceRouter } from './routes/reference';

export interface AppDeps {
  db: AppDatabase;
  verifyIdToken: VerifyIdToken;
  jwtSecret: string;
  allowedDomain: string;
  frontendUrl: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.frontendUrl, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/jobs', createJobsRouter(deps));
  app.use('/api', createReferenceRouter(deps));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/models/reference.ts server/src/models/people.ts server/src/routes/reference.ts server/src/app.ts server/test/models.reference.test.ts server/test/models.people.test.ts server/test/routes.reference.test.ts
git commit -m "feat(server): add reference data (phases/statuses) and people CRUD"
```

---

## Task 3: Histórico de status e cálculo de farol de alerta

**Files:**
- Create: `server/src/models/jobStatusHistory.ts`
- Create: `server/src/models/alertLevel.ts`
- Test: `server/test/models.jobStatusHistory.test.ts`
- Test: `server/test/models.alertLevel.test.ts`

**Interfaces:**
- Consumes: `AppDatabase`, `withTestTransaction`.
- Produces:
  `export interface JobStatusHistoryEntry { id: number; jobId: number; fromStatusId: number | null; toStatusId: number; changedAt: string; note: string | null }`,
  `recordStatusChange(db: AppDatabase, input: { jobId: number; fromStatusId: number | null; toStatusId: number; note?: string }): Promise<JobStatusHistoryEntry>`,
  `getJobStatusHistory(db: AppDatabase, jobId: number): Promise<JobStatusHistoryEntry[]>`,
  `getLastStatusChangeAt(db: AppDatabase, jobId: number): Promise<Date | null>`,
  `export type AlertLevel = 'green' | 'yellow' | 'red'`,
  `computeAlertLevel(lastChangedAt: Date | null, now: Date): AlertLevel`.

- [ ] **Step 1: Write the failing tests**

`server/test/models.jobStatusHistory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createJob } from '../src/models/job';
import {
  recordStatusChange,
  getJobStatusHistory,
  getLastStatusChangeAt,
} from '../src/models/jobStatusHistory';
import { withTestTransaction } from './helpers/testDb';

describe('job status history', () => {
  it('records a status change and returns it in history, newest first', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Histórico Teste' });

      const statusRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Prospecção'`,
      );
      const briefingRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Briefing Recebido'`,
      );

      await recordStatusChange(db, {
        jobId: job.id,
        fromStatusId: statusRow.rows[0].id,
        toStatusId: briefingRow.rows[0].id,
        note: 'Avanço de teste',
      });

      const history = await getJobStatusHistory(db, job.id);

      // >=1, not >=2: at this point in the plan, createJob (Plan 1's version) does
      // not yet record an initial history entry itself — that lands in Task 4. This
      // test only asserts on the entry recordStatusChange just wrote above.
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].toStatusId).toBe(briefingRow.rows[0].id);
      expect(history[0].note).toBe('Avanço de teste');
    });
  });

  it('returns the most recent changed_at via getLastStatusChangeAt', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Último Status Teste' });

      // createJob doesn't record history yet at this point in the plan (Task 4 adds
      // that) — record one manually so there's something for getLastStatusChangeAt
      // to find.
      const statusRow = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Prospecção'`,
      );
      await recordStatusChange(db, { jobId: job.id, fromStatusId: null, toStatusId: statusRow.rows[0].id });

      const lastChangedAt = await getLastStatusChangeAt(db, job.id);

      expect(lastChangedAt).not.toBeNull();
      expect(lastChangedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
```

`server/test/models.alertLevel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeAlertLevel } from '../src/models/alertLevel';

describe('computeAlertLevel', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');

  it('returns green when changed recently', () => {
    const lastChangedAt = new Date('2026-08-18T12:00:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('green');
  });

  it('returns yellow after 3 days without change', () => {
    const lastChangedAt = new Date('2026-08-16T11:59:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('yellow');
  });

  it('returns red after 7 days without change', () => {
    const lastChangedAt = new Date('2026-08-12T11:59:00.000Z');
    expect(computeAlertLevel(lastChangedAt, now)).toBe('red');
  });

  it('returns red when there is no history at all', () => {
    expect(computeAlertLevel(null, now)).toBe('red');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/models/jobStatusHistory.ts` and `src/models/alertLevel.ts` don't
exist yet. (`createJob` from `../src/models/job` already exists from Plan 1 — this test
only fails on the missing history/alert modules, not on `job.ts`.)

- [ ] **Step 3: Implement `server/src/models/jobStatusHistory.ts`**

```ts
import type { AppDatabase } from '../db';

export interface JobStatusHistoryEntry {
  id: number;
  jobId: number;
  fromStatusId: number | null;
  toStatusId: number;
  changedAt: string;
  note: string | null;
}

interface HistoryRow {
  id: number;
  job_id: number;
  from_status_id: number | null;
  to_status_id: number;
  changed_at: string | Date;
  note: string | null;
}

function toEntry(row: HistoryRow): JobStatusHistoryEntry {
  return {
    id: row.id,
    jobId: row.job_id,
    fromStatusId: row.from_status_id,
    toStatusId: row.to_status_id,
    changedAt: new Date(row.changed_at).toISOString(),
    note: row.note,
  };
}

export async function recordStatusChange(
  db: AppDatabase,
  input: { jobId: number; fromStatusId: number | null; toStatusId: number; note?: string },
): Promise<JobStatusHistoryEntry> {
  const result = await db.query<HistoryRow>(
    `INSERT INTO job_status_history (job_id, from_status_id, to_status_id, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.jobId, input.fromStatusId, input.toStatusId, input.note ?? null],
  );
  return toEntry(result.rows[0]);
}

export async function getJobStatusHistory(
  db: AppDatabase,
  jobId: number,
): Promise<JobStatusHistoryEntry[]> {
  const result = await db.query<HistoryRow>(
    'SELECT * FROM job_status_history WHERE job_id = $1 ORDER BY changed_at DESC, id DESC',
    [jobId],
  );
  return result.rows.map(toEntry);
}

export async function getLastStatusChangeAt(db: AppDatabase, jobId: number): Promise<Date | null> {
  const result = await db.query<{ changed_at: string | Date }>(
    'SELECT changed_at FROM job_status_history WHERE job_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 1',
    [jobId],
  );
  return result.rows[0] ? new Date(result.rows[0].changed_at) : null;
}
```

- [ ] **Step 4: Implement `server/src/models/alertLevel.ts`**

```ts
export type AlertLevel = 'green' | 'yellow' | 'red';

const YELLOW_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
const RED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function computeAlertLevel(lastChangedAt: Date | null, now: Date): AlertLevel {
  if (!lastChangedAt) {
    return 'red';
  }

  const elapsedMs = now.getTime() - lastChangedAt.getTime();

  if (elapsedMs >= RED_THRESHOLD_MS) {
    return 'red';
  }
  if (elapsedMs >= YELLOW_THRESHOLD_MS) {
    return 'yellow';
  }
  return 'green';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/models/jobStatusHistory.ts server/src/models/alertLevel.ts server/test/models.jobStatusHistory.test.ts server/test/models.alertLevel.test.ts
git commit -m "feat(server): add job status history and alert level calculation"
```

---

## Task 4: Extensão do modelo de Job — status inicial, avanço e enriquecimento

**Files:**
- Modify: `server/src/models/job.ts`
- Test: `server/test/models.job.test.ts` (extend the existing file — do not remove any
  existing test)

**Interfaces:**
- Consumes: `recordStatusChange`, `getLastStatusChangeAt` (Task 3),
  `computeAlertLevel`, `AlertLevel` (Task 3).
- Produces: extended `export interface Job { id: number; name: string; code: string | null; client: string | null; createdAt: string; updatedAt: string; statusId: number | null; statusName: string | null; phaseId: number | null; phaseName: string | null; completedAt: string | null; alertLevel: AlertLevel; highlightedPersonName: string | null }`,
  `createJob(db: AppDatabase, input: { name: string; code?: string; client?: string }): Promise<Job>` (now sets initial status),
  `listJobs(db: AppDatabase): Promise<Job[]>` (now enriched),
  `getJobById(db: AppDatabase, id: number): Promise<Job | null>` (new),
  `advanceJobStatus(db: AppDatabase, jobId: number, note?: string): Promise<Job>` (new),
  `setJobStatus(db: AppDatabase, jobId: number, statusId: number, note?: string): Promise<Job>` (new).

This is the task with the most business logic in the plan — read it carefully before
implementing.

- [ ] **Step 1: Write the failing tests**

Add these to the END of the existing `server/test/models.job.test.ts` (keep the 3
existing tests untouched; add the new `import` line to the top alongside the existing
one):

```ts
import { describe, it, expect } from 'vitest';
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus } from '../src/models/job';
import { withTestTransaction } from './helpers/testDb';

// ... existing 3 tests stay exactly as they are ...

describe('job status lifecycle', () => {
  it('defaults a new job to the first status of the first phase', async () => {
    await withTestTransaction(async (db) => {
      const job = await createJob(db, { name: 'Job Status Inicial Teste' });

      expect(job.statusName).toBe('Prospecção');
      expect(job.phaseName).toBe('Comercial e Orçamento');
      expect(job.completedAt).toBeNull();
    });
  });

  it('enriches listJobs with status, phase, and alertLevel', async () => {
    await withTestTransaction(async (db) => {
      await createJob(db, { name: 'Job Listagem Enriquecida Teste' });

      const jobs = await listJobs(db);
      const found = jobs.find((j) => j.name === 'Job Listagem Enriquecida Teste');

      expect(found).toBeDefined();
      expect(found!.statusName).toBe('Prospecção');
      expect(['green', 'yellow', 'red']).toContain(found!.alertLevel);
    });
  });

  it('getJobById returns the enriched job, and null for a nonexistent id', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Detalhe Teste' });

      const found = await getJobById(db, created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);

      const notFound = await getJobById(db, -1);
      expect(notFound).toBeNull();
    });
  });

  it('advanceJobStatus moves to the next status in order and records history', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Avanço Teste' });

      const advanced = await advanceJobStatus(db, created.id, 'Avanço automático de teste');

      expect(advanced.statusName).toBe('Briefing Recebido');
    });
  });

  it('setJobStatus moves to an arbitrary status chosen manually', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Status Manual Teste' });

      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Aprovação PPM'`,
      );

      const updated = await setJobStatus(db, created.id, targetStatus.rows[0].id, 'Pulo manual de teste');

      expect(updated.statusName).toBe('Aprovação PPM');
      expect(updated.phaseName).toBe('Pré-Produção');
    });
  });

  it('marks the job completed when it reaches the final status', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Conclusão Teste' });

      const finalStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Arquivamento'`,
      );

      const completed = await setJobStatus(db, created.id, finalStatus.rows[0].id);

      expect(completed.statusName).toBe('Arquivamento');
      expect(completed.completedAt).not.toBeNull();
    });
  });

  it('does NOT mark the job completed when it only reaches the last status of an earlier phase', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Não-Conclusão Teste' });

      // "Defesa da Proposta" is the LAST status of Phase 1, not the final status of
      // the whole pipeline — reaching it must not complete the job.
      const phase1LastStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`,
      );

      const updated = await setJobStatus(db, created.id, phase1LastStatus.rows[0].id);

      expect(updated.statusName).toBe('Defesa da Proposta');
      expect(updated.completedAt).toBeNull();
    });
  });

  it('advanceJobStatus throws when the job is already at the last status of its phase', async () => {
    await withTestTransaction(async (db) => {
      const created = await createJob(db, { name: 'Job Avanço no Limite Teste' });
      const phase1LastStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Defesa da Proposta'`,
      );
      await setJobStatus(db, created.id, phase1LastStatus.rows[0].id);

      await expect(advanceJobStatus(db, created.id)).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — `getJobById`, `advanceJobStatus`, `setJobStatus` don't exist yet, and
`createJob`/`listJobs` don't set/return status fields yet.

- [ ] **Step 3: Replace `server/src/models/job.ts` in full**

```ts
import type { AppDatabase } from '../db';
import { recordStatusChange, getLastStatusChangeAt } from './jobStatusHistory';
import { computeAlertLevel, type AlertLevel } from './alertLevel';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
}

interface JobRow {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  status_id: number | null;
  status_name: string | null;
  phase_id: number | null;
  phase_name: string | null;
  completed_at: string | Date | null;
  highlighted_person_name: string | null;
}

const JOB_SELECT = `
  SELECT
    j.*,
    s.id AS status_id,
    s.name AS status_name,
    p.id AS phase_id,
    p.name AS phase_name,
    (
      SELECT person.name
      FROM job_role_assignments jra
      JOIN people person ON person.id = jra.person_id
      WHERE jra.job_id = j.id AND jra.phase_id = s.phase_id AND jra.area = s.primary_role
      LIMIT 1
    ) AS highlighted_person_name
  FROM jobs j
  LEFT JOIN statuses s ON s.id = j.status_id
  LEFT JOIN phases p ON p.id = s.phase_id
`;

async function rowToJob(db: AppDatabase, row: JobRow): Promise<Job> {
  const lastChangedAt = await getLastStatusChangeAt(db, row.id);

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    client: row.client,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    statusId: row.status_id,
    statusName: row.status_name,
    phaseId: row.phase_id,
    phaseName: row.phase_name,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    alertLevel: computeAlertLevel(lastChangedAt, new Date()),
    highlightedPersonName: row.highlighted_person_name,
  };
}

async function getFirstStatusId(db: AppDatabase): Promise<number> {
  const result = await db.query<{ id: number }>(
    `SELECT s.id FROM statuses s
     JOIN phases p ON p.id = s.phase_id
     ORDER BY p."order", s."order"
     LIMIT 1`,
  );
  return result.rows[0].id;
}

export async function listJobs(db: AppDatabase): Promise<Job[]> {
  const result = await db.query<JobRow>(`${JOB_SELECT} ORDER BY j.created_at DESC, j.id DESC`);
  return Promise.all(result.rows.map((row) => rowToJob(db, row)));
}

export async function getJobById(db: AppDatabase, id: number): Promise<Job | null> {
  const result = await db.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
  if (!result.rows[0]) {
    return null;
  }
  return rowToJob(db, result.rows[0]);
}

export async function createJob(
  db: AppDatabase,
  input: { name: string; code?: string; client?: string },
): Promise<Job> {
  const firstStatusId = await getFirstStatusId(db);

  const inserted = await db.query<{ id: number }>(
    'INSERT INTO jobs (name, code, client, status_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.name, input.code ?? null, input.client ?? null, firstStatusId],
  );

  const jobId = inserted.rows[0].id;

  await recordStatusChange(db, { jobId, fromStatusId: null, toStatusId: firstStatusId });

  const job = await getJobById(db, jobId);
  return job!;
}

async function isFinalStatus(db: AppDatabase, statusId: number): Promise<boolean> {
  // Must compare (phase order, status order) as a pair — comparing status "order"
  // within the same phase alone would call the LAST STATUS OF EVERY PHASE "final"
  // (e.g. "Defesa da Proposta", the end of Phase 1), not just the true final status
  // of the final phase ("Arquivamento", end of Phase 6).
  const result = await db.query<{ is_final: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM statuses s2
       JOIN phases p2 ON p2.id = s2.phase_id
       JOIN statuses s1 ON s1.id = $1
       JOIN phases p1 ON p1.id = s1.phase_id
       WHERE (p2."order", s2."order") > (p1."order", s1."order")
     ) AS is_final
     FROM statuses WHERE id = $1`,
    [statusId],
  );
  return result.rows[0]?.is_final ?? false;
}

async function applyStatusChange(
  db: AppDatabase,
  jobId: number,
  fromStatusId: number | null,
  toStatusId: number,
  note?: string,
): Promise<Job> {
  const completed = await isFinalStatus(db, toStatusId);

  await db.query(
    `UPDATE jobs SET status_id = $1, updated_at = now(), completed_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $3`,
    [toStatusId, completed, jobId],
  );

  await recordStatusChange(db, { jobId, fromStatusId, toStatusId, note });

  const job = await getJobById(db, jobId);
  return job!;
}

export async function advanceJobStatus(db: AppDatabase, jobId: number, note?: string): Promise<Job> {
  const current = await getJobById(db, jobId);
  if (!current || current.statusId === null) {
    throw new Error('Job not found or has no current status');
  }

  const next = await db.query<{ id: number }>(
    `SELECT s2.id FROM statuses s1
     JOIN statuses s2 ON s2.phase_id = s1.phase_id AND s2."order" = s1."order" + 1
     WHERE s1.id = $1`,
    [current.statusId],
  );

  if (!next.rows[0]) {
    throw new Error('Job is already at the final status of its phase');
  }

  return applyStatusChange(db, jobId, current.statusId, next.rows[0].id, note);
}

export async function setJobStatus(
  db: AppDatabase,
  jobId: number,
  statusId: number,
  note?: string,
): Promise<Job> {
  const current = await getJobById(db, jobId);
  if (!current) {
    throw new Error('Job not found');
  }

  return applyStatusChange(db, jobId, current.statusId, statusId, note);
}
```

Note: `advanceJobStatus` only advances within the CURRENT phase (next `"order"` in the
same `phase_id`) — it does not jump across phases (e.g., from `Defesa da Proposta`,
Fase 1's last status, to `Dotação e Travamento`, Fase 2's first status). Moving to the
next PHASE after a phase-ending trigger is a manual `setJobStatus` call in this MVP
(the route layer in Task 6 will make this explicit — see that task's note). This keeps
`advanceJobStatus`'s logic simple and matches the spec's model where every status has
its own named `gatilho_avanço`, phase-ending ones included, but the actual "which
status is next" is only unambiguous within a phase.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/job.ts server/test/models.job.test.ts
git commit -m "feat(server): enrich Job with status/phase/alert, add advance and manual status transitions"
```

---

## Task 5: Atribuição de papéis por job

**Files:**
- Create: `server/src/models/jobRoleAssignments.ts`
- Test: `server/test/models.jobRoleAssignments.test.ts`

**Interfaces:**
- Consumes: `AppDatabase`, `withTestTransaction`, `createJob` (Task 4).
- Produces: `export interface RoleAssignment { area: string; personId: number | null; personName: string | null }`,
  `getJobRoleAssignments(db: AppDatabase, jobId: number, phaseId: number): Promise<RoleAssignment[]>`,
  `setJobRoleAssignment(db: AppDatabase, jobId: number, phaseId: number, area: string, personId: number | null): Promise<RoleAssignment>`.

`getJobRoleAssignments` returns one entry per role area DEFINED FOR THAT PHASE (from
`phase_roles`), even if the job has no assignment yet for that area — the row's
`personId`/`personName` are `null` in that case. This lets the frontend render an empty
dropdown slot for every expected role, not just the ones already filled in.

- [ ] **Step 1: Write the failing test**

`server/test/models.jobRoleAssignments.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `server/`)
Expected: FAIL — `src/models/jobRoleAssignments.ts` does not exist yet.

- [ ] **Step 3: Implement `server/src/models/jobRoleAssignments.ts`**

```ts
import type { AppDatabase } from '../db';

export interface RoleAssignment {
  area: string;
  personId: number | null;
  personName: string | null;
}

export async function getJobRoleAssignments(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
): Promise<RoleAssignment[]> {
  const result = await db.query<{ area: string; person_id: number | null; person_name: string | null }>(
    `SELECT pr.area, jra.person_id, person.name AS person_name
     FROM phase_roles pr
     LEFT JOIN job_role_assignments jra
       ON jra.phase_id = pr.phase_id AND jra.area = pr.area AND jra.job_id = $1
     LEFT JOIN people person ON person.id = jra.person_id
     WHERE pr.phase_id = $2
     ORDER BY pr.area`,
    [jobId, phaseId],
  );

  return result.rows.map((row) => ({
    area: row.area,
    personId: row.person_id,
    personName: row.person_name,
  }));
}

export async function setJobRoleAssignment(
  db: AppDatabase,
  jobId: number,
  phaseId: number,
  area: string,
  personId: number | null,
): Promise<RoleAssignment> {
  await db.query(
    `INSERT INTO job_role_assignments (job_id, phase_id, area, person_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (job_id, phase_id, area) DO UPDATE SET person_id = EXCLUDED.person_id`,
    [jobId, phaseId, area, personId],
  );

  const result = await db.query<{ person_name: string | null }>(
    'SELECT name AS person_name FROM people WHERE id = $1',
    [personId],
  );

  return {
    area,
    personId,
    personName: personId ? result.rows[0]?.person_name ?? null : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/models/jobRoleAssignments.ts server/test/models.jobRoleAssignments.test.ts
git commit -m "feat(server): add per-job role assignments by phase"
```

---

## Task 6: Rotas de jobs — detalhe, avanço, status manual e atribuição de papéis

**Files:**
- Modify: `server/src/routes/jobs.ts`
- Test: `server/test/routes.jobs.test.ts` (extend — keep existing tests)

**Interfaces:**
- Consumes: `getJobById`, `advanceJobStatus`, `setJobStatus` (Task 4),
  `getJobRoleAssignments`, `setJobRoleAssignment` (Task 5), `getJobStatusHistory`
  (Task 3), `listPhasesWithStatuses` (Task 2).
- Produces: `GET /api/jobs/:id` → `{ job: Job & { actionRequired: string; triggerLabel: string; roleAssignments: RoleAssignment[]; statusHistory: JobStatusHistoryEntry[] } }`,
  `POST /api/jobs/:id/advance` → `{ job: Job }`,
  `POST /api/jobs/:id/status` → `{ job: Job }`,
  `PUT /api/jobs/:id/roles/:area` → `{ roleAssignment: RoleAssignment }`.

- [ ] **Step 1: Write the failing tests**

Add these to the END of the existing `server/test/routes.jobs.test.ts` (keep the 4
existing tests; extend the top `import` line):

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db';
import type { GoogleProfile } from '../src/routes/auth';
import { withTestTransaction } from './helpers/testDb';

// ... existing buildApp/loggedInAgent helpers and 4 existing tests stay as they are ...

describe('GET /api/jobs/:id', () => {
  it('returns the job detail with actionRequired, triggerLabel, roleAssignments, and history', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Detalhe Rota Teste' });
      const res = await agent.get(`/api/jobs/${created.body.job.id}`);

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Prospecção');
      expect(res.body.job.triggerLabel).toBe('Avançar para: Briefing Recebido');
      expect(res.body.job.roleAssignments.map((a: { area: string }) => a.area).sort()).toEqual([
        'Comercial',
        'Produção Executiva',
      ]);
      expect(res.body.job.statusHistory.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('returns 404 for a nonexistent job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const res = await agent.get('/api/jobs/999999999');

      expect(res.status).toBe(404);
    });
  });
});

describe('POST /api/jobs/:id/advance', () => {
  it('advances the job to the next status within the phase', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Avanço Rota Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/advance`).send({});

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Briefing Recebido');
    });
  });
});

describe('POST /api/jobs/:id/status', () => {
  it('moves the job to a manually chosen status', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Rota Teste' });
      const targetStatus = await db.query<{ id: number }>(
        `SELECT id FROM statuses WHERE name = 'Aprovação PPM'`,
      );

      const res = await agent
        .post(`/api/jobs/${created.body.job.id}/status`)
        .send({ statusId: targetStatus.rows[0].id, note: 'Pulo manual via rota' });

      expect(res.status).toBe(200);
      expect(res.body.job.statusName).toBe('Aprovação PPM');
    });
  });

  it('rejects a missing statusId', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Status Manual Inválido Teste' });
      const res = await agent.post(`/api/jobs/${created.body.job.id}/status`).send({});

      expect(res.status).toBe(400);
    });
  });
});

describe('PUT /api/jobs/:id/roles/:area', () => {
  it('assigns a person to a role area for the job', async () => {
    await withTestTransaction(async (db) => {
      const app = buildApp(db);
      const agent = await loggedInAgent(app);

      const created = await agent.post('/api/jobs').send({ name: 'Job Atribuição Rota Teste' });
      const personRow = await db.query<{ id: number }>(
        `SELECT id FROM people WHERE name = 'Anne' AND area = 'Comercial'`,
      );

      const res = await agent
        .put(`/api/jobs/${created.body.job.id}/roles/Comercial`)
        .send({ personId: personRow.rows[0].id });

      expect(res.status).toBe(200);
      expect(res.body.roleAssignment.personName).toBe('Anne');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (inside `server/`)
Expected: FAIL — none of the new routes exist yet.

- [ ] **Step 3: Replace `server/src/routes/jobs.ts` in full**

```ts
import { Router } from 'express';
import type { AppDatabase } from '../db';
import { createJob, listJobs, getJobById, advanceJobStatus, setJobStatus } from '../models/job';
import { getJobStatusHistory } from '../models/jobStatusHistory';
import { getJobRoleAssignments, setJobRoleAssignment } from '../models/jobRoleAssignments';
import { requireAuth } from '../auth/middleware';
import { asyncHandler } from '../utils/asyncHandler';

export interface JobsRouterDeps {
  db: AppDatabase;
  jwtSecret: string;
}

export function createJobsRouter(deps: JobsRouterDeps): Router {
  const router = Router();

  router.use(requireAuth(deps.jwtSecret));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json({ jobs: await listJobs(deps.db) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { name, code, client } = req.body as { name?: string; code?: string; client?: string };

      if (!name || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const job = await createJob(deps.db, { name: name.trim(), code, client });
      res.status(201).json({ job });
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const jobId = Number(req.params.id);
      const job = await getJobById(deps.db, jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const [statusRow, roleAssignments, statusHistory] = await Promise.all([
        deps.db.query<{ action_required: string; trigger_label: string }>(
          'SELECT action_required, trigger_label FROM statuses WHERE id = $1',
          [job.statusId],
        ),
        job.phaseId ? getJobRoleAssignments(deps.db, jobId, job.phaseId) : Promise.resolve([]),
        getJobStatusHistory(deps.db, jobId),
      ]);

      res.json({
        job: {
          ...job,
          actionRequired: statusRow.rows[0]?.action_required ?? null,
          triggerLabel: statusRow.rows[0]?.trigger_label ?? null,
          roleAssignments,
          statusHistory,
        },
      });
    }),
  );

  router.post(
    '/:id/advance',
    asyncHandler(async (req, res) => {
      const { note } = req.body as { note?: string };
      const job = await advanceJobStatus(deps.db, Number(req.params.id), note);
      res.json({ job });
    }),
  );

  router.post(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const { statusId, note } = req.body as { statusId?: number; note?: string };

      if (!statusId) {
        res.status(400).json({ error: 'statusId is required' });
        return;
      }

      const job = await setJobStatus(deps.db, Number(req.params.id), statusId, note);
      res.json({ job });
    }),
  );

  router.put(
    '/:id/roles/:area',
    asyncHandler(async (req, res) => {
      const { personId } = req.body as { personId?: number | null };
      const job = await getJobById(deps.db, Number(req.params.id));

      if (!job || !job.phaseId) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const roleAssignment = await setJobRoleAssignment(
        deps.db,
        job.id,
        job.phaseId,
        req.params.area,
        personId ?? null,
      );
      res.json({ roleAssignment });
    }),
  );

  return router;
}
```

Note: `POST /:id/advance` moves the job to the next status WITHIN the current phase
only (per Task 4's `advanceJobStatus`). When a job is at the LAST status of a phase
(e.g. `Defesa da Proposta`) and its `gatilho_avanço` fires (e.g. "Tocar a Buzina"), the
Gerente uses `POST /:id/status` with the first status of the next phase — the frontend
(Task 9) always shows both the "Avançar" button and the manual selector together, so
this is a normal, expected click, not a workaround.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` (inside `server/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/jobs.ts server/test/routes.jobs.test.ts
git commit -m "feat(server): add job detail, advance, manual status, and role assignment routes"
```

---

## Task 7: Cliente de API do frontend — tipos e métodos novos

**Files:**
- Modify: `web/src/api/client.ts`
- Test: `web/test/api.client.test.ts` (extend — keep existing 3 tests)

**Interfaces:**
- Produces: `export type AlertLevel = 'green' | 'yellow' | 'red'`,
  extended `export interface Job { ...; statusId: number | null; statusName: string | null; phaseId: number | null; phaseName: string | null; completedAt: string | null; alertLevel: AlertLevel; highlightedPersonName: string | null }`,
  `export interface JobDetail extends Job { actionRequired: string | null; triggerLabel: string | null; roleAssignments: RoleAssignment[]; statusHistory: StatusHistoryEntry[] }`,
  `export interface RoleAssignment { area: string; personId: number | null; personName: string | null }`,
  `export interface StatusHistoryEntry { id: number; fromStatusId: number | null; toStatusId: number; changedAt: string; note: string | null }`,
  `export interface Status { id: number; phaseId: number; order: number; name: string; actionRequired: string; triggerLabel: string; primaryRole: string }`,
  `export interface Phase { id: number; order: number; name: string; roles: string[]; statuses: Status[] }`,
  `export interface Person { id: number; name: string; area: string; active: boolean }`,
  extended `export const api` with: `getReference`, `listPeople`, `createPerson`,
  `getJob`, `advanceJob`, `setJobStatus`, `assignRole`.

- [ ] **Step 1: Write the failing test**

Add to the END of `web/test/api.client.test.ts` (keep the existing 3 tests and the
`beforeEach`/`vi.stubGlobal` setup pattern already there):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request, api } from '../src/api/client';

// ... existing describe('api client request()') block with its 3 tests stays as is ...

describe('api.getJob / api.advanceJob / api.setJobStatus / api.assignRole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getJob fetches /api/jobs/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1, name: 'Job' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.getJob(1);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/jobs/1'), expect.anything());
  });

  it('advanceJob posts to /api/jobs/:id/advance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.advanceJob(1, 'nota');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/advance'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('setJobStatus posts to /api/jobs/:id/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job: { id: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.setJobStatus(1, 42, 'nota');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/status'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('assignRole puts to /api/jobs/:id/roles/:area', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ roleAssignment: { area: 'Comercial', personId: 1, personName: 'Anne' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.assignRole(1, 'Comercial', 2);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/jobs/1/roles/Comercial'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `api.getJob` etc. don't exist yet.

- [ ] **Step 3: Replace `web/src/api/client.ts` in full**

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface User {
  id: number;
  email: string;
  name?: string;
}

export type AlertLevel = 'green' | 'yellow' | 'red';

export interface Job {
  id: number;
  name: string;
  code: string | null;
  client: string | null;
  createdAt: string;
  updatedAt: string;
  statusId: number | null;
  statusName: string | null;
  phaseId: number | null;
  phaseName: string | null;
  completedAt: string | null;
  alertLevel: AlertLevel;
  highlightedPersonName: string | null;
}

export interface RoleAssignment {
  area: string;
  personId: number | null;
  personName: string | null;
}

export interface StatusHistoryEntry {
  id: number;
  fromStatusId: number | null;
  toStatusId: number;
  changedAt: string;
  note: string | null;
}

export interface JobDetail extends Job {
  actionRequired: string | null;
  triggerLabel: string | null;
  roleAssignments: RoleAssignment[];
  statusHistory: StatusHistoryEntry[];
}

export interface Status {
  id: number;
  phaseId: number;
  order: number;
  name: string;
  actionRequired: string;
  triggerLabel: string;
  primaryRole: string;
}

export interface Phase {
  id: number;
  order: number;
  name: string;
  roles: string[];
  statuses: Status[];
}

export interface Person {
  id: number;
  name: string;
  area: string;
  active: boolean;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  loginWithGoogle: (idToken: string) =>
    request<{ user: User }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  listJobs: () => request<{ jobs: Job[] }>('/api/jobs'),
  createJob: (job: { name: string; code?: string; client?: string }) =>
    request<{ job: Job }>('/api/jobs', { method: 'POST', body: JSON.stringify(job) }),
  getJob: (id: number) => request<{ job: JobDetail }>(`/api/jobs/${id}`),
  advanceJob: (id: number, note?: string) =>
    request<{ job: Job }>(`/api/jobs/${id}/advance`, { method: 'POST', body: JSON.stringify({ note }) }),
  setJobStatus: (id: number, statusId: number, note?: string) =>
    request<{ job: Job }>(`/api/jobs/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ statusId, note }),
    }),
  assignRole: (id: number, area: string, personId: number | null) =>
    request<{ roleAssignment: RoleAssignment }>(`/api/jobs/${id}/roles/${area}`, {
      method: 'PUT',
      body: JSON.stringify({ personId }),
    }),
  getReference: () => request<{ phases: Phase[] }>('/api/reference'),
  listPeople: () => request<{ people: Person[] }>('/api/people'),
  createPerson: (input: { name: string; area: string }) =>
    request<{ person: Person }>('/api/people', { method: 'POST', body: JSON.stringify(input) }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/test/api.client.test.ts
git commit -m "feat(web): extend API client with board/job-detail/roles/reference methods"
```

---

## Task 8: Página do Kanban (Board) — substitui o Dashboard

**Files:**
- Create: `web/src/pages/Board.tsx`
- Delete: `web/src/pages/Dashboard.tsx`
- Delete: `web/test/Dashboard.test.tsx`
- Create: `web/test/Board.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api`, `Job`, `Phase` (Task 7).
- Produces: `export function Board(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`web/test/Board.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Board } from '../src/pages/Board';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      listJobs: vi.fn(),
      createJob: vi.fn(),
      getReference: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const twoPhases = [
  { id: 1, order: 1, name: 'Comercial e Orçamento', roles: ['Comercial'], statuses: [] },
  { id: 2, order: 2, name: 'Dotação Financeira e Burocracia (Set-up)', roles: ['Financeiro'], statuses: [] },
];

function renderBoard() {
  return render(
    <MemoryRouter>
      <Board />
    </MemoryRouter>,
  );
}

describe('Board', () => {
  beforeEach(() => {
    mockedApi.listJobs.mockReset();
    mockedApi.createJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.getReference.mockResolvedValue({ phases: twoPhases });
  });

  it('shows a column per phase and no jobs message when empty', async () => {
    mockedApi.listJobs.mockResolvedValue({ jobs: [] });

    renderBoard();

    expect(await screen.findByText('Comercial e Orçamento')).toBeInTheDocument();
    expect(await screen.findByText('Dotação Financeira e Burocracia (Set-up)')).toBeInTheDocument();
  });

  it('places a job card under its phase column with status and highlighted person', async () => {
    mockedApi.listJobs.mockResolvedValue({
      jobs: [
        {
          id: 1,
          name: 'Colgate - Color Correct Wave 2',
          code: '0307-2026',
          client: 'Colgate',
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
          statusId: 10,
          statusName: 'Prospecção',
          phaseId: 1,
          phaseName: 'Comercial e Orçamento',
          completedAt: null,
          alertLevel: 'green',
          highlightedPersonName: 'Anne',
        },
      ],
    });

    renderBoard();

    expect(await screen.findByText(/Colgate - Color Correct Wave 2/)).toBeInTheDocument();
    expect(await screen.findByText('Prospecção')).toBeInTheDocument();
    expect(await screen.findByText('Anne')).toBeInTheDocument();
  });

  it('creates a job and refreshes the board', async () => {
    mockedApi.listJobs
      .mockResolvedValueOnce({ jobs: [] })
      .mockResolvedValueOnce({
        jobs: [
          {
            id: 1,
            name: 'Novo job',
            code: null,
            client: null,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
            statusId: 10,
            statusName: 'Prospecção',
            phaseId: 1,
            phaseName: 'Comercial e Orçamento',
            completedAt: null,
            alertLevel: 'green',
            highlightedPersonName: null,
          },
        ],
      });
    mockedApi.createJob.mockResolvedValue({
      job: {
        id: 1,
        name: 'Novo job',
        code: null,
        client: null,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
        statusId: 10,
        statusName: 'Prospecção',
        phaseId: 1,
        phaseName: 'Comercial e Orçamento',
        completedAt: null,
        alertLevel: 'green',
        highlightedPersonName: null,
      },
    });

    const user = userEvent.setup();
    renderBoard();

    await screen.findByText('Comercial e Orçamento');

    await user.type(screen.getByLabelText('Nome'), 'Novo job');
    await user.click(screen.getByRole('button', { name: 'Adicionar job' }));

    await waitFor(() => expect(mockedApi.createJob).toHaveBeenCalledWith({ name: 'Novo job' }));
    expect(await screen.findByText(/Novo job/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/pages/Board.tsx` does not exist yet.

- [ ] **Step 3: Delete the old Dashboard**

```bash
git rm web/src/pages/Dashboard.tsx web/test/Dashboard.test.tsx
```

- [ ] **Step 4: Implement `web/src/pages/Board.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Job, type Phase, type AlertLevel } from '../api/client';

const ALERT_COLOR: Record<AlertLevel, string> = {
  green: '#2e7d32',
  yellow: '#f9a825',
  red: '#c62828',
};

export function Board() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [client, setClient] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshJobs() {
    const res = await api.listJobs();
    setJobs(res.jobs);
  }

  useEffect(() => {
    Promise.all([api.getReference(), api.listJobs()])
      .then(([referenceRes, jobsRes]) => {
        setPhases(referenceRes.phases);
        setJobs(jobsRes.jobs);
      })
      .catch(() => setError('Não foi possível carregar o board.'));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Informe o nome do job.');
      return;
    }

    try {
      await api.createJob({
        name: name.trim(),
        code: code.trim() || undefined,
        client: client.trim() || undefined,
      });
      setName('');
      setCode('');
      setClient('');
      await refreshJobs();
    } catch {
      setError('Não foi possível criar o job.');
    }
  }

  return (
    <div style={{ maxWidth: '100%', padding: '1rem' }}>
      <h1>Board de Jobs</h1>

      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem', maxWidth: 640 }}>
        <div>
          <label htmlFor="job-name">Nome</label>
          <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-code">Código</label>
          <input id="job-code" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label htmlFor="job-client">Cliente</label>
          <input id="job-client" value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <button type="submit">Adicionar job</button>
        {error && <p role="alert">{error}</p>}
      </form>

      <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto' }}>
        {phases.map((phase) => (
          <div key={phase.id} style={{ minWidth: 260, flex: '0 0 auto' }}>
            <h2>{phase.name}</h2>
            {jobs
              .filter((job) => job.phaseId === phase.id)
              .map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${job.id}`}
                  style={{
                    display: 'block',
                    border: '1px solid #ccc',
                    borderLeft: `4px solid ${ALERT_COLOR[job.alertLevel]}`,
                    borderRadius: 4,
                    padding: '0.5rem',
                    marginBottom: '0.5rem',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <strong>{job.name}</strong>
                  {job.client ? ` (${job.client})` : ''}
                  <div>{job.statusName}</div>
                  {job.highlightedPersonName && <div>{job.highlightedPersonName}</div>}
                </Link>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update `web/src/App.tsx` to render the Board instead of the Dashboard**

Replace the `Dashboard` import and usage with `Board` (everything else — `RequireAuth`,
`LoginRoute`, `AuthProvider`, routing structure — stays exactly as it is from Plan 1):

```tsx
import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Board } from './pages/Board';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem',
        }}
      >
        <span>{user.email}</span>
        <button type="button" onClick={() => void logout()}>
          Sair
        </button>
      </header>
      {children}
    </div>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

Note: the `header`'s `maxWidth: 640, margin: '0 auto'` from Plan 1 is removed here since
the board itself now wants the full page width (6 columns side by side) — the header
spans the full width too, which is fine.

Task 9 adds the `/jobs/:id` route — `AppRoutes` above only has `/` and `/login` for now,
intentionally; Task 9 extends this same file.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test` (inside `web/`)
Expected: PASS (Task 7's `api.client.test.ts` and this task's `Board.test.tsx` both
pass; `AuthContext.test.tsx` from Plan 1 is unaffected since it doesn't render `App`).

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Board.tsx web/test/Board.test.tsx web/src/App.tsx
git commit -m "feat(web): replace Dashboard with a 6-phase Kanban board"
```

---

## Task 9: Página de detalhe do job

**Files:**
- Create: `web/src/pages/JobDetail.tsx`
- Create: `web/test/JobDetail.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `api`, `JobDetail`, `Phase`, `Person` (Task 7).
- Produces: `export function JobDetailPage(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`web/test/JobDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobDetailPage } from '../src/pages/JobDetail';
import { api } from '../src/api/client';

vi.mock('../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../src/api/client')>('../src/api/client');
  return {
    ...actual,
    api: {
      getJob: vi.fn(),
      getReference: vi.fn(),
      listPeople: vi.fn(),
      advanceJob: vi.fn(),
      setJobStatus: vi.fn(),
      assignRole: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);

const jobDetail = {
  id: 1,
  name: 'Colgate - Color Correct Wave 2',
  code: '0307-2026',
  client: 'Colgate',
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
  statusId: 10,
  statusName: 'Prospecção',
  phaseId: 1,
  phaseName: 'Comercial e Orçamento',
  completedAt: null,
  alertLevel: 'green' as const,
  highlightedPersonName: 'Anne',
  actionRequired: 'Preenchimento do Briefing Padronizado.',
  triggerLabel: 'Avançar para: Briefing Recebido',
  roleAssignments: [
    { area: 'Comercial', personId: 5, personName: 'Anne' },
    { area: 'Produção Executiva', personId: null, personName: null },
  ],
  statusHistory: [
    { id: 1, fromStatusId: null, toStatusId: 10, changedAt: '2026-08-18T00:00:00.000Z', note: null },
  ],
};

const referencePhases = [
  {
    id: 1,
    order: 1,
    name: 'Comercial e Orçamento',
    roles: ['Comercial', 'Produção Executiva'],
    statuses: [
      { id: 10, phaseId: 1, order: 1, name: 'Prospecção', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
      { id: 11, phaseId: 1, order: 2, name: 'Briefing Recebido', actionRequired: '', triggerLabel: '', primaryRole: 'Comercial' },
    ],
  },
];

function renderJobDetail() {
  return render(
    <MemoryRouter initialEntries={['/jobs/1']}>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    mockedApi.getJob.mockReset();
    mockedApi.getReference.mockReset();
    mockedApi.listPeople.mockReset();
    mockedApi.advanceJob.mockReset();
    mockedApi.setJobStatus.mockReset();
    mockedApi.assignRole.mockReset();

    mockedApi.getJob.mockResolvedValue({ job: jobDetail });
    mockedApi.getReference.mockResolvedValue({ phases: referencePhases });
    mockedApi.listPeople.mockResolvedValue({
      people: [
        { id: 5, name: 'Anne', area: 'Comercial', active: true },
        { id: 6, name: 'Adriano', area: 'Produção Executiva', active: true },
      ],
    });
  });

  it('shows the current status, action required, and trigger button', async () => {
    renderJobDetail();

    expect(await screen.findByText('Prospecção')).toBeInTheDocument();
    expect(await screen.findByText(/Preenchimento do Briefing Padronizado/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Avançar para: Briefing Recebido' })).toBeInTheDocument();
  });

  it('advances the status when the trigger button is clicked', async () => {
    mockedApi.advanceJob.mockResolvedValue({ job: { ...jobDetail, statusId: 11, statusName: 'Briefing Recebido' } });
    const user = userEvent.setup();

    renderJobDetail();

    await user.click(await screen.findByRole('button', { name: 'Avançar para: Briefing Recebido' }));

    await waitFor(() => expect(mockedApi.advanceJob).toHaveBeenCalledWith(1, undefined));
  });

  it('shows the role assignments for the current phase', async () => {
    renderJobDetail();

    expect(await screen.findByText('Comercial')).toBeInTheDocument();
    expect(await screen.findByText('Produção Executiva')).toBeInTheDocument();
  });

  it('shows the status history', async () => {
    renderJobDetail();

    // "Prospecção" appears both in the current-status line and in the history
    // entry below it — asserting 2 matches proves the history list actually
    // rendered, not just the status line.
    await waitFor(() => expect(screen.getAllByText(/Prospecção/)).toHaveLength(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (inside `web/`)
Expected: FAIL — `src/pages/JobDetail.tsx` does not exist yet.

- [ ] **Step 3: Implement `web/src/pages/JobDetail.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type JobDetail, type Phase, type Person } from '../api/client';

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);

  const [job, setJob] = useState<JobDetail | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [jobRes, referenceRes, peopleRes] = await Promise.all([
      api.getJob(jobId),
      api.getReference(),
      api.listPeople(),
    ]);
    setJob(jobRes.job);
    setPhases(referenceRes.phases);
    setPeople(peopleRes.people);
  }

  useEffect(() => {
    refresh().catch(() => setError('Não foi possível carregar o job.'));
  }, [jobId]);

  async function handleAdvance() {
    setError(null);
    try {
      await api.advanceJob(jobId);
      await refresh();
    } catch {
      setError('Não foi possível avançar o status.');
    }
  }

  async function handleManualStatus(statusId: number) {
    setError(null);
    try {
      await api.setJobStatus(jobId, statusId);
      await refresh();
    } catch {
      setError('Não foi possível mudar o status manualmente.');
    }
  }

  async function handleAssignRole(area: string, personId: number | null) {
    setError(null);
    try {
      await api.assignRole(jobId, area, personId);
      await refresh();
    } catch {
      setError('Não foi possível atribuir a pessoa a esse papel.');
    }
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!job) {
    return <p>Carregando...</p>;
  }

  const allStatuses = phases.flatMap((phase) => phase.statuses);
  const peopleByArea = (area: string) => people.filter((p) => p.area === area && p.active);

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>{job.name}</h1>
      <p>
        {job.phaseName} — <strong>{job.statusName}</strong>
      </p>

      {job.actionRequired && <p>{job.actionRequired}</p>}

      {error && <p role="alert">{error}</p>}

      {job.triggerLabel && (
        <button type="button" onClick={handleAdvance}>
          {job.triggerLabel}
        </button>
      )}

      <div style={{ marginTop: '1rem' }}>
        <label htmlFor="manual-status">Mudar status manualmente</label>
        <select
          id="manual-status"
          value=""
          onChange={(e) => {
            if (e.target.value) {
              void handleManualStatus(Number(e.target.value));
            }
          }}
        >
          <option value="">Selecione...</option>
          {allStatuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </div>

      <h2>Responsáveis nesta fase</h2>
      <ul>
        {job.roleAssignments.map((assignment) => (
          <li key={assignment.area}>
            <span>{assignment.area}</span>{': '}
            <select
              aria-label={assignment.area}
              value={assignment.personId ?? ''}
              onChange={(e) =>
                void handleAssignRole(assignment.area, e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">(não atribuído)</option>
              {peopleByArea(assignment.area).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <h2>Histórico</h2>
      <ul>
        {job.statusHistory.map((entry) => {
          const toStatus = allStatuses.find((s) => s.id === entry.toStatusId);
          return (
            <li key={entry.id}>
              {new Date(entry.changedAt).toLocaleString('pt-BR')} — {toStatus?.name ?? entry.toStatusId}
              {entry.note ? ` (${entry.note})` : ''}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Update `web/src/App.tsx` to add the `/jobs/:id` route**

Add the import and the new `Route`, alongside the existing `/` and `/login` routes from
Task 8 (everything else in the file stays the same):

```tsx
import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Login } from './pages/Login';
import { Board } from './pages/Board';
import { JobDetailPage } from './pages/JobDetail';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem',
        }}
      >
        <span>{user.email}</span>
        <button type="button" onClick={() => void logout()}>
          Sair
        </button>
      </header>
      {children}
    </div>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Carregando...</p>;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Board />
          </RequireAuth>
        }
      />
      <Route
        path="/jobs/:id"
        element={
          <RequireAuth>
            <JobDetailPage />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: Run all frontend tests to verify nothing broke**

Run: `npm test` (inside `web/`)
Expected: PASS — `api.client.test.ts`, `AuthContext.test.tsx`, `Board.test.tsx`, and
`JobDetail.test.tsx` all pass.

- [ ] **Step 6: Run the build to confirm no type errors**

Run: `npm run build` (inside `web/`)
Expected: succeeds (this project's frontend build broke once already from a missing
Vite type reference — confirm this task doesn't reintroduce a build break).

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/JobDetail.tsx web/test/JobDetail.test.tsx web/src/App.tsx
git commit -m "feat(web): add job detail page with status trigger, manual status, and role assignment"
```

---

## Manual Verification (after all tasks)

Once all 9 tasks are complete and reviewed, run both dev servers (`server/`: `npm run
dev`, `web/`: `npm run dev`) and manually confirm:

- [ ] Board loads with 6 columns, one per phase, in the correct order.
- [ ] Creating a job places it in the "Comercial e Orçamento" column at "Prospecção".
- [ ] Clicking a card opens the job detail page.
- [ ] Clicking the trigger button advances the status and the change is visible back on
      the board.
- [ ] The manual status selector can move a job to any status, including jumping to a
      different phase.
- [ ] Assigning a person to a role on the job detail page persists after a page reload.
- [ ] The status history list grows with every change, newest first.
- [ ] A job's alert color changes from green after 3+ days without a status change
      (can be verified by manually backdating a `job_status_history.changed_at` row in
      Supabase's table editor for a test job, then reloading the board).
